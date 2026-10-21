import express, { type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { config } from './config.js';
import { getDb, getMeta } from './db.js';
import { buildMcpServer } from './mcp.js';
import { chat } from './assistant.js';
import { tools, runTool } from './tools.js';
import * as q from './queries.js';
import { syncFromCopilot } from './sync/copilot.js';
import { importCopilotCsv } from './sync/csv.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(__dirname, '../web');

getDb();
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '4mb' }));

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
api.get('/transactions', (req, res) => {
  const f: q.TxFilter = {
    month: str(req.query.month), start: str(req.query.start), end: str(req.query.end), query: str(req.query.q), category_id: str(req.query.category_id), account_id: str(req.query.account_id),
    pending: bool(req.query.pending), unreviewed: bool(req.query.unreviewed), include_transfers: bool(req.query.transfers), include_excluded: bool(req.query.excluded),
    limit: num(req.query.limit), offset: num(req.query.offset),
  };
  res.json(q.listTransactions(f));
});
api.get('/transactions/:id', (req, res) => {
  const t = q.getTransaction(req.params.id);
  t ? res.json(t) : res.status(404).json({ error: 'not found' });
});
api.patch('/transactions/:id', wrap(async (req, res) => res.json(await runTool('update_transaction', { transaction_id: req.params.id, ...req.body }))));
api.post('/transactions/review', wrap(async (req, res) => res.json(await runTool('review_transactions', req.body))));
api.get('/spending/categories', (req, res) => res.json(q.spendByCategory(str(req.query.month) ?? q.monthKey(), bool(req.query.parent_only) ?? true)));
api.get('/spending/trend', (req, res) => res.json(q.spendByMonth(num(req.query.months) ?? 12)));
api.get('/spending/daily', (req, res) => res.json(q.dailySpendCumulative(str(req.query.month) ?? q.monthKey())));
api.get('/spending/unusual', (req, res) => res.json(q.unusualTransactions(str(req.query.month) ?? q.monthKey())));
api.get('/budgets', (req, res) => res.json(q.budgetStatus(str(req.query.month) ?? q.monthKey())));
api.put('/budgets/:categoryId', wrap(async (req, res) => res.json(await runTool('set_budget', { category_id: req.params.categoryId, amount: Number(req.body.amount) }))));
api.get('/accounts', (req, res) => res.json({ accounts: q.listAccounts(bool(req.query.hidden) ?? false), net_worth: q.netWorth() }));
api.get('/networth/history', (req, res) => res.json(q.netWorthHistory(num(req.query.days) ?? 365)));
api.get('/recurring', (req, res) => res.json(q.listRecurring(str(req.query.state))));
api.get('/holdings', (_req, res) => res.json(q.listHoldings()));
api.get('/categories', (_req, res) => res.json(q.listCategories()));
api.get('/status', (_req, res) => {
  const d = getDb();
  const counts: Record<string, number> = {};
  for (const t of ['accounts', 'transactions', 'categories', 'budgets', 'recurrings', 'holdings', 'balance_history', 'goals']) counts[t] = (d.prepare(`SELECT COUNT(*) n FROM ${t}`).get() as any).n;
  const queued = (d.prepare(`SELECT COUNT(*) n FROM pending_writes WHERE status = 'queued'`).get() as any).n;
  res.json({ last_sync: getMeta('last_sync') ?? null, last_sync_report: safeJson(getMeta('last_sync_report')), counts, queued_writes: queued, copilot: { command: config.copilotCommand, args: config.copilotArgs, live: config.copilotLiveEnabled, write: config.copilotWriteEnabled }, assistant: { configured: Boolean(config.anthropicKey), model: config.model }, mcp: { tools: tools.map((t) => t.name) } });
});
api.post('/sync', wrap(async (_req, res) => res.json(await syncFromCopilot())));
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
api.get('/tools', (_req, res) => res.json(tools.map((t) => ({ name: t.name, description: t.description, read_only: t.readOnly }))));
api.post('/tools/:name', wrap(async (req, res) => res.json(await runTool(req.params.name, req.body ?? {}))));
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
app.use(express.static(webDir, { extensions: ['html'] }));
app.get('*', (_req, res) => res.sendFile(path.join(webDir, 'index.html')));

// ---- errors ----
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  res.status(500).json({ error: err.message });
});

app.listen(config.port, config.host, () => {
  console.log(`Keel  →  http://localhost:${config.port}   (MCP at /mcp, API at /api)`);
  if (config.token) console.log(`Token auth on. First open on each device: http://<host>:${config.port}/?token=${config.token}`);
  if (config.syncMinutes > 0) {
    const run = () => syncFromCopilot().then((r) => console.log(`[sync] ${JSON.stringify(r.counts)}${r.warnings.length ? ' warnings: ' + r.warnings.join(' | ') : ''}`)).catch((e) => console.error('[sync] failed:', e.message));
    setTimeout(run, 3000);
    setInterval(run, config.syncMinutes * 60_000);
  }
});

// ---- helpers ----
function str(v: unknown): string | undefined { return typeof v === 'string' && v !== '' ? v : undefined; }
function num(v: unknown): number | undefined { const n = Number(v); return typeof v === 'string' && v !== '' && Number.isFinite(n) ? n : undefined; }
function bool(v: unknown): boolean | undefined { return v === 'true' || v === '1' ? true : v === 'false' || v === '0' ? false : undefined; }
function safeJson(s: string | undefined): unknown { try { return s ? JSON.parse(s) : null; } catch { return null; } }
function wrap(fn: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);
}
