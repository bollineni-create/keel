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
    name: 'update_transaction',
    description: 'Edit one transaction: category, reviewed flag, note, name, or excluded. Applies locally at once and pushes to Copilot Money when write mode is enabled (otherwise it is queued).',
    schema: z.object({
      transaction_id: z.string(),
      category_id: z.string().optional(),
      reviewed: z.boolean().optional(),
      note: z.string().optional(),
      name: z.string().optional(),
      excluded: z.boolean().optional(),
    }),
    readOnly: false,
    handler: async (a) => {
      const d = getDb();
      const sets: string[] = [];
      const vals: unknown[] = [];
      if (a.category_id !== undefined) { sets.push('category_id = ?'); vals.push(a.category_id); }
      if (a.reviewed !== undefined) { sets.push('reviewed = ?'); vals.push(a.reviewed ? 1 : 0); }
      if (a.note !== undefined) { sets.push('note = ?'); vals.push(a.note); }
      if (a.name !== undefined) { sets.push('name = ?'); vals.push(a.name); }
      if (a.excluded !== undefined) { sets.push('excluded = ?'); vals.push(a.excluded ? 1 : 0); }
      if (!sets.length) throw new Error('Nothing to update');
      sets.push('updated_at = ?'); vals.push(nowIso());
      const r = d.prepare(`UPDATE transactions SET ${sets.join(', ')} WHERE id = ?`).run(...vals, a.transaction_id);
      if (!r.changes) throw new Error(`No transaction ${a.transaction_id}`);
      const push = await pushWrite('update_transaction', { transaction_id: a.transaction_id, ...(a.category_id !== undefined && { category_id: a.category_id }), ...(a.reviewed !== undefined && { reviewed: a.reviewed }), ...(a.note !== undefined && { note: a.note }), ...(a.name !== undefined && { name: a.name }) });
      return { ok: true, transaction: q.getTransaction(a.transaction_id), copilot: push };
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
