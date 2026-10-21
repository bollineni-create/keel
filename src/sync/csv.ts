/**
 * Imports Copilot Money's transaction CSV export (Settings → Export your transactions).
 * Columns: date, name, amount, status, category, parent category, excluded, type, account, account mask, note, recurring
 * Header names vary slightly by version; matching is case-insensitive and fuzzy.
 */
import { createHash } from 'node:crypto';
import { getDb, nowIso, upsert, type Row } from '../db.js';

export interface CsvImportResult {
  imported: number;
  skipped: number;
  accountsCreated: number;
  categoriesCreated: number;
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f !== '')) rows.push(row);
  return rows;
}

function col(headers: string[], ...names: string[]): number {
  for (const n of names) {
    const i = headers.findIndex((h) => h === n);
    if (i >= 0) return i;
  }
  for (const n of names) {
    const i = headers.findIndex((h) => h.includes(n));
    if (i >= 0) return i;
  }
  return -1;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export function importCopilotCsv(text: string): CsvImportResult {
  const rows = parseCsv(text);
  if (rows.length < 2) return { imported: 0, skipped: 0, accountsCreated: 0, categoriesCreated: 0 };
  const headers = rows[0].map((h) => h.trim().toLowerCase());
  const iDate = col(headers, 'date');
  const iName = col(headers, 'name', 'description', 'merchant');
  const iAmount = col(headers, 'amount');
  const iStatus = col(headers, 'status', 'pending');
  const iCat = col(headers, 'category');
  const iParent = col(headers, 'parent category', 'parent');
  const iExcl = col(headers, 'excluded');
  const iType = col(headers, 'type', 'transaction type');
  const iAcct = col(headers, 'account');
  const iMask = col(headers, 'account mask', 'mask');
  const iNote = col(headers, 'note', 'notes');
  const iRec = col(headers, 'recurring');
  if (iDate < 0 || iAmount < 0 || iName < 0) throw new Error(`CSV is missing date/name/amount columns (saw: ${headers.join(', ')})`);

  const d = getDb();
  const existingAccounts = new Map<string, string>();
  for (const a of d.prepare('SELECT id, name, mask FROM accounts').all() as any[]) existingAccounts.set(`${a.name}|${a.mask ?? ''}`, a.id);
  const existingCats = new Map<string, string>();
  for (const c of d.prepare('SELECT id, name FROM categories').all() as any[]) existingCats.set(c.name.toLowerCase(), c.id);

  const txRows: Row[] = [];
  const newAccounts: Row[] = [];
  const newCats: Row[] = [];
  let skipped = 0;

  for (const r of rows.slice(1)) {
    const date = normalizeDate(r[iDate]);
    const amount = Number(String(r[iAmount]).replace(/[$,\s]/g, ''));
    if (!date || !Number.isFinite(amount)) {
      skipped++;
      continue;
    }
    const name = r[iName]?.trim() || 'Transaction';
    const acctName = iAcct >= 0 ? r[iAcct]?.trim() : '';
    const mask = iMask >= 0 ? r[iMask]?.trim() : '';
    let accountId: string | null = null;
    if (acctName) {
      const key = `${acctName}|${mask}`;
      accountId = existingAccounts.get(key) ?? null;
      if (!accountId) {
        accountId = `csv:${slug(acctName)}${mask ? ':' + mask : ''}`;
        existingAccounts.set(key, accountId);
        newAccounts.push({ id: accountId, name: acctName, mask: mask || null, type: guessType(acctName), balance: 0, currency: 'USD', updated_at: nowIso() });
      }
    }
    const parentName = iParent >= 0 ? r[iParent]?.trim() : '';
    const catName = iCat >= 0 ? r[iCat]?.trim() : '';
    let parentId: string | null = null;
    if (parentName) parentId = ensureCat(parentName, null);
    let categoryId: string | null = null;
    if (catName) categoryId = ensureCat(catName, parentId);

    const typ = iType >= 0 ? r[iType]?.toLowerCase() : '';
    const transfer = /transfer/.test(typ) ? 1 : 0;
    const income = /income/.test(typ) || (amount < 0 && !transfer) ? 1 : 0;
    const id = 'csv:' + createHash('sha1').update(`${date}|${name}|${amount}|${accountId ?? ''}`).digest('hex').slice(0, 16);
    txRows.push({
      id,
      date,
      name,
      original_name: null,
      amount,
      account_id: accountId,
      category_id: categoryId,
      pending: iStatus >= 0 && /pending/i.test(r[iStatus] ?? '') ? 1 : 0,
      reviewed: 1,
      excluded: iExcl >= 0 && /true|yes|1/i.test(r[iExcl] ?? '') ? 1 : 0,
      transfer,
      income,
      note: iNote >= 0 ? r[iNote] || null : null,
      recurring_id: iRec >= 0 && r[iRec] ? `csv:${slug(r[iRec])}` : null,
      tags: null,
      source: 'csv',
      raw: null,
      updated_at: nowIso(),
    });
  }

  function ensureCat(name: string, parent: string | null): string {
    const k = name.toLowerCase();
    let id = existingCats.get(k);
    if (!id) {
      id = `csv:${slug(name)}`;
      existingCats.set(k, id);
      newCats.push({ id, name, parent_id: parent, emoji: null, color: null, excluded: 0, budget_amount: null, raw: null });
    }
    return id;
  }

  upsert('accounts', newAccounts);
  upsert('categories', newCats);
  // Only insert rows we have not seen; a Copilot sync owns ids it knows.
  const imported = upsert('transactions', txRows);
  return { imported, skipped, accountsCreated: newAccounts.length, categoriesCreated: newCats.length };
}

function normalizeDate(s: string | undefined): string | null {
  if (!s) return null;
  const t = s.trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }
  const dt = new Date(t);
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString().slice(0, 10);
}

function guessType(name: string): string {
  const n = name.toLowerCase();
  if (/credit|card|visa|amex|mastercard|sapphire|freedom/.test(n)) return 'credit';
  if (/loan|mortgage/.test(n)) return 'loan';
  if (/401|ira|brokerage|invest|hsa|roth/.test(n)) return 'investment';
  return 'depository';
}
