import 'dotenv/config';
import path from 'node:path';

function env(name: string, fallback = ''): string {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

export const config = {
  port: Number(env('PORT', '4242')),
  host: env('HOST', '0.0.0.0'),
  token: env('KEEL_TOKEN'),
  dbPath: path.resolve(env('KEEL_DB', './data/keel.db')),
  model: env('KEEL_MODEL', 'claude-sonnet-5-5'),
  anthropicKey: env('ANTHROPIC_API_KEY'),
  copilotCommand: env('COPILOT_MCP_COMMAND', 'npx'),
  copilotArgs: env('COPILOT_MCP_ARGS', '-y copilot-money-mcp').split(/\s+/).filter(Boolean),
  syncMinutes: Number(env('KEEL_SYNC_MINUTES', '30')),
  /** Set KEEL_COPILOT=off once direct connections replace Copilot entirely. */
  copilotEnabled: !/^(off|false|0|no)$/i.test(env('KEEL_COPILOT', 'on')),
  plaid: {
    clientId: env('PLAID_CLIENT_ID'),
    secret: env('PLAID_SECRET'),
    /** sandbox (fake banks, unlimited) or production (real banks; the free Trial plan lives here). */
    env: env('PLAID_ENV', 'sandbox') as 'sandbox' | 'production',
    get configured(): boolean {
      return Boolean(this.clientId && this.secret);
    },
  },
  /** Only for Link on phones / OAuth banks that need it: an HTTPS URL registered in the Plaid dashboard. */
  plaidRedirectUri: env('PLAID_REDIRECT_URI'),
  /** 32-byte key (hex or base64) for encrypting connection secrets; otherwise a key file is created outside the repo. */
  secretKey: env('KEEL_SECRET_KEY'),
  /** Extra Host names allowed when KEEL_TOKEN is unset (DNS-rebinding guard), comma-separated. */
  allowedHosts: env('KEEL_ALLOWED_HOSTS').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  get copilotWriteEnabled(): boolean {
    return this.copilotArgs.includes('--write');
  },
  get copilotLiveEnabled(): boolean {
    return this.copilotArgs.includes('--write') || this.copilotArgs.includes('--live-reads');
  },
};
