/**
 * SQLite storage for Keel.
 *
 * Amount convention follows Copilot Money: positive = money OUT (spend),
 * negative = money IN (income, refunds). Every query in queries.ts assumes this.
 */
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

export type Row = Record<string, unknown>;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  name TEXT, official_name TEXT, mask TEXT,
  type TEXT, subtype TEXT, institution TEXT,
  balance REAL NOT NULL DEFAULT 0, available REAL, limit_amt REAL,
  currency TEXT DEFAULT 'USD', hidden INTEGER DEFAULT 0, closed INTEGER DEFAULT 0,
  raw TEXT, updated_at TEXT
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL, parent_id TEXT, emoji TEXT, color TEXT,
  excluded INTEGER DEFAULT 0, budget_amount REAL,
  raw TEXT
);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL, name TEXT NOT NULL, original_name TEXT,
  amount REAL NOT NULL,
  account_id TEXT, category_id TEXT,
  pending INTEGER DEFAULT 0, reviewed INTEGER DEFAULT 0, excluded INTEGER DEFAULT 0,
  transfer INTEGER DEFAULT 0, income INTEGER DEFAULT 0,
  note TEXT, recurring_id TEXT, tags TEXT,
  split INTEGER DEFAULT 0, split_parent_id TEXT, goal_id TEXT,
  source TEXT DEFAULT 'copilot', raw TEXT, updated_at TEXT
);
CREATE INDEX IF NOT EXISTS tx_date ON transactions(date);
CREATE INDEX IF NOT EXISTS tx_cat ON transactions(category_id);
CREATE INDEX IF NOT EXISTS tx_acct ON transactions(account_id);

CREATE TABLE IF NOT EXISTS budgets (
  id TEXT PRIMARY KEY, category_id TEXT, name TEXT,
  amount REAL, period TEXT DEFAULT 'monthly', amounts TEXT, raw TEXT
);

CREATE TABLE IF NOT EXISTS recurrings (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL, amount REAL, frequency TEXT, next_date TEXT, last_date TEXT,
  state TEXT DEFAULT 'active', category_id TEXT, account_id TEXT, raw TEXT
);

CREATE TABLE IF NOT EXISTS holdings (
  id TEXT PRIMARY KEY,
  account_id TEXT, security_id TEXT, ticker TEXT, name TEXT,
  quantity REAL, price REAL, value REAL, cost_basis REAL, raw TEXT
);

CREATE TABLE IF NOT EXISTS balance_history (
  date TEXT NOT NULL, account_id TEXT NOT NULL, balance REAL,
  PRIMARY KEY (date, account_id)
);

CREATE TABLE IF NOT EXISTS goals (
  id TEXT PRIMARY KEY, name TEXT, target REAL, current REAL, due TEXT, raw TEXT
);

CREATE TABLE IF NOT EXISTS pending_writes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL, tool TEXT NOT NULL, args TEXT NOT NULL,
  status TEXT DEFAULT 'queued', error TEXT
);

-- Direct bank connections (Plaid Items, SimpleFIN access URLs). secret is AES-GCM ciphertext (src/sync/secrets.ts).
CREATE TABLE IF NOT EXISTS connections (
  id TEXT PRIMARY KEY, provider TEXT NOT NULL,
  institution TEXT, institution_id TEXT,
  status TEXT DEFAULT 'ok', error TEXT,
  secret TEXT NOT NULL, cursor TEXT,
  created_at TEXT NOT NULL, last_synced TEXT, last_attempt TEXT, consent_expires_at TEXT,
  raw TEXT
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS chat_conv ON chat_messages(conversation_id);
`;

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  db = new Database(config.dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  migrate(db);
  lockDown();
  return db;
}

/** Columns added after a table first shipped; CREATE TABLE IF NOT EXISTS won't add them to an existing db. */
const ADDED_COLUMNS: Array<[table: string, column: string, decl: string]> = [
  ['transactions', 'split', 'INTEGER DEFAULT 0'],
  ['transactions', 'split_parent_id', 'TEXT'],
  ['transactions', 'goal_id', 'TEXT'],
  // {column: 1} for every column edited in Keel and not pushed upstream; sync leaves those columns alone.
  ['transactions', 'local_edits', 'TEXT'],
  ['transactions', 'connection_id', 'TEXT'],
  ['transactions', 'provider_category', 'TEXT'],
  ['accounts', 'local_edits', 'TEXT'],
  ['accounts', 'source', "TEXT DEFAULT 'copilot'"],
  ['accounts', 'connection_id', 'TEXT'],
  ['accounts', 'balance_date', 'TEXT'],
  ['accounts', 'needs_attention', 'INTEGER DEFAULT 0'],
  // A Copilot account replaced by a direct connection: Copilot keeps supplying rows dated before
  // superseded_from, the direct account (superseded_by) supplies everything from that day on.
  ['accounts', 'superseded_by', 'TEXT'],
  ['accounts', 'superseded_from', 'TEXT'],
];

function migrate(d: Database.Database): void {
  for (const [table, column, decl] of ADDED_COLUMNS) {
    const cols = d.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === column)) d.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
  }
  d.exec('CREATE INDEX IF NOT EXISTS tx_split_parent ON transactions(split_parent_id)');
  d.exec('CREATE INDEX IF NOT EXISTS tx_connection ON transactions(connection_id)');
}

/** The database holds bank-access tokens once connections exist: keep it readable by this user only. */
function lockDown(): void {
  try {
    fs.chmodSync(path.dirname(config.dbPath), 0o700);
    for (const f of [config.dbPath, `${config.dbPath}-wal`, `${config.dbPath}-shm`]) if (fs.existsSync(f)) fs.chmodSync(f, 0o600);
  } catch {
    // best effort (e.g. a read-only or foreign-owned directory)
  }
}

export function getMeta(key: string): string | undefined {
  const r = getDb().prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined;
  return r?.value;
}
export function setMeta(key: string, value: string): void {
  getDb().prepare('INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

export interface UpsertOptions {
  /** Keep any column the user edited in Keel (listed in the row's local_edits JSON). */
  preserveEdited?: boolean;
  /** Written when the row is new, never on conflict (e.g. a provider's first guess at a category). */
  insertOnly?: string[];
}

/** Upsert helper: `cols` are the columns to write; conflict on `id` (or `pk`). */
export function upsert(table: string, rows: Row[], pk: string[] = ['id'], opts: UpsertOptions = {}): number {
  if (!rows.length) return 0;
  const d = getDb();
  const cols = Object.keys(rows[0]);
  const placeholders = cols.map(() => '?').join(',');
  const set = (c: string) => (opts.preserveEdited ? `${c} = CASE WHEN json_extract(${table}.local_edits, '$.${c}') IS NULL THEN excluded.${c} ELSE ${table}.${c} END` : `${c} = excluded.${c}`);
  const updates = cols.filter((c) => !pk.includes(c) && !opts.insertOnly?.includes(c)).map(set).join(',');
  const sql = `INSERT INTO ${table}(${cols.join(',')}) VALUES (${placeholders}) ON CONFLICT(${pk.join(',')}) DO ${updates ? `UPDATE SET ${updates}` : 'NOTHING'}`;
  const stmt = d.prepare(sql);
  const run = d.transaction((rs: Row[]) => {
    for (const r of rs) stmt.run(cols.map((c) => toSql(r[c])));
  });
  run(rows);
  return rows.length;
}

function toSql(v: unknown): unknown {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v !== null && typeof v === 'object') return JSON.stringify(v);
  return v;
}

/** Record that the user edited these columns in Keel, so the next sync keeps them. */
export function markEdited(table: 'transactions' | 'accounts', id: string, columns: string[]): void {
  if (!columns.length) return;
  const patch = JSON.stringify(Object.fromEntries(columns.map((c) => [c, 1])));
  getDb().prepare(`UPDATE ${table} SET local_edits = json_patch(COALESCE(local_edits, '{}'), ?) WHERE id = ?`).run(patch, id);
}

export function nowIso(): string {
  return new Date().toISOString();
}
