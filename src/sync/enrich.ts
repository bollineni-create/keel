/**
 * What Copilot did for us that a raw bank feed doesn't: a category tree, a first guess at each new
 * transaction's category, transfer pairing, and daily balance snapshots for the net-worth chart.
 * Runs after every direct-provider sync, on direct-provider rows only (Copilot rows already have all of it).
 */
import { getDb, nowIso, upsert } from '../db.js';

/** Starter tree for people without Copilot. Ids are `keel:` so they never collide with Copilot's. */
const DEFAULT_CATEGORIES: Array<[slug: string, name: string, parent: string | null, emoji: string, excluded?: 1]> = [
  ['food', 'Food & Drink', null, '🍽️'], ['groceries', 'Groceries', 'food', '🛒'], ['restaurants', 'Restaurants', 'food', '🍜'], ['coffee', 'Coffee', 'food', '☕'],
  ['housing', 'Housing', null, '🏠'], ['rent', 'Rent & Mortgage', 'housing', '🏠'], ['utilities', 'Utilities', 'housing', '💡'], ['home', 'Home Improvement', 'housing', '🔨'],
  ['transport', 'Transport', null, '🚗'], ['gas', 'Gas & Charging', 'transport', '⛽'], ['rideshare', 'Rideshare & Taxis', 'transport', '🚕'], ['parking', 'Parking & Tolls', 'transport', '🅿️'], ['transit', 'Public Transit', 'transport', '🚆'],
  ['shopping', 'Shopping', null, '🛍️'], ['subscriptions', 'Subscriptions', null, '📺'], ['health', 'Health', null, '💊'], ['personal', 'Personal Care', null, '💇'],
  ['travel', 'Travel', null, '✈️'], ['entertainment', 'Entertainment', null, '🎟️'], ['services', 'Services', null, '🧰'], ['fees', 'Fees', null, '🧾'],
  ['gifts', 'Gifts & Donations', null, '🎁'], ['taxes', 'Taxes & Government', null, '🏛️'],
  ['income', 'Income', null, '💵'], ['transfer', 'Transfers', null, '↔️', 1], ['payment', 'Credit Card Payment', 'transfer', '💳', 1],
];

/** Give the user a category tree if they have none (no Copilot). */
export function ensureCategories(): number {
  const d = getDb();
  if ((d.prepare('SELECT COUNT(*) n FROM categories').get() as { n: number }).n > 0) return 0;
  return upsert('categories', DEFAULT_CATEGORIES.map(([slug, name, parent, emoji, excluded]) => ({
    id: `keel:${slug}`, name, parent_id: parent ? `keel:${parent}` : null, emoji, color: null, excluded: excluded ?? 0, budget_amount: null, raw: null,
  })));
}

/**
 * Plaid personal_finance_category → words to look for in the user's own category names, most specific
 * first. Matching by name works for both Keel's starter tree and a Copilot tree.
 */
const PFC_HINTS: Array<[prefix: string, words: string[]]> = [
  ['FOOD_AND_DRINK_GROCERIES', ['grocer']], ['FOOD_AND_DRINK_COFFEE', ['coffee']], ['FOOD_AND_DRINK_FAST_FOOD', ['fast food', 'restaurant', 'dining']],
  ['FOOD_AND_DRINK_BEER_WINE_AND_LIQUOR', ['alcohol', 'bars', 'liquor', 'restaurant']], ['FOOD_AND_DRINK', ['restaurant', 'dining', 'food']],
  ['RENT_AND_UTILITIES_RENT', ['rent', 'mortgage', 'housing']], ['RENT_AND_UTILITIES', ['utilit', 'bills', 'housing']],
  ['LOAN_PAYMENTS_MORTGAGE_PAYMENT', ['mortgage', 'rent', 'housing']], ['LOAN_PAYMENTS_CREDIT_CARD_PAYMENT', ['credit card payment', 'payment', 'transfer']], ['LOAN_PAYMENTS', ['loan', 'payment', 'transfer']],
  ['TRANSPORTATION_GAS', ['gas', 'fuel']], ['TRANSPORTATION_TAXIS_AND_RIDE_SHARES', ['rideshare', 'taxi', 'uber']], ['TRANSPORTATION_PARKING', ['parking']], ['TRANSPORTATION_TOLLS', ['toll', 'parking']],
  ['TRANSPORTATION_PUBLIC_TRANSIT', ['transit']], ['TRANSPORTATION', ['transport', 'car', 'auto']],
  ['TRAVEL', ['travel', 'vacation']], ['ENTERTAINMENT_TV_AND_MOVIES', ['subscription', 'streaming', 'entertainment']], ['ENTERTAINMENT', ['entertainment', 'fun']],
  ['GENERAL_MERCHANDISE', ['shopping']], ['HOME_IMPROVEMENT', ['home improvement', 'home', 'housing']],
  ['MEDICAL', ['health', 'medical']], ['PERSONAL_CARE', ['personal care', 'health']],
  ['GENERAL_SERVICES', ['services', 'subscription']], ['GOVERNMENT_AND_NON_PROFIT_DONATIONS', ['gift', 'donation', 'charity']], ['GOVERNMENT_AND_NON_PROFIT', ['tax', 'government']],
  ['BANK_FEES', ['fee']], ['INCOME', ['income', 'paycheck', 'salary']], ['TRANSFER_IN', ['transfer']], ['TRANSFER_OUT', ['transfer']],
];

/** Plaid category → one of the user's category ids, or null. */
export function categoryForPfc(detailed: string | null | undefined, primary: string | null | undefined): string | null {
  const key = (detailed || primary || '').toUpperCase();
  if (!key) return null;
  const cats = getDb().prepare('SELECT id, name FROM categories').all() as Array<{ id: string; name: string }>;
  for (const [prefix, words] of PFC_HINTS) {
    if (!key.startsWith(prefix)) continue;
    for (const w of words) {
      const hit = cats.find((c) => c.name.toLowerCase().includes(w));
      if (hit) return hit.id;
    }
  }
  return null;
}

export function isTransferPfc(primary: string | null | undefined, detailed?: string | null): boolean {
  const p = (primary || '').toUpperCase();
  return p === 'TRANSFER_IN' || p === 'TRANSFER_OUT' || (detailed || '').toUpperCase() === 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT';
}

/**
 * Uncategorized direct-provider rows take the category the user last gave the same merchant (any source,
 * Copilot history included). Rows the user already categorized are never touched.
 */
export function categorizeFromHistory(connectionId: string): number {
  const d = getDb();
  const r = d.prepare(`UPDATE transactions SET category_id = (
      SELECT p.category_id FROM transactions p
      WHERE lower(p.name) = lower(transactions.name) AND p.category_id IS NOT NULL AND p.id != transactions.id
      ORDER BY p.date DESC LIMIT 1)
    WHERE connection_id = ? AND category_id IS NULL AND json_extract(local_edits, '$.category_id') IS NULL
      AND EXISTS (SELECT 1 FROM transactions p WHERE lower(p.name) = lower(transactions.name) AND p.category_id IS NOT NULL AND p.id != transactions.id)`).run(connectionId);
  return r.changes;
}

const TRANSFER_WORDS = /\b(transfer|xfer|payment|pymt|pmt|autopay|auto pay|epay|e-payment|ach|online banking|thank you)\b/i;

/**
 * Pair a payment out of one of the user's accounts with the matching credit into another (same amount,
 * opposite sign, within 4 days) and mark both as transfers, so a card payment isn't counted as both
 * spending and income. Conservative: the match must be unambiguous from both sides (or made so by a
 * transfer-ish description), and at least one side must read like a transfer.
 */
export function matchTransfers(connectionId: string, sinceDays = 60): number {
  const d = getDb();
  const since = new Date(Date.now() - sinceDays * 86400000).toISOString().slice(0, 10);
  type Tx = { id: string; date: string; name: string; original_name: string | null; amount: number; account_id: string; local_edits: string | null };
  const cols = 'id, date, name, original_name, amount, account_id, local_edits';
  const mine = d.prepare(`SELECT ${cols} FROM transactions WHERE connection_id = ? AND transfer = 0 AND excluded = 0 AND split = 0 AND date >= ? AND amount != 0 ORDER BY date`).all(connectionId, since) as Tx[];
  const opposite = d.prepare(`SELECT ${cols} FROM transactions WHERE transfer = 0 AND excluded = 0 AND split = 0 AND account_id != ? AND round(amount, 2) = round(?, 2)
      AND date BETWEEN date(?, '-4 days') AND date(?, '+4 days')`);
  const stillOpen = d.prepare('SELECT transfer FROM transactions WHERE id = ?');
  const mark = d.prepare('UPDATE transactions SET transfer = 1, income = 0, updated_at = ? WHERE id = ?');
  const text = (t: Tx) => `${t.name} ${t.original_name ?? ''}`;
  const edited = (t: Tx) => Boolean(t.local_edits && JSON.parse(t.local_edits).transfer);
  const candidates = (t: Tx) => (opposite.all(t.account_id, -t.amount, t.date, t.date) as Tx[]).filter((x) => !edited(x));
  const pick = (list: Tx[]): Tx | null => {
    if (list.length === 1) return list[0];
    const worded = list.filter((x) => TRANSFER_WORDS.test(text(x)));
    return worded.length === 1 ? worded[0] : null;
  };
  let n = 0;
  d.transaction(() => {
    for (const x of mine) {
      if (edited(x) || (stillOpen.get(x.id) as { transfer: number }).transfer) continue;
      const y = pick(candidates(x));
      if (!y || pick(candidates(y))?.id !== x.id) continue;
      if (!TRANSFER_WORDS.test(`${text(x)} ${text(y)}`)) continue;
      mark.run(nowIso(), x.id);
      mark.run(nowIso(), y.id);
      n += 2;
    }
  })();
  return n;
}

/** Today's balance for every account of this connection, so net-worth history builds up over time. */
export function snapshotBalances(connectionId: string): number {
  const d = getDb();
  const today = new Date().toISOString().slice(0, 10);
  const rows = d.prepare('SELECT id, balance FROM accounts WHERE connection_id = ?').all(connectionId) as Array<{ id: string; balance: number }>;
  return upsert('balance_history', rows.map((r) => ({ date: today, account_id: r.id, balance: r.balance })), ['date', 'account_id']);
}

/**
 * A new connection has transactions going back months but only today's balance. Walk the balance back
 * through the transactions so the net-worth chart doesn't jump on the day a bank was linked. Fills only
 * days with no history yet; skips investment accounts (market moves aren't transactions).
 */
export function backfillBalances(connectionId: string): number {
  const d = getDb();
  const accts = d.prepare(`SELECT id, type, balance FROM accounts WHERE connection_id = ? AND type != 'investment'`).all(connectionId) as Array<{ id: string; type: string; balance: number }>;
  const days = d.prepare(`SELECT date, SUM(amount) total FROM transactions WHERE account_id = ? AND pending = 0 AND split_parent_id IS NULL GROUP BY date ORDER BY date DESC`);
  const insert = d.prepare('INSERT OR IGNORE INTO balance_history(date, account_id, balance) VALUES (?,?,?)');
  const today = new Date().toISOString().slice(0, 10);
  let n = 0;
  d.transaction(() => {
    for (const a of accts) {
      // Keel amounts: positive = money out. That lowers a cash balance and raises what's owed on a card.
      const owed = a.type === 'credit' || a.type === 'loan';
      let bal = a.balance; // end of today
      let last: string | null = null;
      for (const r of days.all(a.id) as Array<{ date: string; total: number }>) {
        if (r.date > today) continue;
        n += insert.run(r.date, a.id, owed ? Math.max(0, bal) : bal).changes; // end of that day
        bal = Math.round((owed ? bal - r.total : bal + r.total) * 100) / 100; // end of the day before
        last = r.date;
      }
      if (last) n += insert.run(new Date(Date.parse(last + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10), a.id, owed ? Math.max(0, bal) : bal).changes;
    }
  })();
  return n;
}

/** The day after which a superseded Copilot account stops supplying rows (see db.ts superseded_from). */
export function supersededCutoffs(): Map<string, string> {
  const rows = getDb().prepare('SELECT id, superseded_from FROM accounts WHERE superseded_by IS NOT NULL AND superseded_from IS NOT NULL').all() as Array<{ id: string; superseded_from: string }>;
  return new Map(rows.map((r) => [r.id, r.superseded_from]));
}

/** For a direct account that took over from a Copilot account: rows before this date belong to Copilot. */
export function takeoverDate(directAccountId: string): string | null {
  const r = getDb().prepare('SELECT superseded_from FROM accounts WHERE superseded_by = ?').get(directAccountId) as { superseded_from: string } | undefined;
  return r?.superseded_from ?? null;
}

/**
 * Copilot accounts that look like the same real account as one of this connection's accounts
 * (same last four digits and type), and haven't been switched over yet.
 */
export function duplicateCandidates(connectionId: string): Array<{ account_id: string; account_name: string; copilot_account_id: string; copilot_account_name: string; mask: string }> {
  return getDb().prepare(`SELECT a.id account_id, a.name account_name, c.id copilot_account_id, c.name copilot_account_name, a.mask mask
    FROM accounts a JOIN accounts c ON c.mask = a.mask AND c.type = a.type AND c.source = 'copilot' AND c.superseded_by IS NULL AND c.closed = 0
    WHERE a.connection_id = ? AND a.mask IS NOT NULL AND a.mask != ''
      AND NOT EXISTS (SELECT 1 FROM accounts x WHERE x.superseded_by = a.id)`).all(connectionId) as any[];
}

/**
 * Switch one real account from Copilot to a direct connection without double counting: Copilot keeps
 * supplying rows dated before `from` (default today), the direct account everything from `from` on.
 * The Copilot account is hidden; its balance history is copied so the net-worth chart stays continuous.
 */
export function supersedeAccount(directAccountId: string, copilotAccountId: string, from = new Date().toISOString().slice(0, 10)): { moved_history: number; dropped_direct: number; dropped_copilot: number } {
  const d = getDb();
  const direct = d.prepare('SELECT id, connection_id FROM accounts WHERE id = ?').get(directAccountId) as { id: string; connection_id: string | null } | undefined;
  const cop = d.prepare('SELECT id, source FROM accounts WHERE id = ?').get(copilotAccountId) as { id: string; source: string } | undefined;
  if (!direct?.connection_id) throw new Error(`${directAccountId} is not an account from a bank connection`);
  if (!cop || cop.source !== 'copilot') throw new Error(`${copilotAccountId} is not a Copilot account`);
  if (directAccountId === copilotAccountId) throw new Error('Pick two different accounts');
  let moved = 0, droppedDirect = 0, droppedCopilot = 0;
  d.transaction(() => {
    d.prepare('UPDATE accounts SET superseded_by = ?, superseded_from = ?, hidden = 1 WHERE id = ?').run(directAccountId, from, copilotAccountId);
    droppedDirect = d.prepare('DELETE FROM transactions WHERE account_id = ? AND date < ? AND local_edits IS NULL').run(directAccountId, from).changes;
    droppedCopilot = d.prepare('DELETE FROM transactions WHERE account_id = ? AND date >= ?').run(copilotAccountId, from).changes;
    moved = d.prepare('INSERT OR IGNORE INTO balance_history(date, account_id, balance) SELECT date, ?, balance FROM balance_history WHERE account_id = ? AND date < ?').run(directAccountId, copilotAccountId, from).changes;
  })();
  return { moved_history: moved, dropped_direct: droppedDirect, dropped_copilot: droppedCopilot };
}
