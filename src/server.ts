import express, { type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { config } from './config.js';
import { getDb, getMeta } from './db.js';
import { buildMcpServer } from './mcp.js';
import { chat } from './assistant.js';
import { tools, publicTools, runTool, toolMap } from './tools.js';
import * as q from './queries.js';
import { syncAll } from './sync/index.js';
import { connectionCount, listConnections } from './sync/connections.js';
import { importCopilotCsv } from './sync/csv.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(__dirname, '../web');
const designDir = path.resolve(__dirname, '../design');

getDb();
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '4mb' }));

// ---- guards that matter once bank connections exist ----
// A request from this Mac itself (not relayed by a local proxy such as tailscale serve/funnel or ngrok).
function isLocal(req: Request): boolean {
  const ip = req.socket.remoteAddress ?? '';
  const proxied = req.get('x-forwarded-for') || req.get('forwarded') || req.get('tailscale-funnel-request');
  return !proxied && (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1');
}
// DNS rebinding: without a token, a web page on attacker.example resolving to 127.0.0.1 could read /api.
function hostAllowed(host: string | undefined): boolean {
  const name = (host ?? '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '').toLowerCase();
  if (!name) return false;
  return /^[\d.]+$/.test(name) || name.includes(':') || name === 'localhost' || !name.includes('.') || name.endsWith('.local') || name.endsWith('.ts.net') || config.allowedHosts.includes(name);
}
app.use((req: Request, res: Response, next: NextFunction) => {
  // Cross-site writes (CSRF): the app's own pages send a same-origin Origin or none.
  const origin = req.get('origin');
  if (req.path.startsWith('/api') && req.method !== 'GET' && origin && origin !== 'null') {
    let same = false;
    // A proxy that rewrites Host (ngrok --host-header=rewrite, nginx) passes the original in X-Forwarded-Host.
    try { const o = new URL(origin).host; same = o === req.get('host') || o === req.get('x-forwarded-host'); } catch {}
    if (!same) return res.status(403).json({ error: 'cross-origin request refused' });
  }
  if (!config.token && connectionCount() > 0) {
    if (!hostAllowed(req.get('host'))) return res.status(403).json({ error: `Host ${req.get('host')} not allowed. Set KEEL_TOKEN, or add it to KEEL_ALLOWED_HOSTS.` });
    if (!isLocal(req)) return res.status(401).json({ error: 'Keel has bank connections, so other devices need a token: set KEEL_TOKEN in .env and restart, then open Keel with ?token=<it>.' });
  }
  next();
});

// ---- auth (optional shared token) ----
app.use((req: Request, res: Response, next: NextFunction) => {
  if (!config.token) return next();
  const header = req.get('authorization');
  const bearer = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
  const cookie = req.headers.cookie?.split(';').map((c) => c.trim()).find((c) => c.startsWith('keel='))?.slice(5);
  const query = typeof req.query.token === 'string' ? req.query.token : undefined;
  const t = bearer ?? query ?? cookie;
  if (t === config.token) {
    if (query && !cookie) res.setHeader('Set-Cookie', `keel=${query}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`);
    return next();
  }
  res.status(401).json({ error: 'unauthorized' });
});

// ---- REST ----
const api = express.Router();
api.get('/overview', (_req, res) => res.json(q.overview()));
api.get('/summary', (req, res) => res.json(q.monthSummary(str(req.query.month) ?? q.monthKey())));
api.get('/transactions', (req, res) => res.json(q.listTransactions(txFilter(req))));
api.get('/transactions/export.csv', (req, res) => {
  const f = txFilter(req);
  const cols = ['date', 'name', 'amount', 'category', 'account', 'type', 'status', 'tags', 'note'];
  const cell = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [cols.join(',')];
  for (let offset = 0; ; offset += 1000) {
    const page = q.listTransactions({ ...f, limit: 1000, offset });
    for (const t of page.transactions as any[]) {
      const type = t.transfer ? 'transfer' : t.income ? 'income' : 'regular';
      const status = [t.pending && 'pending', !t.reviewed && 'unreviewed', t.excluded && 'excluded', t.split && 'split'].filter(Boolean).join(' ');
      lines.push([t.date, t.name, t.amount, t.category_name, t.account_name, type, status, q.parseTags(t.tags).join(' '), t.note].map(cell).join(','));
    }
    if (!page.has_more) break;
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="keel-transactions-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(lines.join('\n') + '\n');
});
api.post('/transactions', wrap(async (req, res) => res.json(await runTool('create_transaction', req.body))));
api.post('/transactions/review', wrap(async (req, res) => res.json(await runTool('review_transactions', req.body))));
api.post('/transactions/bulk', wrap(async (req, res) => res.json(await runTool('bulk_update_transactions', req.body))));
api.post('/transactions/delete', wrap(async (req, res) => res.json(await runTool('delete_transactions', req.body))));
api.get('/transactions/:id', (req, res) => {
  const t = q.getTransaction(req.params.id);
  t ? res.json(t) : res.status(404).json({ error: 'not found' });
});
api.get('/transactions/:id/similar', wrap(async (req, res) => res.json(await runTool('get_similar_transactions', { transaction_id: req.params.id, limit: num(req.query.limit) }))));
api.patch('/transactions/:id', wrap(async (req, res) => res.json(await runTool('update_transaction', { transaction_id: req.params.id, ...req.body }))));
api.post('/transactions/:id/split', wrap(async (req, res) => res.json(await runTool('split_transaction', { transaction_id: req.params.id, splits: req.body?.splits ?? [] }))));
api.get('/tags', (_req, res) => res.json(q.listTags()));
api.get('/goals', (_req, res) => res.json(q.listGoals()));
api.get('/spending/categories', (req, res) => res.json(q.spendByCategory(str(req.query.month) ?? q.monthKey(), bool(req.query.parent_only) ?? true)));
api.get('/spending/trend', (req, res) => res.json(q.spendByMonth(num(req.query.months) ?? 12)));
api.get('/spending/daily', (req, res) => res.json(q.dailySpendCumulative(str(req.query.month) ?? q.monthKey())));
api.get('/spending/unusual', (req, res) => res.json(q.unusualTransactions(str(req.query.month) ?? q.monthKey())));
api.get('/budgets', (req, res) => res.json(q.budgetStatus(str(req.query.month) ?? q.monthKey())));
api.put('/budgets/:categoryId', wrap(async (req, res) => res.json(await runTool('set_budget', { category_id: req.params.categoryId, amount: Number(req.body.amount) }))));
api.get('/accounts', (req, res) => res.json({ accounts: q.listAccounts(bool(req.query.hidden) ?? false, bool(req.query.closed) ?? false), net_worth: q.netWorth() }));
api.get('/networth/history', (req, res) => res.json(q.netWorthHistory(num(req.query.days) ?? 365)));
api.get('/recurring', (req, res) => res.json(q.listRecurring(str(req.query.state))));
api.get('/holdings', (_req, res) => res.json(q.listHoldings()));
api.get('/categories', (_req, res) => res.json(q.listCategories()));
api.get('/status', (req, res) => {
  const d = getDb();
  const counts: Record<string, number> = {};
  for (const t of ['accounts', 'transactions', 'categories', 'budgets', 'recurrings', 'holdings', 'balance_history', 'goals']) counts[t] = (d.prepare(`SELECT COUNT(*) n FROM ${t}`).get() as any).n;
  const queued = (d.prepare(`SELECT COUNT(*) n FROM pending_writes WHERE status = 'queued'`).get() as any).n;
  const conns = listConnections();
  res.json({
    last_sync: getMeta('last_sync') ?? null, last_sync_report: safeJson(getMeta('last_sync_report')), counts, queued_writes: queued,
    copilot: { enabled: config.copilotEnabled, command: config.copilotCommand, args: config.copilotArgs, live: config.copilotLiveEnabled, write: config.copilotWriteEnabled },
    connections: { total: conns.length, needs_attention: conns.filter((c) => c.status !== 'ok' && c.status !== 'syncing').length },
    plaid: { configured: config.plaid.configured, env: config.plaid.env },
    auth: { token: Boolean(config.token), local: isLocal(req) },
    assistant: { configured: Boolean(config.anthropicKey), model: config.model }, mcp: { tools: publicTools.map((t) => t.name) },
  });
});
api.post('/sync', wrap(async (req, res) => res.json(await syncAll({ ...(req.body ?? {}), force: true }))));

// Bank connections. Adding one hands Keel bank credentials, so without KEEL_TOKEN only this Mac may do it.
const localOrToken = (req: Request, res: Response, next: NextFunction) => (config.token || isLocal(req) ? next() : res.status(403).json({ error: 'Connect banks from Keel on this Mac, or set KEEL_TOKEN to do it from other devices.' }));
api.get('/connections', wrap(async (_req, res) => res.json(await runTool('get_connections', {}))));
api.post('/connections/simplefin', localOrToken, wrap(async (req, res) => res.json(await runTool('add_simplefin_connection', req.body))));
api.post('/connections/plaid/link-token', localOrToken, wrap(async (req, res) => res.json(await runTool('plaid_create_link_token', req.body ?? {}))));
api.post('/connections/plaid/exchange', localOrToken, wrap(async (req, res) => res.json(await runTool('plaid_exchange_public_token', req.body))));
api.post('/connections/:id/sync', wrap(async (req, res) => res.json(await runTool('sync_now', { connection_id: req.params.id }))));
api.post('/connections/:id/repaired', wrap(async (req, res) => res.json(await runTool('connection_repaired', { connection_id: req.params.id }))));
api.delete('/connections/:id', localOrToken, wrap(async (req, res) => res.json(await runTool('remove_connection', { connection_id: req.params.id, delete_data: bool(req.query.delete_data) ?? false }))));
api.patch('/accounts/:id', wrap(async (req, res) => res.json(await runTool('update_account', { account_id: req.params.id, ...req.body }))));
api.post('/accounts/:id/switch', wrap(async (req, res) => res.json(await runTool('switch_account_to_connection', { account_id: req.params.id, ...req.body }))));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
api.post('/import/csv', upload.single('file'), wrap(async (req, res) => {
  const text = req.file ? req.file.buffer.toString('utf8') : typeof req.body?.text === 'string' ? req.body.text : '';
  if (!text) return res.status(400).json({ error: 'Send a CSV file as multipart field "file" or JSON {text}' });
  res.json(importCopilotCsv(text));
}));
api.get('/chat/:conversationId', (req, res) => {
  const rows = getDb().prepare('SELECT role, content, created_at FROM chat_messages WHERE conversation_id = ? ORDER BY id').all(req.params.conversationId) as any[];
  res.json(rows.map((r) => ({ ...r, content: JSON.parse(r.content) })));
});
api.delete('/chat/:conversationId', (req, res) => {
  getDb().prepare('DELETE FROM chat_messages WHERE conversation_id = ?').run(req.params.conversationId);
  res.json({ ok: true });
});
api.post('/assistant', async (req, res) => {
  const { conversation_id = 'default', message } = req.body ?? {};
  if (typeof message !== 'string' || !message.trim()) return res.status(400).json({ error: 'message required' });
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  const write = (ev: Record<string, unknown>) => res.write(`data: ${JSON.stringify(ev)}\n\n`);
  try {
    await chat(String(conversation_id), message, write);
  } catch (e) {
    write({ type: 'error', message: (e as Error).message });
    write({ type: 'done' });
  }
  res.end();
});
api.get('/tools', (_req, res) => res.json(tools.map((t) => ({ name: t.name, description: t.description, read_only: t.readOnly, internal: Boolean(t.internal) }))));
api.post('/tools/:name', (req, res, next) => (toolMap.get(req.params.name)?.internal ? localOrToken(req, res, next) : next()), wrap(async (req, res) => res.json(await runTool(req.params.name, req.body ?? {}))));
app.use('/api', api);

// ---- MCP over Streamable HTTP (stateless: one server+transport per request) ----
app.all('/mcp', async (req, res) => {
  const server = buildMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => { transport.close(); server.close(); });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: (e as Error).message }, id: null });
  }
});

// ---- static PWA ----
// The design system's component classes are served from design/ so the app never forks them.
app.get('/components.css', (_req, res) => res.sendFile(path.join(designDir, 'components.css')));
app.use(express.static(webDir, { extensions: ['html'] }));
app.get('*', (_req, res) => res.sendFile(path.join(webDir, 'index.html')));

// ---- errors ----
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  res.status(500).json({ error: err.message });
});

app.listen(config.port, config.host, () => {
  console.log(`Keel  →  http://localhost:${config.port}   (MCP at /mcp, API at /api)`);
  if (config.token) console.log(`Token auth on. First open on each device: http://<host>:${config.port}/?token=<KEEL_TOKEN>`);
  else if (connectionCount() > 0) console.log('Bank connections exist and KEEL_TOKEN is unset: only this Mac can open Keel. Set KEEL_TOKEN to use it from your phone.');
  if (config.syncMinutes > 0) {
    const run = () => syncAll().then((r) => console.log(`[sync] ${JSON.stringify(r.counts)}${r.warnings.length ? ' warnings: ' + r.warnings.join(' | ') : ''}`)).catch((e) => console.error('[sync] failed:', e.message));
    setTimeout(run, 3000);
    setInterval(run, config.syncMinutes * 60_000);
  }
});

// ---- helpers ----
/** Query → TxFilter. Multi-value params are comma-separated (`accounts=a,b`). */
function txFilter(req: Request): q.TxFilter {
  const qs = req.query;
  return {
    month: str(qs.month), start: str(qs.start), end: str(qs.end), query: str(qs.q), category_id: str(qs.category_id), account_id: str(qs.account_id),
    pending: bool(qs.pending), unreviewed: bool(qs.unreviewed), uncategorized: bool(qs.uncategorized), include_transfers: bool(qs.transfers), include_excluded: bool(qs.excluded),
    min_amount: num(qs.min), max_amount: num(qs.max),
    account_ids: list(qs.accounts), category_ids: list(qs.categories), tags: list(qs.tags),
    types: list(qs.types)?.filter((t): t is q.TxType => ['regular', 'income', 'transfer'].includes(t)),
    statuses: list(qs.statuses)?.filter((t): t is q.TxStatus => ['pending', 'unreviewed', 'excluded'].includes(t)),
    sort: (['date', 'amount', 'name'] as const).find((s) => s === qs.sort), dir: qs.dir === 'asc' ? 'asc' : qs.dir === 'desc' ? 'desc' : undefined,
    limit: num(qs.limit), offset: num(qs.offset),
  };
}
function list(v: unknown): string[] | undefined { const s = str(v); return s ? s.split(',').map((x) => x.trim()).filter(Boolean) : undefined; }
function str(v: unknown): string | undefined { return typeof v === 'string' && v !== '' ? v : undefined; }
function num(v: unknown): number | undefined { const n = Number(v); return typeof v === 'string' && v !== '' && Number.isFinite(n) ? n : undefined; }
function bool(v: unknown): boolean | undefined { return v === 'true' || v === '1' ? true : v === 'false' || v === '0' ? false : undefined; }
function safeJson(s: string | undefined): unknown { try { return s ? JSON.parse(s) : null; } catch { return null; } }
function wrap(fn: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);
}
