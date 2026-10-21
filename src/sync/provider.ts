/** The contract every direct bank provider (src/sync/plaid.ts, src/sync/simplefin.ts) implements. */
import type { ConnectionRow, ConnectionStatus, ProviderId } from './connections.js';

export interface ProviderResult {
  counts: Record<string, number>;
  warnings: string[];
  /** Partial success, e.g. one bank behind a SimpleFIN token needs a new login while the rest synced. */
  status?: ConnectionStatus;
  error?: string;
}

export interface DirectProvider {
  id: ProviderId;
  label: string;
  /** Scheduled syncs skip a connection synced more recently than this. */
  minIntervalMinutes: number;
  /** Even a manual "Sync now" waits this long between requests (protects request quotas). */
  forcedFloorMinutes: number;
  sync(conn: ConnectionRow): Promise<ProviderResult>;
}

/** A provider failure that tells the user what to do. `status` lands on the connection row. */
export class ConnectionError extends Error {
  constructor(message: string, readonly status: ConnectionStatus = 'error', readonly code?: string) {
    super(message);
  }
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
