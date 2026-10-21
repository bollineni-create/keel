/**
 * The connections table: one row per direct bank connection (a Plaid Item, a SimpleFIN access URL).
 * Secrets are sealed with secrets.ts and never leave this module except to the provider that owns them.
 */
import { randomUUID } from 'node:crypto';
import { getDb, nowIso } from '../db.js';
import { decrypt, encrypt, redact } from './secrets.js';

export type ProviderId = 'plaid' | 'simplefin';
export type ConnectionStatus = 'ok' | 'needs_reauth' | 'error' | 'syncing';

export interface ConnectionRow {
  id: string; provider: ProviderId; institution: string | null; institution_id: string | null;
  status: ConnectionStatus; error: string | null; secret: string; cursor: string | null;
  created_at: string; last_synced: string | null; last_attempt: string | null; consent_expires_at: string | null; raw: string | null;
}

/** What routes, tools and the UI see: no secret, no cursor. */
export interface PublicConnection {
  id: string; provider: ProviderId; institution: string | null; status: ConnectionStatus; error: string | null;
  created_at: string; last_synced: string | null; last_attempt: string | null; consent_expires_at: string | null;
  accounts: Array<{ id: string; name: string; mask: string | null; type: string; balance: number; needs_attention: number }>;
}

export function connectionCount(): number {
  return (getDb().prepare('SELECT COUNT(*) n FROM connections').get() as { n: number }).n;
}

export function listConnectionRows(): ConnectionRow[] {
  return getDb().prepare('SELECT * FROM connections ORDER BY created_at').all() as ConnectionRow[];
}

export function getConnection(id: string): ConnectionRow {
  const row = getDb().prepare('SELECT * FROM connections WHERE id = ?').get(id) as ConnectionRow | undefined;
  if (!row) throw new Error(`No connection ${id}`);
  return row;
}

export function publicConnection(c: ConnectionRow): PublicConnection {
  const accounts = getDb().prepare('SELECT id, name, mask, type, balance, needs_attention FROM accounts WHERE connection_id = ? ORDER BY type, name').all(c.id) as PublicConnection['accounts'];
  const { secret: _s, cursor: _c, raw: _r, institution_id: _i, ...rest } = c;
  return { ...rest, accounts };
}

export function listConnections(): PublicConnection[] {
  return listConnectionRows().map(publicConnection);
}

export function createConnection(provider: ProviderId, secret: string, fields: { institution?: string | null; institution_id?: string | null; raw?: unknown } = {}): ConnectionRow {
  const id = `${provider === 'plaid' ? 'plaid' : 'sfin'}-${randomUUID().slice(0, 8)}`;
  getDb().prepare('INSERT INTO connections(id, provider, institution, institution_id, status, secret, created_at, raw) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, provider, fields.institution ?? null, fields.institution_id ?? null, 'ok', encrypt(secret), nowIso(), fields.raw === undefined ? null : JSON.stringify(fields.raw));
  return getConnection(id);
}

export function connectionSecret(c: ConnectionRow): string {
  return decrypt(c.secret);
}

export function updateConnection(id: string, fields: Partial<Pick<ConnectionRow, 'institution' | 'institution_id' | 'status' | 'error' | 'cursor' | 'last_synced' | 'last_attempt' | 'consent_expires_at' | 'raw'>>): void {
  const cols = Object.keys(fields) as Array<keyof typeof fields>;
  if (!cols.length) return;
  const vals = cols.map((c) => (c === 'error' && fields.error ? redact(fields.error) : fields[c]));
  getDb().prepare(`UPDATE connections SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...vals, id);
}

export function rawOf<T = Record<string, unknown>>(c: ConnectionRow): T {
  try {
    return (c.raw ? JSON.parse(c.raw) : {}) as T;
  } catch {
    return {} as T;
  }
}

/** Remove a connection; optionally its accounts and their transactions, balances and holdings. */
export function deleteConnection(id: string, deleteData: boolean): { accounts: number; transactions: number } {
  const d = getDb();
  let accounts = 0, transactions = 0;
  d.transaction(() => {
    if (deleteData) {
      const ids = (d.prepare('SELECT id FROM accounts WHERE connection_id = ?').all(id) as Array<{ id: string }>).map((r) => r.id);
      for (const a of ids) {
        transactions += d.prepare('DELETE FROM transactions WHERE account_id = ? OR split_parent_id IN (SELECT id FROM transactions WHERE account_id = ?)').run(a, a).changes;
        d.prepare('DELETE FROM balance_history WHERE account_id = ?').run(a);
        d.prepare('DELETE FROM holdings WHERE account_id = ?').run(a);
        d.prepare('UPDATE accounts SET superseded_by = NULL, superseded_from = NULL, hidden = 0 WHERE superseded_by = ?').run(a);
      }
      accounts = d.prepare('DELETE FROM accounts WHERE connection_id = ?').run(id).changes;
    } else {
      // Keep the history as a disconnected (manual) account.
      accounts = d.prepare(`UPDATE accounts SET connection_id = NULL, source = 'manual', needs_attention = 0 WHERE connection_id = ?`).run(id).changes;
      d.prepare('UPDATE transactions SET connection_id = NULL WHERE connection_id = ?').run(id);
    }
    d.prepare('DELETE FROM connections WHERE id = ?').run(id);
  })();
  return { accounts, transactions };
}
