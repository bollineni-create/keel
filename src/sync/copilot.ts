/**
 * Pulls your Copilot Money data into Keel's SQLite via the community
 * `copilot-money-mcp` server (reads the Copilot Mac app's local Firestore cache;
 * with --live-reads/--write it also talks to Copilot's GraphQL API).
 *
 * We speak MCP to it as a client over stdio, so Keel never touches Copilot's
 * cache format or API directly — if their schema drifts, that project absorbs it.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { config } from '../config.js';
import { getDb, nowIso, setMeta, upsert, type Row } from '../db.js';

type Json = Record<string, any>;

export class CopilotClient {
  private client: Client | null = null;
  private connecting: Promise<Client> | null = null;

  async connect(): Promise<Client> {
    if (this.client) return this.client;
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      const transport = new StdioClientTransport({
        command: config.copilotCommand,
        args: config.copilotArgs,
        env: { ...process.env } as Record<string, string>,
        stderr: 'pipe',
      });
      const client = new Client({ name: 'keel', version: '0.1.0' });
      await client.connect(transport);
      transport.onclose = () => {
        this.client = null;
      };
      this.client = client;
      return client;
    })();
    try {
      return await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  async call(name: string, args: Json = {}): Promise<Json> {
    const client = await this.connect();
    const res: any = await client.callTool({ name, arguments: args });
    const text = (res.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n');
    if (res.isError) throw new Error(`${name}: ${text.slice(0, 500)}`);
    try {
      return JSON.parse(text);
    } catch {
      return { text };
    }
  }

  async hasTool(name: string): Promise<boolean> {
    const client = await this.connect();
    const { tools } = await client.listTools();
    return tools.some((t) => t.name === name);
  }

  async close(): Promise<void> {
    await this.client?.close();
    this.client = null;
  }
}

export const copilot = new CopilotClient();

export interface SyncReport {
  startedAt: string;
  finishedAt: string;
  counts: Record<string, number>;
  warnings: string[];
}

let syncing: Promise<SyncReport> | null = null;

/** Full pull. Safe to call repeatedly; concurrent calls share one run. */
export function syncFromCopilot(): Promise<SyncReport> {
  if (syncing) return syncing;
  syncing = runSync().finally(() => (syncing = null));
  return syncing;
}

async function runSync(): Promise<SyncReport> {
  const report: SyncReport = { startedAt: nowIso(), finishedAt: '', counts: {}, warnings: [] };
  const live = config.copilotLiveEnabled;

  // --- accounts
  try {
    const r = await copilot.call(live ? 'get_accounts_live' : 'get_accounts', { fields: ['all'] });
    const rows = (r.accounts ?? []).map(mapAccount);
    report.counts.accounts = upsert('accounts', rows);
  } catch (e) {
    report.warnings.push(`accounts: ${(e as Error).message}`);
  }

  // --- categories (tree view gives parent links; fall back to list)
  try {
    const r = await copilot.call(live ? 'get_categories_live' : 'get_categories', live ? { fields: ['all'] } : { view: 'list', period: 'all_time' });
    const list: Json[] = live ? r.categories ?? r.data?.categories ?? r.rows ?? [] : r.data?.categories ?? r.categories ?? [];
    const rows: Row[] = [];
    for (const c of list) {
      rows.push(mapCategory(c));
      for (const s of c.subcategories ?? []) rows.push(mapCategory({ ...s, parent_id: c.category_id ?? c.id }));
    }
    report.counts.categories = upsert('categories', dedupe(rows));
  } catch (e) {
    report.warnings.push(`categories: ${(e as Error).message}`);
  }

  // --- transactions (paged)
  try {
    const tool = live ? 'get_transactions_live' : 'get_transactions';
    let offset = 0;
    let total = 0;
    const limit = 500;
    for (let page = 0; page < 400; page++) {
      const r = await copilot.call(tool, { limit, offset, fields: ['all'], exclude_deleted: true, period: 'all_time' });
      const list: Json[] = r.transactions ?? [];
      total += upsert('transactions', list.map(mapTransaction));
      if (!r.has_more || list.length === 0) break;
      offset += list.length;
    }
    report.counts.transactions = total;
  } catch (e) {
    report.warnings.push(`transactions: ${(e as Error).message}`);
  }

  // --- budgets
  try {
    const r = await copilot.call(live ? 'get_budgets_live' : 'get_budgets', {});
    const rows = (r.budgets ?? []).map(mapBudget);
    report.counts.budgets = upsert('budgets', rows);
    // mirror onto categories.budget_amount for fast reads
    const d = getDb();
    const stmt = d.prepare('UPDATE categories SET budget_amount = ? WHERE id = ?');
    for (const b of rows) if (b.category_id && b.amount != null) stmt.run(b.amount, b.category_id);
  } catch (e) {
    report.warnings.push(`budgets: ${(e as Error).message}`);
  }

  // --- recurring
  try {
    const r = await copilot.call(live ? 'get_recurring_live' : 'get_recurring_transactions', live ? { fields: ['all'] } : { include_copilot_subscriptions: true, fields: ['all'] });
    const rows = (r.recurring ?? r.recurrings ?? []).map(mapRecurring);
    report.counts.recurrings = upsert('recurrings', rows);
    if (live) {
      try {
        const u = await copilot.call('get_upcoming_recurrings_live', { fields: ['all'] });
        const ups = (u.recurring ?? u.upcoming ?? []).map(mapRecurring);
        upsert('recurrings', ups);
      } catch (e) {
        report.warnings.push(`upcoming recurrings: ${(e as Error).message}`);
      }
    }
  } catch (e) {
    report.warnings.push(`recurring: ${(e as Error).message}`);
  }

  // --- holdings
  try {
    const r = await copilot.call(live ? 'get_holdings_live' : 'get_holdings', { limit: 500 });
    const rows = (r.holdings ?? []).map(mapHolding);
    report.counts.holdings = upsert('holdings', rows);
  } catch (e) {
    report.warnings.push(`holdings: ${(e as Error).message}`);
  }

  // --- balance history (cache tool supports cross-account daily)
  try {
    let offset = 0;
    let total = 0;
    for (let page = 0; page < 200; page++) {
      const r = await copilot.call('get_balance_history', { granularity: 'daily', limit: 500, offset });
      const list: Json[] = r.balance_history ?? [];
      total += upsert(
        'balance_history',
        list.map((b) => ({ date: b.date, account_id: b.account_id, balance: b.current_balance ?? b.balance ?? null })),
        ['date', 'account_id'],
      );
      if (!r.has_more || list.length === 0) break;
      offset += list.length;
    }
    report.counts.balance_history = total;
  } catch (e) {
    report.warnings.push(`balance history: ${(e as Error).message}`);
  }

  // --- goals (cache only)
  try {
    const r = await copilot.call('get_goals', {});
    const rows = (r.goals ?? []).map((g: Json) => ({
      id: g.goal_id ?? g.id,
      name: g.name ?? g.title ?? 'Goal',
      target: num(g.target_amount ?? g.target ?? g.amount),
      current: num(g.current_amount ?? g.current ?? g.saved),
      due: g.target_date ?? g.due_date ?? null,
      raw: g,
    }));
    report.counts.goals = upsert('goals', rows);
  } catch (e) {
    report.warnings.push(`goals: ${(e as Error).message}`);
  }

  report.finishedAt = nowIso();
  setMeta('last_sync', report.finishedAt);
  setMeta('last_sync_report', JSON.stringify(report));
  return report;
}

// ---------- mappers (defensive: field names differ between cache and live) ----------

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'string' ? Number(v.replace(/[$,]/g, '')) : Number(v);
  return Number.isFinite(n) ? n : null;
}
const bool = (v: unknown) => (v === true || v === 1 || v === 'true' ? 1 : 0);

function mapAccount(a: Json): Row {
  const type = (a.account_type ?? a.type ?? '').toString().toLowerCase();
  return {
    id: a.account_id ?? a.id,
    name: a.nickname ?? a.name ?? a.official_name ?? 'Account',
    official_name: a.official_name ?? null,
    mask: a.mask ?? null,
    type: normalizeAccountType(type, a.subtype),
    subtype: a.subtype ?? a.original_subtype ?? null,
    institution: a.institution_name ?? a.institution ?? null,
    balance: num(a.current_balance ?? a.balance ?? a.currentBalance) ?? 0,
    available: num(a.available_balance ?? a.availableBalance),
    limit_amt: num(a.limit),
    currency: a.iso_currency_code ?? 'USD',
    hidden: bool(a.hidden ?? a.is_hidden),
    closed: bool(a.closed ?? a.is_closed),
    raw: a,
    updated_at: nowIso(),
  };
}

export function normalizeAccountType(type: string, subtype?: string): string {
  const t = `${type} ${subtype ?? ''}`.toLowerCase();
  if (/credit/.test(t)) return 'credit';
  if (/loan|mortgage|student/.test(t)) return 'loan';
  if (/invest|brokerage|401|ira|hsa|roth|retirement/.test(t)) return 'investment';
  if (/depository|checking|savings|cash|money market|cd\b/.test(t)) return 'depository';
  if (/property|vehicle|real estate|other asset/.test(t)) return 'asset';
  return type || 'other';
}

function mapCategory(c: Json): Row {
  return {
    id: c.category_id ?? c.id,
    name: c.name ?? 'Uncategorized',
    parent_id: c.parent_id ?? c.parentId ?? c.parent_category_id ?? c.parent?.category_id ?? null,
    emoji: c.emoji ?? c.icon ?? null,
    color: c.color ?? c.colorName ?? null,
    excluded: bool(c.excluded ?? c.isExcluded ?? c.is_excluded),
    budget_amount: num(c.budget_amount ?? c.budget?.amount),
    raw: c,
  };
}

function mapTransaction(t: Json): Row {
  const amount = num(t.amount) ?? 0;
  const type = (t.type ?? '').toString().toUpperCase();
  const income = bool(t.income) || type === 'INCOME' || (amount < 0 && !t.internal_transfer && type !== 'INTERNAL_TRANSFER') ? 1 : 0;
  return {
    id: t.transaction_id ?? t.id,
    date: t.date,
    name: t.name_override ?? t.name ?? t.original_clean_name ?? t.original_name ?? 'Transaction',
    original_name: t.original_name ?? null,
    amount,
    account_id: t.account_id ?? t.accountId ?? null,
    category_id: t.category_id ?? t.categoryId ?? null,
    pending: bool(t.pending),
    reviewed: bool(t.user_reviewed ?? t.reviewed),
    excluded: bool(t.excluded),
    transfer: bool(t.internal_transfer) || type === 'INTERNAL_TRANSFER' ? 1 : 0,
    income,
    note: t.user_note ?? t.user_notes ?? t.note ?? null,
    recurring_id: t.recurring_id ?? t.recurringId ?? null,
    tags: t.tag_ids ?? t.tags ?? null,
    source: 'copilot',
    raw: t,
    updated_at: nowIso(),
  };
}

function mapBudget(b: Json): Row {
  return {
    id: b.budget_id ?? b.id ?? `cat:${b.category_id}`,
    category_id: b.category_id ?? b.categoryId ?? null,
    name: b.name ?? b.category_name ?? null,
    amount: num(b.amount),
    period: b.period ?? 'monthly',
    amounts: b.amounts ?? null,
    raw: b,
  };
}

function mapRecurring(r: Json): Row {
  return {
    id: r.recurring_id ?? r.id ?? `${r.name}:${r.frequency}`,
    name: r.name ?? r.merchant ?? 'Recurring',
    amount: num(r.amount ?? r.average_amount ?? r.expected_amount),
    frequency: r.frequency ?? r.rule?.frequency ?? null,
    next_date: r.next_date ?? r.next_expected_date ?? r.nextDate ?? r.due_date ?? null,
    last_date: r.last_date ?? r.last_transaction_date ?? r.lastDate ?? null,
    state: r.state ?? (r.is_active === false ? 'paused' : 'active'),
    category_id: r.category_id ?? r.categoryId ?? null,
    account_id: r.account_id ?? r.accountId ?? null,
    raw: r,
  };
}

function mapHolding(h: Json): Row {
  const qty = num(h.quantity);
  const price = num(h.institution_price ?? h.price ?? h.current_price);
  return {
    id: h.holding_id ?? h.id ?? `${h.account_id}:${h.security_id ?? h.ticker_symbol}`,
    account_id: h.account_id ?? null,
    security_id: h.security_id ?? null,
    ticker: h.ticker_symbol ?? h.ticker ?? h.symbol ?? null,
    name: h.name ?? h.security_name ?? h.ticker_symbol ?? 'Holding',
    quantity: qty,
    price,
    value: num(h.institution_value ?? h.value ?? h.market_value) ?? (qty != null && price != null ? qty * price : null),
    cost_basis: num(h.cost_basis ?? h.metrics?.cost_basis),
    raw: h,
  };
}

function dedupe(rows: Row[]): Row[] {
  const seen = new Map<string, Row>();
  for (const r of rows) seen.set(String(r.id), { ...(seen.get(String(r.id)) ?? {}), ...r });
  return [...seen.values()];
}

// ---------- write-through ----------

/** Apply an edit to Copilot if write mode is on; otherwise queue it. */
export async function pushWrite(tool: string, args: Json): Promise<{ pushed: boolean; result?: Json; error?: string }> {
  const d = getDb();
  if (!config.copilotWriteEnabled) {
    d.prepare('INSERT INTO pending_writes(created_at, tool, args, status) VALUES (?,?,?,?)').run(nowIso(), tool, JSON.stringify(args), 'queued');
    return { pushed: false };
  }
  try {
    const result = await copilot.call(tool, args);
    return { pushed: true, result };
  } catch (e) {
    const error = (e as Error).message;
    d.prepare('INSERT INTO pending_writes(created_at, tool, args, status, error) VALUES (?,?,?,?,?)').run(nowIso(), tool, JSON.stringify(args), 'failed', error);
    return { pushed: false, error };
  }
}
