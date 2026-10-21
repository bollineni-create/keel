/**
 * One tool registry, served three ways:
 *  - the in-app assistant (Anthropic API tool use)
 *  - the MCP endpoint (/mcp, and `npm run mcp` over stdio) for Claude Desktop / Claude Code / claude.ai
 *  - the REST API, which calls the same handlers
 */
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { getDb, nowIso } from './db.js';
import * as q from './queries.js';
import { pushWrite, syncFromCopilot } from './sync/copilot.js';

export interface Tool<S extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  description: string;
  schema: S;
  readOnly: boolean;
  handler: (args: z.infer<S>) => Promise<unknown> | unknown;
}

const month = z.string().regex(/^\d{4}-\d{2}$/).describe('Month as YYYY-MM. Defaults to the current month.').optional();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const txType = z.enum(['regular', 'income', 'transfer']);
const txIds = z.array(z.string()).min(1).max(500);

function def<S extends z.ZodTypeAny>(t: Tool<S>): Tool<S> {
  return t;
}

export const tools: Tool<any>[] = [
  def({
    name: 'get_overview',
    description: 'Snapshot for today: this month\'s spend vs income vs budget, net worth, budgets at risk, recurring charges due in the next 14 days, and when data was last synced from Copilot. Start here for "how am I doing" questions.',
    schema: z.object({}),
    readOnly: true,
    handler: () => q.overview(),
  }),
  def({
    name: 'get_month_summary',
    description: 'Spend, income, net, budgeted total, pending and unreviewed counts, and previous-month spend for one month.',
    schema: z.object({ month }),
    readOnly: true,
    handler: ({ month }) => q.monthSummary(month ?? q.monthKey()),
  }),
  def({
    name: 'get_transactions',
    description: 'Search transactions. Amounts are positive for spending and negative for income/refunds (Copilot convention). Transfers and excluded rows are hidden unless asked for. Returns newest first, paged.',
    schema: z.object({
      month,
      start: z.string().optional().describe('YYYY-MM-DD inclusive'),
      end: z.string().optional().describe('YYYY-MM-DD inclusive'),
      query: z.string().optional().describe('Case-insensitive substring of merchant name or note'),
      category_id: z.string().optional(),
      account_id: z.string().optional(),
      min_amount: z.number().optional(),
      max_amount: z.number().optional(),
      pending: z.boolean().optional(),
      unreviewed: z.boolean().optional().describe('Only rows not yet marked reviewed'),
      include_transfers: z.boolean().optional(),
      include_excluded: z.boolean().optional(),
      account_ids: z.array(z.string()).optional().describe('Any of these accounts'),
      category_ids: z.array(z.string()).optional().describe('Any of these categories (a parent includes its subcategories)'),
      tags: z.array(z.string()).optional().describe('Any of these tags'),
      types: z.array(txType).optional().describe('regular / income / transfer (internal transfer); any of'),
      statuses: z.array(z.enum(['pending', 'unreviewed', 'excluded'])).optional().describe('Any of these states; "excluded" includes excluded rows'),
      sort: z.enum(['date', 'amount', 'name']).optional().describe('Default date'),
      dir: z.enum(['asc', 'desc']).optional().describe('Default desc (newest / largest first); name sorts asc by default'),
      limit: z.number().int().min(1).max(500).optional().describe('Default 100'),
      offset: z.number().int().min(0).optional(),
    }),
    readOnly: true,
    handler: (f) => q.listTransactions(f),
  }),
  def({
    name: 'get_spending_by_category',
    description: 'Spend per category for a month, largest first. parent_only groups subcategories under their parent (default true).',
    schema: z.object({ month, parent_only: z.boolean().optional() }),
    readOnly: true,
    handler: ({ month, parent_only }) => q.spendByCategory(month ?? q.monthKey(), parent_only ?? true),
  }),
  def({
    name: 'get_spending_trend',
    description: 'Monthly spend and income for the last N months (default 12).',
    schema: z.object({ months: z.number().int().min(1).max(60).optional() }),
    readOnly: true,
    handler: ({ months }) => q.spendByMonth(months ?? 12),
  }),
  def({
    name: 'get_budgets',
    description: 'Every budgeted category for a month with budget, spent, remaining, percent used and status (ok / warn ≥80% / over).',
    schema: z.object({ month }),
    readOnly: true,
    handler: ({ month }) => q.budgetStatus(month ?? q.monthKey()),
  }),
  def({
    name: 'get_accounts',
    description: 'All accounts with current balances, grouped by type (depository, credit, loan, investment, asset).',
    schema: z.object({ include_hidden: z.boolean().optional() }),
    readOnly: true,
    handler: ({ include_hidden }) => ({ accounts: q.listAccounts(include_hidden ?? false), net_worth: q.netWorth() }),
  }),
  def({
    name: 'get_net_worth_history',
    description: 'Daily net worth series (assets minus liabilities) for the last N days (default 365).',
    schema: z.object({ days: z.number().int().min(7).max(3650).optional() }),
    readOnly: true,
    handler: ({ days }) => ({ current: q.netWorth(), history: q.netWorthHistory(days ?? 365) }),
  }),
  def({
    name: 'get_recurring',
    description: 'Subscriptions and recurring charges with frequency, next due date and monthly-equivalent cost. state filters active/paused.',
    schema: z.object({ state: z.enum(['active', 'paused', 'archived']).optional(), upcoming_days: z.number().int().optional().describe('If set, only charges due within this many days') }),
    readOnly: true,
    handler: ({ state, upcoming_days }) => (upcoming_days ? q.upcomingRecurring(upcoming_days) : q.listRecurring(state)),
  }),
  def({
    name: 'get_holdings',
    description: 'Investment positions with value, weight, cost basis and unrealized gain.',
    schema: z.object({}),
    readOnly: true,
    handler: () => q.listHoldings(),
  }),
  def({
    name: 'get_categories',
    description: 'Category tree (id, name, parent_id, emoji, budget). Use ids from here when categorizing.',
    schema: z.object({}),
    readOnly: true,
    handler: () => q.listCategories(),
  }),
  def({
    name: 'find_unusual_transactions',
    description: 'Spending this month that is a first-time merchant or ≥2.5× that merchant\'s 6-month average. Good for a weekly review.',
    schema: z.object({ month, min_amount: z.number().optional() }),
    readOnly: true,
    handler: ({ month, min_amount }) => q.unusualTransactions(month ?? q.monthKey(), 2.5, min_amount ?? 50),
  }),
  def({
    name: 'get_similar_transactions',
    description: 'Other transactions from the same merchant as one transaction, newest first, grouped by month with that account\'s total and the all-accounts total.',
    schema: z.object({ transaction_id: z.string(), limit: z.number().int().min(1).max(200).optional() }),
    readOnly: true,
    handler: ({ transaction_id, limit }) => {
      const r = q.similarTransactions(transaction_id, limit ?? 60);
      if (!r) throw new Error(`No transaction ${transaction_id}`);
      return r;
    },
  }),
  def({
    name: 'get_goals',
    description: 'Savings goals with target, current amount and due date. Use ids from here for update_transaction goal_id.',
    schema: z.object({}),
    readOnly: true,
    handler: () => q.listGoals(),
  }),
  def({
    name: 'update_transaction',
    description: 'Edit one transaction: category, reviewed flag, note, name, excluded, tags, type (regular / income / internal transfer), amount, date, account or goal. Applies locally at once; category, reviewed, note and name are pushed to Copilot Money when write mode is enabled (otherwise queued), the rest stay local.',
    schema: z.object({
      transaction_id: z.string(),
      category_id: z.string().optional(),
      reviewed: z.boolean().optional(),
      note: z.string().optional(),
      name: z.string().optional(),
      excluded: z.boolean().optional(),
      tags: z.array(z.string()).optional().describe('Replaces the tag list'),
      type: txType.optional(),
      amount: z.number().optional().describe('Positive = money out, negative = money in'),
      date: day.optional(),
      account_id: z.string().optional(),
      goal_id: z.string().nullable().optional().describe('null clears the goal'),
    }),
    readOnly: false,
    handler: (a) => updateTransaction(a),
  }),
  def({
    name: 'bulk_update_transactions',
    description: 'Apply one edit to many transactions: set category, reviewed or excluded, and/or add or remove tags.',
    schema: z.object({
      transaction_ids: txIds,
      category_id: z.string().optional(),
      reviewed: z.boolean().optional(),
      excluded: z.boolean().optional(),
      add_tags: z.array(z.string()).optional(),
      remove_tags: z.array(z.string()).optional(),
    }),
    readOnly: false,
    handler: async ({ transaction_ids, add_tags, remove_tags, ...fields }) => {
      const d = getDb();
      const results = [];
      for (const id of transaction_ids) {
        const edit: UpdateArgs = { transaction_id: id, ...fields };
        if (add_tags?.length || remove_tags?.length) {
          const cur = d.prepare('SELECT tags FROM transactions WHERE id = ?').get(id) as { tags: string | null } | undefined;
          const tags = new Set(q.parseTags(cur?.tags));
          add_tags?.forEach((t) => tags.add(t));
          remove_tags?.forEach((t) => tags.delete(t));
          edit.tags = [...tags];
        }
        results.push(await updateTransaction(edit));
      }
      const pushed = results.filter((r) => r.copilot.pushed).length;
      return { ok: true, count: results.length, copilot: { pushed: pushed === results.length && pushed > 0, local: results.every((r) => r.copilot.local), pushed_count: pushed } };
    },
  }),
  def({
    name: 'create_transaction',
    description: 'Add a manual transaction (cash, something the bank missed). Stays in Keel; Copilot Money is not changed.',
    schema: z.object({
      date: day,
      name: z.string().min(1),
      amount: z.number().describe('Positive = money out, negative = money in'),
      account_id: z.string().optional(),
      category_id: z.string().optional(),
      note: z.string().optional(),
      type: txType.optional(),
      tags: z.array(z.string()).optional(),
    }),
    readOnly: false,
    handler: (a) => {
      const id = `manual-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      const type = a.type ?? (a.amount < 0 ? 'income' : 'regular');
      getDb().prepare(`INSERT INTO transactions(id, date, name, original_name, amount, account_id, category_id, pending, reviewed, excluded, transfer, income, note, tags, source, updated_at)
        VALUES (?,?,?,?,?,?,?,0,1,0,?,?,?,?,'manual',?)`).run(id, a.date, a.name, a.name, a.amount, a.account_id ?? null, a.category_id ?? null, type === 'transfer' ? 1 : 0, type === 'income' ? 1 : 0, a.note ?? null, a.tags?.length ? JSON.stringify(a.tags) : null, nowIso());
      return { ok: true, transaction: q.getTransaction(id), copilot: { pushed: false, local: true } };
    },
  }),
  def({
    name: 'split_transaction',
    description: 'Split one transaction into parts (e.g. a Target run that was half groceries, half household). Part amounts must add up to the original. The parent stays visible but drops out of totals; the parts carry the spend. An empty list removes the split. Local to Keel.',
    schema: z.object({
      transaction_id: z.string(),
      splits: z.array(z.object({ amount: z.number(), category_id: z.string().optional(), name: z.string().optional() })).max(20),
    }),
    readOnly: false,
    handler: ({ transaction_id, splits }) => {
      const d = getDb();
      const parent = d.prepare('SELECT * FROM transactions WHERE id = ?').get(transaction_id) as any;
      if (!parent) throw new Error(`No transaction ${transaction_id}`);
      if (parent.split_parent_id) throw new Error('Split the original transaction, not one of its parts');
      if (splits.length === 1) throw new Error('A split needs at least two parts (or none to undo it)');
      const sum = splits.reduce((s, x) => s + x.amount, 0);
      if (splits.length && Math.abs(sum - parent.amount) > 0.005) throw new Error(`Parts add up to ${q.fmt(sum)}, not ${q.fmt(parent.amount)}`);
      const insert = d.prepare(`INSERT INTO transactions(id, date, name, original_name, amount, account_id, category_id, pending, reviewed, excluded, transfer, income, note, split_parent_id, source, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'split',?)`);
      d.transaction(() => {
        d.prepare('DELETE FROM transactions WHERE split_parent_id = ?').run(transaction_id);
        splits.forEach((x, i) => insert.run(`${transaction_id}:split:${i + 1}`, parent.date, x.name || parent.name, parent.original_name, q.round(x.amount), parent.account_id, x.category_id ?? parent.category_id, parent.pending, parent.reviewed, parent.excluded, parent.transfer, parent.income, null, transaction_id, nowIso()));
        d.prepare('UPDATE transactions SET split = ?, updated_at = ? WHERE id = ?').run(splits.length ? 1 : 0, nowIso(), transaction_id);
      })();
      const parts = d.prepare('SELECT id FROM transactions WHERE split_parent_id = ? ORDER BY id').all(transaction_id) as Array<{ id: string }>;
      return { ok: true, transaction: q.getTransaction(transaction_id), parts: parts.map((p) => q.getTransaction(p.id)), copilot: { pushed: false, local: true } };
    },
  }),
  def({
    name: 'delete_transactions',
    description: 'Delete transactions from Keel (and the parts of any split among them). A transaction that came from Copilot comes back on the next sync unless it is also deleted there; prefer excluding it.',
    schema: z.object({ transaction_ids: txIds }),
    readOnly: false,
    handler: ({ transaction_ids }) => {
      const d = getDb();
      const del = d.prepare('DELETE FROM transactions WHERE id = ? OR split_parent_id = ?');
      let n = 0;
      d.transaction(() => transaction_ids.forEach((id) => { n += del.run(id, id).changes; }))();
      return { ok: true, count: n, copilot: { pushed: false, local: true } };
    },
  }),
  def({
    name: 'review_transactions',
    description: 'Mark many transactions reviewed (or unreviewed) in one call.',
    schema: z.object({ transaction_ids: z.array(z.string()).min(1).max(500), reviewed: z.boolean().optional().describe('Default true') }),
    readOnly: false,
    handler: async ({ transaction_ids, reviewed }) => {
      const d = getDb();
      const stmt = d.prepare('UPDATE transactions SET reviewed = ?, updated_at = ? WHERE id = ?');
      const tx = d.transaction((ids: string[]) => ids.forEach((id) => stmt.run(reviewed === false ? 0 : 1, nowIso(), id)));
      tx(transaction_ids);
      const push = await pushWrite('review_transactions', { transaction_ids, reviewed: reviewed !== false });
      return { ok: true, count: transaction_ids.length, copilot: push };
    },
  }),
  def({
    name: 'set_budget',
    description: 'Set a category\'s monthly budget (0 removes it).',
    schema: z.object({ category_id: z.string(), amount: z.number().min(0) }),
    readOnly: false,
    handler: async ({ category_id, amount }) => {
      const d = getDb();
      d.prepare('UPDATE categories SET budget_amount = ? WHERE id = ?').run(amount > 0 ? amount : null, category_id);
      d.prepare(`INSERT INTO budgets(id, category_id, amount, period) VALUES (?,?,?,'monthly') ON CONFLICT(id) DO UPDATE SET amount = excluded.amount`).run(`cat:${category_id}`, category_id, amount);
      const push = await pushWrite('set_budget', { category_id, amount: String(amount) });
      return { ok: true, copilot: push };
    },
  }),
  def({
    name: 'sync_now',
    description: 'Pull fresh data from Copilot Money into Keel. Takes a few seconds. Returns per-table counts and any warnings.',
    schema: z.object({}),
    readOnly: false,
    handler: () => syncFromCopilot(),
  }),
];

type UpdateArgs = {
  transaction_id: string; category_id?: string; reviewed?: boolean; note?: string; name?: string; excluded?: boolean;
  tags?: string[]; type?: q.TxType; amount?: number; date?: string; account_id?: string; goal_id?: string | null;
};

/** Fields copilot-money-mcp's update_transaction accepts; everything else is Keel-local. */
const PUSHABLE = ['category_id', 'reviewed', 'note', 'name'] as const;

async function updateTransaction(a: UpdateArgs) {
  const d = getDb();
  const sets: string[] = [];
  const vals: unknown[] = [];
  const set = (col: string, v: unknown) => { sets.push(`${col} = ?`); vals.push(v); };
  if (a.category_id !== undefined) set('category_id', a.category_id || null);
  if (a.reviewed !== undefined) set('reviewed', a.reviewed ? 1 : 0);
  if (a.note !== undefined) set('note', a.note);
  if (a.name !== undefined) set('name', a.name);
  if (a.excluded !== undefined) set('excluded', a.excluded ? 1 : 0);
  if (a.tags !== undefined) set('tags', a.tags.length ? JSON.stringify(a.tags) : null);
  if (a.type !== undefined) { set('transfer', a.type === 'transfer' ? 1 : 0); set('income', a.type === 'income' ? 1 : 0); }
  if (a.amount !== undefined) set('amount', q.round(a.amount));
  if (a.date !== undefined) set('date', a.date);
  if (a.account_id !== undefined) set('account_id', a.account_id);
  if (a.goal_id !== undefined) set('goal_id', a.goal_id);
  if (!sets.length) throw new Error('Nothing to update');
  sets.push('updated_at = ?'); vals.push(nowIso());
  const r = d.prepare(`UPDATE transactions SET ${sets.join(', ')} WHERE id = ?`).run(...vals, a.transaction_id);
  if (!r.changes) throw new Error(`No transaction ${a.transaction_id}`);
  const pushable = Object.fromEntries(PUSHABLE.filter((k) => a[k] !== undefined).map((k) => [k, a[k]]));
  const push = Object.keys(pushable).length ? await pushWrite('update_transaction', { transaction_id: a.transaction_id, ...pushable }) : { pushed: false, local: true };
  return { ok: true, transaction: q.getTransaction(a.transaction_id), copilot: push as { pushed: boolean; local?: boolean; error?: string } };
}

export const toolMap = new Map(tools.map((t) => [t.name, t]));

export async function runTool(name: string, rawArgs: unknown): Promise<unknown> {
  const t = toolMap.get(name);
  if (!t) throw new Error(`Unknown tool ${name}`);
  const parsed = t.schema.safeParse(rawArgs ?? {});
  if (!parsed.success) throw new Error(`Invalid arguments for ${name}: ${parsed.error.issues.map((i: z.ZodIssue) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  return t.handler(parsed.data);
}

/** Anthropic Messages API tool definitions. */
export function anthropicTools() {
  return tools.map((t) => ({ name: t.name, description: t.description, input_schema: stripSchema(zodToJsonSchema(t.schema, { $refStrategy: 'none' })) }));
}

function stripSchema(s: any): any {
  const { $schema, additionalProperties, ...rest } = s;
  if (rest.type !== 'object') rest.type = 'object';
  rest.properties ??= {};
  return rest;
}
