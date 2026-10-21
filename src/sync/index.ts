/**
 * Every data source behind one entry point. Copilot (via copilot-money-mcp) is one source; each direct
 * bank connection (Plaid, SimpleFIN) in the connections table is another. The scheduler, POST /api/sync,
 * the sync_now tool, the CLI and the Mac app's Sync Now all call syncAll().
 */
import { config } from '../config.js';
import { getDb, nowIso, setMeta } from '../db.js';
import { getConnection, listConnectionRows, updateConnection, type ConnectionRow, type ConnectionStatus, type ProviderId } from './connections.js';
import { syncFromCopilot, type SyncReport as CopilotReport } from './copilot.js';
import { backfillBalances, categorizeFromHistory, ensureCategories, matchTransfers, snapshotBalances } from './enrich.js';
import { plaidProvider } from './plaid.js';
import { ConnectionError, type DirectProvider } from './provider.js';
import { redact } from './secrets.js';
import { simplefinProvider } from './simplefin.js';

export const directProviders: Record<ProviderId, DirectProvider> = { plaid: plaidProvider, simplefin: simplefinProvider };

export interface ConnectionReport {
  connection_id: string;
  provider: ProviderId;
  institution: string | null;
  status: ConnectionStatus;
  error: string | null;
  counts: Record<string, number>;
  warnings: string[];
  /** Why this connection wasn't synced this time (synced recently, quota). */
  skipped?: string;
}

export interface SyncReport extends CopilotReport {
  copilot: 'synced' | 'off' | 'skipped';
  connections: ConnectionReport[];
}

export interface SyncOptions {
  /** Only this connection. */
  connection_id?: string;
  /** Only this source. */
  provider?: 'copilot' | ProviderId;
  /** A person asked: ignore the scheduled interval (each provider still enforces its request floor). */
  force?: boolean;
}

let running: Promise<SyncReport> | null = null;

/** One sync at a time; a call during a run gets that run's report. */
export function syncAll(opts: SyncOptions = {}): Promise<SyncReport> {
  if (running) return running;
  running = run(opts).finally(() => (running = null));
  return running;
}

function due(c: ConnectionRow, p: DirectProvider, force: boolean): string | null {
  if (c.status === 'syncing' && c.last_attempt && Date.now() - Date.parse(c.last_attempt) < 10 * 60_000) return 'already syncing';
  const last = c.last_attempt ? Date.parse(c.last_attempt) : 0;
  const mins = (Date.now() - last) / 60_000;
  const wait = force ? p.forcedFloorMinutes : p.minIntervalMinutes;
  if (mins < wait) return `synced ${Math.round(mins)} min ago; ${p.label} allows one sync every ${wait} min`;
  return null;
}

async function syncConnection(c: ConnectionRow, force: boolean): Promise<ConnectionReport> {
  const p = directProviders[c.provider];
  const base = { connection_id: c.id, provider: c.provider, institution: c.institution, counts: {}, warnings: [] as string[] };
  if (!p) return { ...base, status: 'error', error: `Unknown provider ${c.provider}` };
  const skip = due(c, p, force);
  if (skip) return { ...base, status: c.status, error: c.error, skipped: skip };
  const started = nowIso();
  updateConnection(c.id, { last_attempt: started, status: 'syncing' });
  try {
    ensureCategories();
    const r = await p.sync(getConnection(c.id));
    const counts = { ...r.counts };
    counts.categorized = categorizeFromHistory(c.id);
    counts.transfers = matchTransfers(c.id);
    snapshotBalances(c.id);
    backfillBalances(c.id);
    const status = r.status ?? 'ok';
    updateConnection(c.id, { status, error: r.error ?? null, last_synced: started });
    const fresh = getConnection(c.id);
    return { ...base, institution: fresh.institution, status, error: r.error ? redact(r.error) : null, counts, warnings: r.warnings.map(redact) };
  } catch (e) {
    const status: ConnectionStatus = e instanceof ConnectionError ? e.status : 'error';
    const message = redact((e as Error).message);
    // A quota stop isn't a broken connection: keep the previous status.
    const keep = e instanceof ConnectionError && e.code === 'budget';
    updateConnection(c.id, keep ? { status: c.status === 'syncing' ? 'ok' : c.status } : { status, error: message });
    // The whole login is broken: every account behind it shows "Verification needed". (A partial failure,
    // like one bank behind a SimpleFIN token, flags only its own accounts in the provider.)
    if (status === 'needs_reauth' && !keep) getDb().prepare('UPDATE accounts SET needs_attention = 1 WHERE connection_id = ?').run(c.id);
    return { ...base, status: keep ? 'ok' : status, error: message };
  }
}

async function run(opts: SyncOptions): Promise<SyncReport> {
  const report: SyncReport = { startedAt: nowIso(), finishedAt: '', counts: {}, warnings: [], copilot: 'skipped', connections: [] };
  let anything = false;

  const wantCopilot = !opts.connection_id && (!opts.provider || opts.provider === 'copilot');
  if (!config.copilotEnabled) report.copilot = 'off';
  else if (wantCopilot) {
    const r = await syncFromCopilot();
    report.copilot = 'synced';
    Object.assign(report.counts, r.counts);
    report.warnings.push(...r.warnings.map((w) => `Copilot ${w}`));
    if (Object.keys(r.counts).length) anything = true;
  }

  const targets = listConnectionRows().filter((c) => (!opts.connection_id || c.id === opts.connection_id) && (!opts.provider || opts.provider === c.provider));
  if (opts.connection_id && !targets.length) throw new Error(`No connection ${opts.connection_id}`);
  for (const c of targets) {
    const r = await syncConnection(c, Boolean(opts.force || opts.connection_id));
    report.connections.push(r);
    if (r.skipped) continue;
    const who = r.institution ?? directProviders[c.provider]?.label ?? c.provider;
    if (r.error) report.warnings.push(`${who}: ${r.error}`);
    report.warnings.push(...r.warnings.map((w) => `${who}: ${w}`));
    for (const [k, v] of Object.entries(r.counts)) report.counts[k] = (report.counts[k] ?? 0) + v;
    if (r.status !== 'error' && !(r.status === 'needs_reauth' && !Object.keys(r.counts).length)) anything = true;
  }

  report.finishedAt = nowIso();
  if (anything) setMeta('last_sync', report.finishedAt);
  setMeta('last_sync_report', JSON.stringify(report));
  return report;
}
