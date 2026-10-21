/**
 * SimpleFIN Bridge (https://beta-bridge.simplefin.org): $15/year for up to 25 institutions, backed by MX.
 * The user links banks on the Bridge website, then pastes a one-time Setup Token into Daybook. Daybook claims
 * it once for an Access URL (Basic-auth credentials inside), stores that encrypted, and polls
 * GET {access}/accounts?version=2. No redirect URIs or webhooks, so it works on localhost.
 *
 * Protocol facts this adapter is built around (https://www.simplefin.org/protocol.html and the Bridge's
 * developer guide, checked October 2026):
 *  - amounts are positive for deposits: Daybook negates them (positive = money out)
 *  - ~24 requests a day per token before warnings and then a disabled token: Daybook syncs every 4 hours
 *  - date windows over 45 days draw a gen.api warning (and over 90 are capped): Daybook asks for ≤45
 *  - ids are scoped (accounts per connection, transactions per account): Daybook namespaces them
 *  - pending rows re-post under new ids: pending rows missing from a fresh window are dropped
 *  - broken bank logins come back as errlist `con.auth`; the user fixes them on the Bridge site
 *  - Node's fetch refuses URLs with credentials, and an old bridge host redirects to the root page:
 *    Daybook sends an Authorization header itself and never follows redirects
 */
import { getDb, nowIso, upsert, type Row } from '../db.js';
import { normalizeAccountType } from './copilot.js';
import { connectionSecret, createConnection, rawOf, updateConnection, type ConnectionRow } from './connections.js';
import { takeoverDate } from './enrich.js';
import { ConnectionError, type DirectProvider, type FetchLike, type ProviderResult } from './provider.js';

type Json = Record<string, any>;

export const BRIDGE_URL = 'https://beta-bridge.simplefin.org/';
const WINDOW_DAYS = 45;
const BACKFILL_DAYS = 90;
const DAILY_REQUEST_BUDGET = 20;

let fetchImpl: FetchLike = (url, init) => fetch(url, init);
/** For tests. */
export function _setSimplefinFetch(f: FetchLike): void {
  fetchImpl = f;
}

// ---------- claiming ----------

/** Setup Token (base64 of a claim URL) → Access URL. A pasted Access URL is accepted as is. */
export async function claimSetupToken(token: string): Promise<string> {
  const t = token.trim();
  if (/^https:\/\/[^/\s]+:[^/\s]+@/i.test(t)) return t;
  let claimUrl: string;
  try {
    claimUrl = Buffer.from(t, 'base64').toString('utf8').trim();
  } catch {
    claimUrl = '';
  }
  if (!/^https:\/\//i.test(claimUrl)) throw new ConnectionError('That doesn’t look like a SimpleFIN Setup Token. Copy it again from the Bridge’s “New connection” page.');
  const res = await fetchImpl(claimUrl, { method: 'POST', headers: { 'content-length': '0' }, redirect: 'manual' });
  if (res.status === 403) throw new ConnectionError('SimpleFIN says this Setup Token was already used or doesn’t exist. Create a new one on the Bridge and paste that.');
  if (!res.ok) throw new ConnectionError(`SimpleFIN claim failed (HTTP ${res.status}).`);
  const access = (await res.text()).trim();
  if (!/^https:\/\/[^/\s]+:[^/\s]+@/i.test(access)) throw new ConnectionError('SimpleFIN returned something other than an Access URL.');
  return access;
}

export async function addSimplefinConnection(setupToken: string): Promise<ConnectionRow> {
  const access = await claimSetupToken(setupToken);
  return createConnection('simplefin', access, { institution: 'SimpleFIN Bridge', raw: {} });
}

// ---------- fetching ----------

function splitAccessUrl(access: string): { base: string; auth: string } {
  const u = new URL(access);
  const auth = Buffer.from(`${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`).toString('base64');
  return { base: `${u.protocol}//${u.host}${u.pathname.replace(/\/$/, '')}`, auth };
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const epoch = (iso: string) => Math.floor(Date.parse(iso + 'T00:00:00Z') / 1000);

async function getAccounts(access: string, params: Record<string, string | number>): Promise<{ body: Json; messages: string[] }> {
  const { base, auth } = splitAccessUrl(access);
  const qs = new URLSearchParams(Object.entries({ version: 2, ...params }).map(([k, v]) => [k, String(v)]));
  const res = await fetchImpl(`${base}/accounts?${qs}`, { headers: { authorization: `Basic ${auth}`, accept: 'application/json' }, redirect: 'manual' });
  if (res.status >= 300 && res.status < 400) throw new ConnectionError('SimpleFIN moved this connection. Create a new Setup Token on the Bridge and connect again.', 'needs_reauth', 'redirect');
  if (res.status === 403) throw new ConnectionError(`SimpleFIN rejected Daybook's access (revoked or wrong credentials). Create a new Setup Token at ${BRIDGE_URL} and connect again.`, 'needs_reauth', 'http_403');
  if (res.status === 402) throw new ConnectionError(`Your SimpleFIN Bridge subscription needs renewing (${BRIDGE_URL}).`, 'error', 'http_402');
  if (!res.ok) throw new ConnectionError(`SimpleFIN returned HTTP ${res.status}.`);
  const messages = (res.headers.get('x-api-message') ?? '').split(/\s*;\s*|\n/).filter(Boolean);
  return { body: (await res.json()) as Json, messages };
}

/** Date windows to fetch: a 90-day backfill on first sync, else from a week before the last sync. */
export function windows(lastSynced: string | null, now = new Date()): Array<[string, string]> {
  const end = new Date(now.getTime() + 86400000);
  const earliest = now.getTime() - BACKFILL_DAYS * 86400000;
  const start = new Date(lastSynced ? Math.max(earliest, Date.parse(lastSynced) - 7 * 86400000) : earliest);
  const out: Array<[string, string]> = [];
  for (let s = start; s < end; ) {
    const e = new Date(Math.min(end.getTime(), s.getTime() + WINDOW_DAYS * 86400000));
    out.push([ymd(s), ymd(e)]);
    if (e.getTime() >= end.getTime()) break;
    // overlap a day: the Bridge's date filter is day-precision with fuzzy edges
    s = new Date(e.getTime() - 86400000);
  }
  return out;
}

// ---------- mapping ----------

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * SimpleFIN has no account type: infer one from the account's own name (never the institution's:
 * "Navy Federal Credit Union" or "Discover Bank" say nothing about the account), then the balance sign.
 * A wrong guess is fixed with update_account, which also rebuilds the account's balance history.
 */
export function guessType(name: string, _institution: string | null, balance: number): string {
  const t = name.toLowerCase().replace(/credit union/g, '');
  if (/\b(checking|savings|money market|debit|share draft|cash management|cd)\b/.test(t)) return 'depository';
  if (/\b(credit card|credit|visa|mastercard|master card|amex|american express)\b/.test(t) || /\bcard\b/.test(t)) return 'credit';
  if (/\b(loan|mortgage|heloc|line of credit)\b/.test(t)) return 'loan';
  if (normalizeAccountType(t) === 'investment' || /\b(brokerage|individual|joint|trust|crypto|stocks?)\b/.test(t)) return 'investment';
  return balance < 0 ? 'credit' : 'depository';
}

function maskOf(name: string): string | null {
  const m = name.match(/(?:x|\*|•|\.\.\.|-|#|\()\s*(\d{4})\)?\s*$/i) ?? name.match(/\b(\d{4})\)?\s*$/);
  return m ? m[1] : null;
}

function localDay(seconds: number): string {
  const d = new Date(seconds * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function accountKey(conn: ConnectionRow, a: Json): string {
  return `sfin:${conn.id}:${a.conn_id ?? a.org?.domain ?? a.org?.name ?? '_'}:${a.id}`;
}

export function mapSimplefinAccount(a: Json, conn: ConnectionRow, institution: string | null, existingType?: string | null): Row {
  const bal = num(a.balance) ?? 0;
  const type = existingType || guessType(String(a.name ?? ''), institution, bal);
  const liability = type === 'credit' || type === 'loan';
  const date = num(a['balance-date']);
  return {
    id: accountKey(conn, a),
    name: a.name ?? 'Account',
    official_name: null,
    mask: maskOf(String(a.name ?? '')),
    type,
    subtype: null,
    institution,
    // Daybook stores what's owed on a card or loan as a positive balance; feeds disagree on the sign.
    balance: liability ? Math.abs(bal) : bal,
    available: num(a['available-balance']),
    limit_amt: null,
    currency: /^[A-Z]{3}$/.test(String(a.currency ?? '')) ? a.currency : 'USD',
    raw: { ...a, transactions: undefined, holdings: undefined },
    updated_at: nowIso(),
    source: 'simplefin',
    connection_id: conn.id,
    balance_date: date ? new Date(date * 1000).toISOString() : nowIso(),
  };
}

/** What a re-posted row inherits from the pending row it replaces. */
const CARRY = ['category_id', 'reviewed', 'excluded', 'note', 'tags', 'goal_id', 'transfer', 'income', 'local_edits'];

const clean = (s: string) => s.replace(/\s{2,}/g, ' ').replace(/\b(POS|DEBIT|PURCHASE|CHECKCARD|CARD)\b\s*/gi, '').trim();

export function mapSimplefinTransaction(t: Json, acctId: string, conn: ConnectionRow): Row {
  const posted = num(t.posted) ?? 0;
  const when = posted > 0 ? posted : num(t.transacted_at) ?? Math.floor(Date.now() / 1000);
  // SimpleFIN: positive = deposit. Daybook: positive = money out.
  const amount = Math.round(-(num(t.amount) ?? 0) * 100) / 100;
  const desc = String(t.description ?? '').trim();
  return {
    id: `${acctId}:${t.id}`,
    date: localDay(when),
    name: (t.payee && String(t.payee).trim()) || clean(desc) || 'Transaction',
    original_name: desc || null,
    amount,
    account_id: acctId,
    pending: t.pending || posted === 0 ? 1 : 0,
    transfer: 0,
    income: amount < 0 ? 1 : 0,
    provider_category: t.extra?.category ?? null,
    source: 'simplefin',
    connection_id: conn.id,
    raw: t,
    updated_at: nowIso(),
  };
}

// ---------- sync ----------

interface SfinRaw { institutions?: string[]; req_day?: string; req_count?: number }

function spendRequest(conn: ConnectionRow, raw: SfinRaw): SfinRaw {
  const day = ymd(new Date());
  const count = raw.req_day === day ? (raw.req_count ?? 0) : 0;
  if (count >= DAILY_REQUEST_BUDGET) throw new ConnectionError(`Daybook has used today's SimpleFIN request budget (${DAILY_REQUEST_BUDGET}); it will sync again tomorrow.`, 'ok', 'budget');
  const next = { ...raw, req_day: day, req_count: count + 1 };
  updateConnection(conn.id, { raw: JSON.stringify(next) });
  return next;
}

export const simplefinProvider: DirectProvider = {
  id: 'simplefin',
  label: 'SimpleFIN',
  minIntervalMinutes: 240,
  forcedFloorMinutes: 30,
  async sync(conn: ConnectionRow): Promise<ProviderResult> {
    const d = getDb();
    const access = connectionSecret(conn);
    const counts: Record<string, number> = { accounts: 0, transactions: 0, removed: 0 };
    const warnings: string[] = [];
    let raw = rawOf<SfinRaw>(conn);
    const institutions = new Set<string>();
    const broken = new Map<string, string>();
    const seenAccounts = new Set<string>();
    // Windows overlap by a day, so count distinct rows rather than rows written.
    const seenTx = new Set<string>(), seenHoldings = new Set<string>();

    for (const [start, end] of windows(conn.last_synced)) {
      raw = spendRequest(conn, raw);
      const { body, messages } = await getAccounts(access, { 'start-date': epoch(start), 'end-date': epoch(end), pending: 1 });
      warnings.push(...messages.map((m) => `SimpleFIN: ${m}`));
      const connNames = new Map<string, string>((body.connections ?? []).map((c: Json) => [String(c.conn_id), String(c.name ?? c.org_name ?? 'Bank')]));
      for (const e of body.errlist ?? []) {
        const code = String(e.code ?? '');
        if (code === 'gen.auth') throw new ConnectionError(`SimpleFIN rejected Daybook's access. Create a new Setup Token at ${BRIDGE_URL} and connect again.`, 'needs_reauth', code);
        if (code === 'con.auth' || code.startsWith('con.')) broken.set(String(e.conn_id ?? ''), connNames.get(String(e.conn_id)) ?? String(e.msg ?? 'a bank'));
        else if (code !== 'gen.api') warnings.push(`SimpleFIN ${code}: ${e.msg ?? ''}`.trim());
      }
      for (const m of body.errors ?? []) warnings.push(`SimpleFIN: ${m}`);

      for (const a of body.accounts ?? []) {
        const institution = connNames.get(String(a.conn_id)) ?? a.org?.name ?? null;
        if (institution) institutions.add(institution);
        const id = accountKey(conn, a);
        const existing = d.prepare('SELECT type FROM accounts WHERE id = ?').get(id) as { type: string } | undefined;
        const acctRow = mapSimplefinAccount(a, conn, institution, existing?.type);
        acctRow.needs_attention = broken.has(String(a.conn_id)) ? 1 : 0;
        if (!seenAccounts.has(id)) {
          // type is the user's to correct (update_account); never overwrite it after the first guess
          upsert('accounts', [acctRow], ['id'], { preserveEdited: true, insertOnly: ['type'] });
          counts.accounts++;
          seenAccounts.add(id);
        }
        const from = takeoverDate(id);
        const txs: Json[] = (a.transactions ?? []);
        const rows = txs.map((t) => mapSimplefinTransaction(t, id, conn)).filter((r) => !from || String(r.date) >= from);
        d.transaction(() => {
          upsert('transactions', rows, ['id'], { preserveEdited: true, insertOnly: ['transfer', 'income'] });
          for (const r of rows) seenTx.add(String(r.id));
          // Pending rows re-post under new ids: drop pending rows in this window the Bridge no longer returns,
          // first handing what the user did to one (category, review, note…) to the row that replaced it.
          const ids = new Set(rows.map((r) => String(r.id)));
          const stale = (d.prepare(`SELECT id, amount, date, local_edits FROM transactions WHERE account_id = ? AND pending = 1 AND date BETWEEN ? AND ?`).all(id, start, end) as Array<{ id: string; amount: number; date: string; local_edits: string | null }>).filter((r) => !ids.has(r.id));
          const del = d.prepare('DELETE FROM transactions WHERE id = ? OR split_parent_id = ?');
          const carry = d.prepare(`UPDATE transactions SET (${CARRY.join(', ')}) = (SELECT ${CARRY.join(', ')} FROM transactions p WHERE p.id = ?) WHERE id = ? AND local_edits IS NULL`);
          const claimed = new Set<string>();
          for (const r of stale) {
            if (r.local_edits) {
              const twin = rows.find((x) => !claimed.has(String(x.id)) && !x.pending && Math.abs(Number(x.amount) - r.amount) < 0.005 && Math.abs(Date.parse(String(x.date)) - Date.parse(r.date)) <= 5 * 86400000);
              if (twin) { carry.run(r.id, twin.id); claimed.add(String(twin.id)); }
            }
            counts.removed += del.run(r.id, r.id).changes;
          }
        })();
        if (Array.isArray(a.holdings) && a.holdings.length) {
          const hs: Row[] = a.holdings.map((h: Json) => ({
            id: `${id}:${h.id ?? h.symbol ?? h.description}`,
            account_id: id,
            security_id: h.id ?? null,
            ticker: h.symbol ?? null,
            name: h.description ?? h.symbol ?? 'Holding',
            quantity: num(h.shares),
            price: num(h.shares) ? (num(h.market_value) ?? 0) / (num(h.shares) as number) : null,
            value: num(h.market_value),
            cost_basis: num(h.cost_basis),
            raw: h,
          }));
          d.transaction(() => {
            d.prepare('DELETE FROM holdings WHERE account_id = ?').run(id);
            upsert('holdings', hs);
            for (const x of hs) seenHoldings.add(String(x.id));
          })();
        }
      }
    }

    counts.transactions = seenTx.size;
    if (seenHoldings.size) counts.holdings = seenHoldings.size;
    updateConnection(conn.id, { raw: JSON.stringify({ ...raw, institutions: [...institutions].sort() }), institution: institutions.size === 1 ? [...institutions][0] : 'SimpleFIN Bridge' });
    if (broken.size) {
      const names = [...new Set(broken.values())];
      return { counts, warnings, status: 'needs_reauth', error: `${names.join(', ')} need${names.length === 1 ? 's' : ''} you to sign in again on the SimpleFIN Bridge (${BRIDGE_URL}). Other accounts synced.` };
    }
    return { counts, warnings };
  },
};
