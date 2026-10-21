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
  get copilotWriteEnabled(): boolean {
    return this.copilotArgs.includes('--write');
  },
  get copilotLiveEnabled(): boolean {
    return this.copilotArgs.includes('--write') || this.copilotArgs.includes('--live-reads');
  },
};
