/**
 * Read models over the SQLite store. Amount convention: positive = spend, negative = inflow.
 */
import { getDb, getMeta } from './db.js';

export const SPEND_FILTER = `excluded = 0 AND transfer = 0 AND income = 0 AND amount > 0`;
export const INCOME_FILTER = `excluded = 0 AND transfer = 0 AND (income = 1 OR amount < 0) AND amount < 0`;

export function monthKey(d = new Date()): string {
  return d.toISOString().slice(0, 7);
}
export function monthRange(month: string): { start: string; end: string } {
  const [y, m] = month.split('-').map(Number);
  const start = `${month}-01`;
  const endDate = new Date(Date.UTC(y, m, 0));
  return { start, end: endDate.toISOString().slice(0, 10) };
}
export function daysLeftInMonth(month: string): number {
  const today = new Date();
  if (monthKey(today) !== month) return 0;
  const { end } = monthRange(month);
  return Math.max(0, Math.round((Date.parse(end) - Date.parse(today.toISOString().slice(0, 10))) / 86400000));
}

// ---------- accounts & net worth ----------

export interface AccountRow {
  id: string; name: string; mask: string | null; type: string; subtype: string | null; institution: string | null;
  balance: number; available: number | null; limit_amt: number | null; currency: string; hidden: number; closed: number; updated_at: string;
}

export function listAccounts(includeHidden = false): AccountRow[] {
  return getDb().prepare(`SELECT id,name,mask,type,subtype,institution,balance,available,limit_amt,currency,hidden,closed,updated_at FROM accounts WHERE closed = 0 ${includeHidden ? '' : 'AND hidden = 0'} ORDER BY type, name`).all() as AccountRow[];
}

export const LIABILITY_TYPES = new Set(['credit', 'loan']);

export function netWorth(): { total: number; assets: number; liabilities: number; byType: Record<string, number> } {
  const byType: Record<string, number> = {};
  let assets = 0, liabilities = 0;
  for (const a of listAccounts()) {
    byType[a.type] = (byType[a.type] ?? 0) + a.balance;
    if (LIABILITY_TYPES.has(a.type)) liabilities += Math.abs(a.balance);
    else assets += a.balance;
  }
  for (const k of Object.keys(byType)) byType[k] = round(byType[k]);
  return { total: round(assets - liabilities), assets: round(assets), liabilities: round(liabilities), byType };
}

export function netWorthHistory(days = 365): Array<{ date: string; net_worth: number }> {
  const d = getDb();
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const rows = d.prepare(`SELECT bh.date, bh.account_id, bh.balance, a.type FROM balance_history bh JOIN accounts a ON a.id = bh.account_id WHERE bh.date >= ? AND a.hidden = 0 AND a.closed = 0 ORDER BY bh.date`).all(since) as Array<{ date: string; account_id: string; balance: number; type: string }>;
  if (!rows.length) return [];
  // carry-forward: each account's last known balance per date
  const dates = [...new Set(rows.map((r) => r.date))].sort();
  const byAcct = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (!byAcct.has(r.account_id)) byAcct.set(r.account_id, new Map());
    byAcct.get(r.account_id)!.set(r.date, r.balance);
  }
  const types = new Map(rows.map((r) => [r.account_id, r.type]));
  const last = new Map<string, number>();
  const out: Array<{ date: string; net_worth: number }> = [];
  for (const date of dates) {
    let nw = 0;
    for (const [acct, series] of byAcct) {
      const v = series.get(date);
      if (v != null) last.set(acct, v);
      const bal = last.get(acct);
      if (bal == null) continue;
      nw += LIABILITY_TYPES.has(types.get(acct)!) ? -Math.abs(bal) : bal;
    }
    out.push({ date, net_worth: round(nw) });
  }
  return out;
}

// ---------- transactions ----------

export interface TxFilter {
  start?: string; end?: string; month?: string; query?: string; category_id?: string; account_id?: string;
  min_amount?: number; max_amount?: number; pending?: boolean; unreviewed?: boolean; include_transfers?: boolean; include_excluded?: boolean;
  limit?: number; offset?: number;
}

export function listTransactions(f: TxFilter = {}) {
  const where: string[] = [];
  const args: unknown[] = [];
  if (f.month) {
    const { start, end } = monthRange(f.month);
    where.push('t.date >= ? AND t.date <= ?'); args.push(start, end);
  }
  if (f.start) { where.push('t.date >= ?'); args.push(f.start); }
  if (f.end) { where.push('t.date <= ?'); args.push(f.end); }
  if (f.query) { where.push('(t.name LIKE ? OR t.original_name LIKE ? OR t.note LIKE ?)'); const q = `%${f.query}%`; args.push(q, q, q); }
  if (f.category_id) { where.push('(t.category_id = ? OR c.parent_id = ?)'); args.push(f.category_id, f.category_id); }
  if (f.account_id) { where.push('t.account_id = ?'); args.push(f.account_id); }
  if (f.min_amount != null) { where.push('ABS(t.amount) >= ?'); args.push(f.min_amount); }
  if (f.max_amount != null) { where.push('ABS(t.amount) <= ?'); args.push(f.max_amount); }
  if (f.pending != null) { where.push('t.pending = ?'); args.push(f.pending ? 1 : 0); }
  if (f.unreviewed) where.push('t.reviewed = 0');
  if (!f.include_transfers) where.push('t.transfer = 0');
  if (!f.include_excluded) where.push('t.excluded = 0');
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(Math.max(f.limit ?? 100, 1), 1000);
  const offset = Math.max(f.offset ?? 0, 0);
  const d = getDb();
  const total = (d.prepare(`SELECT COUNT(*) n FROM transactions t LEFT JOIN categories c ON c.id = t.category_id ${w}`).get(...args) as { n: number }).n;
  const rows = d.prepare(`SELECT t.id, t.date, t.name, t.amount, t.account_id, a.name account_name, a.mask account_mask, t.category_id, c.name category_name, c.emoji category_emoji, c.parent_id category_parent_id, t.pending, t.reviewed, t.excluded, t.transfer, t.income, t.note, t.recurring_id, t.tags
    FROM transactions t LEFT JOIN categories c ON c.id = t.category_id LEFT JOIN accounts a ON a.id = t.account_id ${w}
    ORDER BY t.date DESC, t.id DESC LIMIT ? OFFSET ?`).all(...args, limit, offset);
  return { total, count: rows.length, offset, has_more: offset + rows.length < total, transactions: rows };
}

export function getTransaction(id: string) {
  return getDb().prepare(`SELECT t.*, c.name category_name, a.name account_name FROM transactions t LEFT JOIN categories c ON c.id = t.category_id LEFT JOIN accounts a ON a.id = t.account_id WHERE t.id = ?`).get(id) as any;
}

// ---------- spending ----------

export function monthSummary(month = monthKey()) {
  const d = getDb();
  const { start, end } = monthRange(month);
  const spend = (d.prepare(`SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE date >= ? AND date <= ? AND ${SPEND_FILTER}`).get(start, end) as any).s as number;
  const income = -((d.prepare(`SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE date >= ? AND date <= ? AND ${INCOME_FILTER}`).get(start, end) as any).s as number);
  const pending = (d.prepare(`SELECT COUNT(*) n FROM transactions WHERE date >= ? AND date <= ? AND pending = 1`).get(start, end) as any).n as number;
  const unreviewed = (d.prepare(`SELECT COUNT(*) n FROM transactions WHERE reviewed = 0 AND excluded = 0`).get() as any).n as number;
  const budgeted = (d.prepare(`SELECT COALESCE(SUM(budget_amount),0) s FROM categories WHERE budget_amount IS NOT NULL AND excluded = 0`).get() as any).s as number;
  // previous month for comparison
  const prev = prevMonth(month);
  const pr = monthRange(prev);
  const prevSpend = (d.prepare(`SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE date >= ? AND date <= ? AND ${SPEND_FILTER}`).get(pr.start, pr.end) as any).s as number;
  return { month, spend: round(spend), income: round(income), net: round(income - spend), budgeted: round(budgeted), prev_month_spend: round(prevSpend), pending, unreviewed, days_left: daysLeftInMonth(month) };
}

export function prevMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return d.toISOString().slice(0, 7);
}

export function spendByMonth(months = 12): Array<{ month: string; spend: number; income: number }> {
  const d = getDb();
  const since = prevMonthN(monthKey(), months - 1) + '-01';
  const rows = d.prepare(`SELECT substr(date,1,7) month,
      SUM(CASE WHEN ${SPEND_FILTER} THEN amount ELSE 0 END) spend,
      -SUM(CASE WHEN ${INCOME_FILTER} THEN amount ELSE 0 END) income
    FROM transactions WHERE date >= ? GROUP BY month ORDER BY month`).all(since) as any[];
  return rows.map((r) => ({ month: r.month, spend: round(r.spend), income: round(r.income) }));
}
function prevMonthN(month: string, n: number): string {
  let m = month;
  for (let i = 0; i < n; i++) m = prevMonth(m);
  return m;
}

export function spendByCategory(month = monthKey(), parentOnly = true) {
  const d = getDb();
  const { start, end } = monthRange(month);
  const rows = d.prepare(`SELECT COALESCE(${parentOnly ? 'p.id' : 'c.id'}, c.id, 'uncategorized') id,
      COALESCE(${parentOnly ? 'p.name' : 'c.name'}, c.name, 'Uncategorized') name,
      COALESCE(${parentOnly ? 'p.emoji' : 'c.emoji'}, c.emoji) emoji,
      SUM(t.amount) spend, COUNT(*) n
    FROM transactions t LEFT JOIN categories c ON c.id = t.category_id LEFT JOIN categories p ON p.id = c.parent_id
    WHERE t.date >= ? AND t.date <= ? AND t.${SPEND_FILTER.replace(/ AND /g, ' AND t.')}
    GROUP BY 1 ORDER BY spend DESC`).all(start, end) as any[];
  return rows.map((r) => ({ ...r, spend: round(r.spend) }));
}

export function dailySpendCumulative(month = monthKey()): Array<{ date: string; spend: number; cumulative: number }> {
  const d = getDb();
  const { start, end } = monthRange(month);
  const rows = d.prepare(`SELECT date, SUM(amount) spend FROM transactions WHERE date >= ? AND date <= ? AND ${SPEND_FILTER} AND recurring_id IS NULL GROUP BY date ORDER BY date`).all(start, end) as any[];
  let cum = 0;
  return rows.map((r) => ({ date: r.date, spend: round(r.spend), cumulative: round((cum += r.spend)) }));
}

// ---------- budgets ----------

export interface BudgetStatus {
  category_id: string; name: string; emoji: string | null; parent_id: string | null; budget: number; spent: number; remaining: number; pct: number; status: 'ok' | 'warn' | 'over';
}

export function budgetStatus(month = monthKey()): { month: string; total_budget: number; total_spent: number; days_left: number; items: BudgetStatus[] } {
  const d = getDb();
  const { start, end } = monthRange(month);
  const cats = d.prepare(`SELECT id, name, emoji, parent_id, budget_amount FROM categories WHERE excluded = 0`).all() as any[];
  const budgetsTable = d.prepare(`SELECT category_id, amount, amounts FROM budgets`).all() as any[];
  const monthOverride = new Map<string, number>();
  for (const b of budgetsTable) {
    try {
      const amounts = b.amounts ? JSON.parse(b.amounts) : null;
      if (amounts && amounts[month] != null) monthOverride.set(b.category_id, Number(amounts[month]));
      else if (b.amount != null && b.category_id) monthOverride.set(b.category_id, Number(b.amount));
    } catch { /* ignore */ }
  }
  const spentRows = d.prepare(`SELECT t.category_id, c.parent_id, SUM(t.amount) s FROM transactions t LEFT JOIN categories c ON c.id = t.category_id WHERE t.date >= ? AND t.date <= ? AND t.${SPEND_FILTER.replace(/ AND /g, ' AND t.')} GROUP BY t.category_id`).all(start, end) as any[];
  const spentOwn = new Map<string, number>();
  const spentWithChildren = new Map<string, number>();
  for (const r of spentRows) {
    spentOwn.set(r.category_id, r.s);
    spentWithChildren.set(r.category_id, (spentWithChildren.get(r.category_id) ?? 0) + r.s);
    if (r.parent_id) spentWithChildren.set(r.parent_id, (spentWithChildren.get(r.parent_id) ?? 0) + r.s);
  }
  const items: BudgetStatus[] = [];
  for (const c of cats) {
    const budget = monthOverride.get(c.id) ?? (c.budget_amount != null ? Number(c.budget_amount) : null);
    if (budget == null || budget <= 0) continue;
    const spent = c.parent_id ? spentOwn.get(c.id) ?? 0 : spentWithChildren.get(c.id) ?? 0;
    const pct = budget > 0 ? spent / budget : 0;
    items.push({ category_id: c.id, name: c.name, emoji: c.emoji, parent_id: c.parent_id, budget: round(budget), spent: round(spent), remaining: round(budget - spent), pct: Math.round(pct * 1000) / 10, status: pct >= 1 ? 'over' : pct >= 0.8 ? 'warn' : 'ok' });
  }
  items.sort((a, b) => b.pct - a.pct);
  // totals: don't double count a child whose parent is also budgeted
  const budgetedIds = new Set(items.map((i) => i.category_id));
  const top = items.filter((i) => !i.parent_id || !budgetedIds.has(i.parent_id));
  return { month, total_budget: round(top.reduce((s, i) => s + i.budget, 0)), total_spent: round(top.reduce((s, i) => s + i.spent, 0)), days_left: daysLeftInMonth(month), items };
}

// ---------- recurring ----------

export function listRecurring(state?: string) {
  const d = getDb();
  const rows = d.prepare(`SELECT r.*, c.name category_name, c.emoji category_emoji FROM recurrings r LEFT JOIN categories c ON c.id = r.category_id ${state ? 'WHERE r.state = ?' : ''} ORDER BY COALESCE(r.next_date, '9999') ASC, r.name`).all(...(state ? [state] : [])) as any[];
  return rows.map((r) => ({ ...r, raw: undefined, monthly_equivalent: monthlyEquivalent(r.amount, r.frequency) }));
}

export function monthlyEquivalent(amount: number | null, frequency: string | null): number | null {
  if (amount == null) return null;
  const f = (frequency ?? 'monthly').toLowerCase();
  const factor: Record<string, number> = { daily: 30, weekly: 52 / 12, biweekly: 26 / 12, monthly: 1, bimonthly: 0.5, quarterly: 1 / 3, quadmonthly: 0.25, semiannually: 1 / 6, yearly: 1 / 12, annual: 1 / 12, annually: 1 / 12 };
  return round(Math.abs(amount) * (factor[f] ?? 1));
}

export function upcomingRecurring(days = 30) {
  const today = new Date().toISOString().slice(0, 10);
  const until = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  return listRecurring('active').filter((r) => r.next_date && r.next_date >= today && r.next_date <= until);
}

// ---------- investments ----------

export function listHoldings() {
  const d = getDb();
  const rows = d.prepare(`SELECT h.id, h.account_id, a.name account_name, h.ticker, h.name, h.quantity, h.price, h.value, h.cost_basis FROM holdings h LEFT JOIN accounts a ON a.id = h.account_id ORDER BY h.value DESC`).all() as any[];
  const total = rows.reduce((s, r) => s + (r.value ?? 0), 0);
  return { total: round(total), holdings: rows.map((r) => ({ ...r, weight: total ? Math.round(((r.value ?? 0) / total) * 1000) / 10 : 0, gain: r.cost_basis != null && r.value != null ? round(r.value - r.cost_basis) : null })) };
}

// ---------- categories ----------

export function listCategories() {
  return getDb().prepare(`SELECT id, name, parent_id, emoji, color, excluded, budget_amount FROM categories ORDER BY parent_id IS NOT NULL, name`).all() as any[];
}

// ---------- unusual ----------

export function unusualTransactions(month = monthKey(), factor = 2.5, minAmount = 50) {
  const d = getDb();
  const { start, end } = monthRange(month);
  const since = prevMonthN(month, 6) + '-01';
  const rows = d.prepare(`WITH hist AS (
      SELECT name, AVG(amount) avg_amt, COUNT(*) n FROM transactions WHERE date >= ? AND date < ? AND ${SPEND_FILTER} GROUP BY name)
    SELECT t.id, t.date, t.name, t.amount, c.name category_name, h.avg_amt, h.n
    FROM transactions t LEFT JOIN categories c ON c.id = t.category_id LEFT JOIN hist h ON h.name = t.name
    WHERE t.date >= ? AND t.date <= ? AND t.${SPEND_FILTER.replace(/ AND /g, ' AND t.')} AND t.amount >= ?
      AND (h.avg_amt IS NULL OR t.amount >= h.avg_amt * ?)
    ORDER BY t.amount DESC LIMIT 25`).all(since, start, start, end, minAmount, factor) as any[];
  return rows.map((r) => ({ ...r, reason: r.avg_amt == null ? 'first time seeing this merchant' : `${(r.amount / r.avg_amt).toFixed(1)}× the usual ${fmt(r.avg_amt)}` }));
}

export function overview() {
  return { month: monthSummary(), net_worth: netWorth(), budgets: budgetStatus(), upcoming: upcomingRecurring(14), last_sync: getMeta('last_sync') ?? null };
}

export function round(n: number): number {
  return Math.round(n * 100) / 100;
}
export function fmt(n: number): string {
  return (n < 0 ? '−' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
