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
  return db;
}

export function getMeta(key: string): string | undefined {
  const r = getDb().prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined;
  return r?.value;
}
export function setMeta(key: string, value: string): void {
  getDb().prepare('INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

/** Upsert helper: `cols` are the columns to write; conflict on `id` (or `pk`). */
export function upsert(table: string, rows: Row[], pk: string[] = ['id']): number {
  if (!rows.length) return 0;
  const d = getDb();
  const cols = Object.keys(rows[0]);
  const placeholders = cols.map(() => '?').join(',');
  const updates = cols.filter((c) => !pk.includes(c)).map((c) => `${c} = excluded.${c}`).join(',');
  const sql = `INSERT INTO ${table}(${cols.join(',')}) VALUES (${placeholders}) ON CONFLICT(${pk.join(',')}) DO UPDATE SET ${updates}`;
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

export function nowIso(): string {
  return new Date().toISOString();
}
