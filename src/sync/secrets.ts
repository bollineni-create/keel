/**
 * Encryption for connection secrets (Plaid access tokens, SimpleFIN access URLs) at rest.
 *
 * AES-256-GCM. The key comes from KEEL_SECRET_KEY, or a random key generated once into a 0600
 * file outside the repo (~/Library/Application Support/Keel/secret.key on macOS,
 * $XDG_CONFIG_HOME/keel/secret.key elsewhere). Back that file up with data/keel.db: without it the
 * stored connections cannot be decrypted and have to be linked again.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from '../config.js';

let key: Buffer | null = null;

export function keyFilePath(): string {
  if (process.env.KEEL_SECRET_KEY_FILE) return path.resolve(process.env.KEEL_SECRET_KEY_FILE);
  const base = process.platform === 'darwin'
    ? path.join(os.homedir(), 'Library', 'Application Support', 'Keel')
    : path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'keel');
  return path.join(base, 'secret.key');
}

function parseKey(s: string): Buffer {
  const t = s.trim();
  const b = /^[0-9a-f]{64}$/i.test(t) ? Buffer.from(t, 'hex') : Buffer.from(t, 'base64');
  if (b.length !== 32) throw new Error('KEEL_SECRET_KEY must be 32 bytes (64 hex characters or base64)');
  return b;
}

function getKey(): Buffer {
  if (key) return key;
  if (config.secretKey) return (key = parseKey(config.secretKey));
  const file = keyFilePath();
  if (fs.existsSync(file)) return (key = parseKey(fs.readFileSync(file, 'utf8')));
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const fresh = randomBytes(32);
  fs.writeFileSync(file, fresh.toString('hex') + '\n', { mode: 0o600, flag: 'wx' });
  return (key = fresh);
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', getKey(), iv);
  const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), body.toString('base64')].join(':');
}

export function decrypt(sealed: string): string {
  const [v, iv, tag, body] = sealed.split(':');
  if (v !== 'v1' || !iv || !tag || body === undefined) throw new Error('Unrecognised secret format');
  const d = createDecipheriv('aes-256-gcm', getKey(), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  try {
    return Buffer.concat([d.update(Buffer.from(body, 'base64')), d.final()]).toString('utf8');
  } catch {
    throw new Error(`Can't decrypt a stored connection: the key in ${config.secretKey ? 'KEEL_SECRET_KEY' : keyFilePath()} is not the one it was saved with`);
  }
}

/** Strip credentials, tokens and secrets from text that may reach logs, the UI or the assistant. */
export function redact(text: string): string {
  return text
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1***:***@')
    .replace(/\b(access|public|link)-(sandbox|production|development)-[0-9a-f-]{8,}/gi, '$1-$2-***')
    .replace(/("?(?:secret|access_token|client_id)"?\s*[:=]\s*"?)[^",\s}]+/gi, '$1***');
}

/** For tests. */
export function _resetKeyCache(): void {
  key = null;
}
