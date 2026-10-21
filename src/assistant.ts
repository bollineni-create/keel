/**
 * In-app assistant: Anthropic Messages API with tool use over the Keel tool registry.
 * Streams Server-Sent Events: {type:'text', text} | {type:'tool', name, input} | {type:'tool_result', name, ok} | {type:'done'} | {type:'error', message}
 */
import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.js';
import { getDb, nowIso } from './db.js';
import { anthropicTools, runTool } from './tools.js';
import { monthKey } from './queries.js';

const SYSTEM = `You are Keel, the assistant inside Naren's self-hosted personal finance app. All of his accounts, transactions, budgets, recurring charges and investments are available through tools; use them rather than guessing, and prefer get_overview first for broad questions.

Conventions: amounts are positive for spending and negative for income or refunds. Today's month is ${monthKey()}. Money is USD; format as $1,234.56 and sign changes (+$120.00, −$42.17).

Style: short, specific, numbers first. Say what the number means ("83% of the dining budget with 11 days left"). Do not pad, do not restate the question, no emoji. When you change data (categorize, review, set a budget), say exactly what changed and whether it was pushed to Copilot Money or queued. Ask before bulk edits over 20 rows.`;

export type SseWriter = (event: Record<string, unknown>) => void;

type Msg = Anthropic.MessageParam;

export function loadHistory(conversationId: string): Msg[] {
  const rows = getDb().prepare('SELECT role, content FROM chat_messages WHERE conversation_id = ? ORDER BY id').all(conversationId) as Array<{ role: 'user' | 'assistant'; content: string }>;
  return rows.map((r) => ({ role: r.role, content: JSON.parse(r.content) }));
}

function saveMessage(conversationId: string, role: 'user' | 'assistant', content: unknown): void {
  getDb().prepare('INSERT INTO chat_messages(conversation_id, role, content, created_at) VALUES (?,?,?,?)').run(conversationId, role, JSON.stringify(content), nowIso());
}

export async function chat(conversationId: string, userText: string, write: SseWriter): Promise<void> {
  if (!config.anthropicKey) {
    write({ type: 'error', message: 'ANTHROPIC_API_KEY is not set. Add it to .env and restart Keel.' });
    write({ type: 'done' });
    return;
  }
  const client = new Anthropic({ apiKey: config.anthropicKey });
  const messages: Msg[] = loadHistory(conversationId).slice(-40);
  messages.push({ role: 'user', content: userText });
  saveMessage(conversationId, 'user', userText);
  const tools = anthropicTools() as Anthropic.Tool[];

  for (let turn = 0; turn < 12; turn++) {
    const stream = client.messages.stream({ model: config.model, max_tokens: 2048, system: SYSTEM, messages, tools });
    stream.on('text', (text) => write({ type: 'text', text }));
    const final = await stream.finalMessage();
    messages.push({ role: 'assistant', content: final.content });
    saveMessage(conversationId, 'assistant', final.content);

    const toolUses = final.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    if (final.stop_reason !== 'tool_use' || !toolUses.length) break;

    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      write({ type: 'tool', name: tu.name, input: tu.input });
      try {
        const out = await runTool(tu.name, tu.input);
        results.push({ type: 'tool_result', tool_use_id: tu.id, content: truncate(JSON.stringify(out)) });
        write({ type: 'tool_result', name: tu.name, ok: true });
      } catch (e) {
        results.push({ type: 'tool_result', tool_use_id: tu.id, content: `Error: ${(e as Error).message}`, is_error: true });
        write({ type: 'tool_result', name: tu.name, ok: false, error: (e as Error).message });
      }
    }
    messages.push({ role: 'user', content: results });
    saveMessage(conversationId, 'user', results);
  }
  write({ type: 'done' });
}

function truncate(s: string, max = 60_000): string {
  return s.length > max ? s.slice(0, max) + `\n…[truncated ${s.length - max} chars; narrow the query]` : s;
}
