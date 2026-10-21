/**
 * Plaid: the aggregator Copilot itself mostly uses. Daybook talks to Plaid's REST API directly (no SDK).
 *
 *  Link (in the browser) → public_token → /item/public_token/exchange → access_token, stored encrypted.
 *  Each sync: /accounts/get (cached balances, free) → /transactions/sync from the saved cursor
 *  → /investments/holdings/get when the Item has investment accounts.
 *
 * Plaid's amount convention is Daybook's (positive = money out), so amounts are stored as they come.
 * Without a public URL there are no webhooks; Daybook polls, and broken logins surface as
 * ITEM_LOGIN_REQUIRED from these calls (status needs_reauth → Link in update mode).
 */
import { config } from '../config.js';
import { getDb, nowIso, upsert, type Row } from '../db.js';
import { normalizeAccountType } from './copilot.js';
import { createConnection, getConnection, listConnectionRows, connectionSecret, updateConnection, type ConnectionRow } from './connections.js';
import { categoryForPfc, isTransferPfc, takeoverDate } from './enrich.js';
import { ConnectionError, type DirectProvider, type FetchLike, type ProviderResult } from './provider.js';

type Json = Record<string, any>;

let fetchImpl: FetchLike = (url, init) => fetch(url, init);
/** For tests. */
export function _setPlaidFetch(f: FetchLike): void {
  fetchImpl = f;
}

const REAUTH_CODES = new Set(['ITEM_LOGIN_REQUIRED', 'PENDING_EXPIRATION', 'PENDING_DISCONNECT', 'INVALID_CREDENTIALS', 'INVALID_MFA', 'ITEM_LOCKED', 'USER_SETUP_REQUIRED', 'ACCESS_NOT_GRANTED', 'INSUFFICIENT_CREDENTIALS', 'NO_ACCOUNTS']);
const SOFT_CODES = new Set(['PRODUCTS_NOT_SUPPORTED', 'NO_INVESTMENT_ACCOUNTS', 'PRODUCT_NOT_ENABLED', 'ADDITIONAL_CONSENT_REQUIRED', 'PRODUCT_NOT_READY', 'INVALID_PRODUCT', 'PRODUCTS_NOT_READY']);

export class PlaidError extends Error {
  constructor(readonly code: string, readonly type: string, message: string) {
    super(message);
  }
}

function baseUrl(): string {
  return config.plaid.env === 'production' ? 'https://production.plaid.com' : 'https://sandbox.plaid.com';
}

export async function plaidPost(path: string, body: Json): Promise<Json> {
  if (!config.plaid.configured) throw new ConnectionError('Plaid is not set up: add PLAID_CLIENT_ID and PLAID_SECRET to .env and restart Daybook.');
  const res = await fetchImpl(baseUrl() + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'PLAID-CLIENT-ID': config.plaid.clientId, 'PLAID-SECRET': config.plaid.secret, 'Plaid-Version': '2020-09-14' },
    body: JSON.stringify(body),
  });
  let json: Json = {};
  try {
    json = (await res.json()) as Json;
  } catch {
    // fall through with an empty body
  }
  if (!res.ok || json.error_code) {
    const code = String(json.error_code ?? `HTTP_${res.status}`);
    throw new PlaidError(code, String(json.error_type ?? 'API_ERROR'), `${path}: ${json.display_message || json.error_message || res.statusText} (${code})`);
  }
  return json;
}

function asConnectionError(e: unknown): unknown {
  if (e instanceof PlaidError && REAUTH_CODES.has(e.code)) {
    return new ConnectionError(`The bank needs you to sign in again (${e.code}). Use Fix connection.`, 'needs_reauth', e.code);
  }
  return e;
}

// ---------- Link ----------

/** A link_token for Plaid Link. With a connection id, Link opens in update mode to repair that login. */
export async function createLinkToken(connectionId?: string): Promise<{ link_token: string; expiration: string; mode: 'new' | 'update' }> {
  const body: Json = {
    client_name: 'Daybook',
    language: 'en',
    country_codes: ['US', 'CA'],
    user: { client_user_id: 'keel-owner' },
  };
  if (config.plaidRedirectUri) body.redirect_uri = config.plaidRedirectUri;
  if (connectionId) {
    body.access_token = connectionSecret(getConnection(connectionId));
    // Lets the user add accounts they skipped the first time, without creating a new Item.
    body.update = { account_selection_enabled: true };
  } else {
    body.products = ['transactions'];
    body.optional_products = ['investments'];
    // Fixed at link time: ask for the full two years Plaid allows.
    body.transactions = { days_requested: 730 };
  }
  const r = await plaidPost('/link/token/create', body);
  return { link_token: r.link_token, expiration: r.expiration, mode: connectionId ? 'update' : 'new' };
}

/** Finish Link: swap the public_token for an access token and store it. */
export async function exchangePublicToken(publicToken: string, institution?: { name?: string | null; institution_id?: string | null }): Promise<{ connection: ConnectionRow; duplicate_of: string | null }> {
  const r = await plaidPost('/item/public_token/exchange', { public_token: publicToken });
  const instId = institution?.institution_id ?? null;
  const dup = instId ? listConnectionRows().find((c) => c.provider === 'plaid' && c.institution_id === instId) : undefined;
  const conn = createConnection('plaid', r.access_token, { institution: institution?.name ?? null, institution_id: instId, raw: { item_id: r.item_id, env: config.plaid.env } });
  return { connection: conn, duplicate_of: dup?.id ?? null };
}

/** Revoke the Item at Plaid (stops billing on paid plans). Trial slots are not given back. */
export async function removeItem(conn: ConnectionRow): Promise<void> {
  try {
    await plaidPost('/item/remove', { access_token: connectionSecret(conn) });
  } catch (e) {
    // An Item Plaid no longer knows about is already gone.
    if (!(e instanceof PlaidError && (e.code === 'ITEM_NOT_FOUND' || e.code === 'INVALID_ACCESS_TOKEN'))) throw e;
  }
}

// ---------- mapping ----------

export function plaidAccountId(accountId: string): string {
  return `plaid:${accountId}`;
}

export function mapPlaidAccount(a: Json, conn: ConnectionRow): Row {
  const b = a.balances ?? {};
  const type = normalizeAccountType(String(a.type ?? ''), a.subtype ?? undefined);
  const current = Number(b.current ?? b.available ?? 0);
  return {
    id: plaidAccountId(a.account_id),
    name: a.name ?? a.official_name ?? 'Account',
    official_name: a.official_name ?? null,
    mask: a.mask ?? null,
    type,
    subtype: a.subtype ?? null,
    institution: conn.institution,
    // Plaid reports credit and loan balances as the positive amount owed, which is how Daybook stores them.
    balance: Number.isFinite(current) ? current : 0,
    available: b.available ?? null,
    limit_amt: b.limit ?? null,
    currency: b.iso_currency_code ?? b.unofficial_currency_code ?? 'USD',
    raw: a,
    updated_at: nowIso(),
    source: 'plaid',
    connection_id: conn.id,
    balance_date: b.last_updated_datetime ?? nowIso(),
    needs_attention: 0,
  };
}

export function mapPlaidTransaction(t: Json, conn: ConnectionRow): Row {
  const pfc = t.personal_finance_category ?? {};
  const transfer = isTransferPfc(pfc.primary, pfc.detailed);
  const amount = Math.round(Number(t.amount ?? 0) * 100) / 100;
  const income = !transfer && (String(pfc.primary ?? '').toUpperCase() === 'INCOME' || amount < 0) ? 1 : 0;
  return {
    id: `plaid:${t.transaction_id}`,
    date: t.date,
    name: t.merchant_name || t.name || t.original_description || 'Transaction',
    original_name: t.original_description ?? t.name ?? null,
    amount,
    account_id: plaidAccountId(t.account_id),
    pending: t.pending ? 1 : 0,
    category_id: categoryForPfc(pfc.detailed, pfc.primary),
    transfer: transfer ? 1 : 0,
    income,
    provider_category: pfc.detailed ?? pfc.primary ?? null,
    source: 'plaid',
    connection_id: conn.id,
    raw: t,
    updated_at: nowIso(),
  };
}

/** Columns a re-sync must not overwrite: Daybook's (or the user's) judgement, not the bank's. */
const TX_INSERT_ONLY = ['category_id', 'transfer', 'income'];
/** Carried from a pending row to the posted row that replaces it. */
const CARRY = ['category_id', 'reviewed', 'excluded', 'note', 'tags', 'goal_id', 'transfer', 'income', 'local_edits'];

// ---------- sync ----------

async function syncTransactions(conn: ConnectionRow, token: string, counts: Record<string, number>): Promise<string | null> {
  const start = conn.cursor ?? undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    let cursor = start;
    const added: Json[] = [], modified: Json[] = [], removed: string[] = [];
    try {
      for (let page = 0; page < 200; page++) {
        const r = await plaidPost('/transactions/sync', { access_token: token, ...(cursor ? { cursor } : {}), count: 500, options: { include_original_description: true } });
        added.push(...(r.added ?? []));
        modified.push(...(r.modified ?? []));
        removed.push(...(r.removed ?? []).map((x: Json) => x.transaction_id));
        cursor = r.next_cursor;
        if (!r.has_more) break;
      }
    } catch (e) {
      if (e instanceof PlaidError && e.code === 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION') continue;
      throw e;
    }
    applyTransactions(conn, added, modified, removed, counts);
    return cursor ?? null;
  }
  throw new ConnectionError('Plaid kept changing transactions mid-sync; try again in a minute.');
}

export function applyTransactions(conn: ConnectionRow, added: Json[], modified: Json[], removed: string[], counts: Record<string, number>): void {
  const d = getDb();
  const cutoff = new Map<string, string | null>();
  const keep = (t: Json) => {
    const acct = plaidAccountId(t.account_id);
    if (!cutoff.has(acct)) cutoff.set(acct, takeoverDate(acct));
    const from = cutoff.get(acct);
    return !from || t.date >= from;
  };
  const rows = [...added, ...modified].filter(keep).map((t) => mapPlaidTransaction(t, conn));
  const pendingLinks = added.filter((t) => t.pending_transaction_id).map((t) => [`plaid:${t.transaction_id}`, `plaid:${t.pending_transaction_id}`] as const);
  d.transaction(() => {
    counts.transactions = (counts.transactions ?? 0) + upsert('transactions', rows, ['id'], { preserveEdited: true, insertOnly: TX_INSERT_ONLY });
    // A posted row replaces its pending row: keep what the user did to the pending one.
    const carry = d.prepare(`UPDATE transactions SET (${CARRY.join(', ')}) = (SELECT ${CARRY.join(', ')} FROM transactions p WHERE p.id = ?) WHERE id = ? AND EXISTS (SELECT 1 FROM transactions p WHERE p.id = ?)`);
    // A rename is carried only if the user made it; otherwise the posted row keeps Plaid's (often better) name.
    const carryName = d.prepare(`UPDATE transactions SET name = (SELECT name FROM transactions p WHERE p.id = ?) WHERE id = ? AND EXISTS (SELECT 1 FROM transactions p WHERE p.id = ? AND json_extract(p.local_edits, '$.name') IS NOT NULL)`);
    for (const [posted, pending] of pendingLinks) {
      carry.run(pending, posted, pending);
      carryName.run(pending, posted, pending);
    }
    const del = d.prepare('DELETE FROM transactions WHERE id = ? OR split_parent_id = ?');
    let n = 0;
    for (const id of removed) n += del.run(`plaid:${id}`, `plaid:${id}`).changes;
    counts.removed = (counts.removed ?? 0) + n;
  })();
}

async function syncHoldings(conn: ConnectionRow, token: string, counts: Record<string, number>, warnings: string[]): Promise<void> {
  const d = getDb();
  const invest = (d.prepare(`SELECT COUNT(*) n FROM accounts WHERE connection_id = ? AND type = 'investment'`).get(conn.id) as { n: number }).n;
  if (!invest) return;
  try {
    const r = await plaidPost('/investments/holdings/get', { access_token: token });
    const secs = new Map<string, Json>((r.securities ?? []).map((s: Json) => [s.security_id, s]));
    const rows: Row[] = (r.holdings ?? []).map((h: Json) => {
      const s = secs.get(h.security_id) ?? {};
      return {
        id: `plaid:${h.account_id}:${h.security_id}`,
        account_id: plaidAccountId(h.account_id),
        security_id: h.security_id ?? null,
        ticker: s.ticker_symbol ?? null,
        name: s.name ?? s.ticker_symbol ?? 'Holding',
        quantity: h.quantity ?? null,
        price: h.institution_price ?? s.close_price ?? null,
        value: h.institution_value ?? null,
        cost_basis: h.cost_basis ?? null,
        raw: { holding: h, security: s },
      };
    });
    d.transaction(() => {
      d.prepare('DELETE FROM holdings WHERE account_id IN (SELECT id FROM accounts WHERE connection_id = ?)').run(conn.id);
      counts.holdings = upsert('holdings', rows);
    })();
  } catch (e) {
    if (e instanceof PlaidError && SOFT_CODES.has(e.code)) warnings.push(`holdings: ${e.code}`);
    else throw e;
  }
}

export const plaidProvider: DirectProvider = {
  id: 'plaid',
  label: 'Plaid',
  // Plaid refreshes from banks 1–4 times a day; polling is free (billing is per Item per month).
  minIntervalMinutes: 60,
  forcedFloorMinutes: 0,
  async sync(conn: ConnectionRow): Promise<ProviderResult> {
    const counts: Record<string, number> = {};
    const warnings: string[] = [];
    const token = connectionSecret(conn);
    try {
      const acc = await plaidPost('/accounts/get', { access_token: token });
      const item = acc.item ?? {};
      if (item.consent_expiration_time !== undefined) updateConnection(conn.id, { consent_expires_at: item.consent_expiration_time ?? null });
      if (!conn.institution && item.institution_id) {
        try {
          const inst = await plaidPost('/institutions/get_by_id', { institution_id: item.institution_id, country_codes: ['US', 'CA'] });
          conn = { ...conn, institution: inst.institution?.name ?? null, institution_id: item.institution_id };
          updateConnection(conn.id, { institution: conn.institution, institution_id: conn.institution_id });
        } catch {
          // a name is nice to have
        }
      }
      counts.accounts = upsert('accounts', (acc.accounts ?? []).map((a: Json) => mapPlaidAccount(a, conn)), ['id'], { preserveEdited: true });
      if (item.error?.error_code && REAUTH_CODES.has(item.error.error_code)) {
        throw new PlaidError(item.error.error_code, item.error.error_type ?? 'ITEM_ERROR', item.error.error_message ?? item.error.error_code);
      }
      const cursor = await syncTransactions(conn, token, counts);
      updateConnection(conn.id, { cursor });
      await syncHoldings(conn, token, counts, warnings);
    } catch (e) {
      throw asConnectionError(e);
    }
    return { counts, warnings };
  },
};
