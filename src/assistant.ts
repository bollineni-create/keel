/**
 * In-app assistant: Anthropic Messages API with tool use over the Daybook tool registry.
 * Streams Server-Sent Events: {type:'text', text} | {type:'tool', id, name, input} | {type:'tool_result', id, name, ok} | {type:'done'} | {type:'error', message}
 */
import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.js';
import { getDb, nowIso } from './db.js';
import { anthropicTools, runTool } from './tools.js';
import { monthKey } from './queries.js';

const SYSTEM = `You are Daybook, the assistant inside Naren's self-hosted personal finance app. All of his accounts, transactions, budgets, recurring charges and investments are available through tools; use them rather than guessing, and prefer get_overview first for broad questions.

Conventions: amounts are positive for spending and negative for income or refunds. Today's month is ${monthKey()}. Money is USD; format as $1,234.56 and sign changes (+$120.00, −$42.17).

Style: short, specific, numbers first. Say what the number means ("83% of the dining budget with 11 days left"). Do not pad, do not restate the question, no emoji. When you change data (categorize, review, set a budget), say exactly what changed and whether it was pushed to Copilot Money, queued, or kept in Daybook (rows from bank connections, CSV imports and manual entries live only in Daybook). Ask before bulk edits over 20 rows.

You are the front door of the app, so point at the screen that holds the detail. Link with Daybook routes in markdown: [Dining this month](#/transactions?categories=CATEGORY_ID&month=YYYY-MM), [unreviewed](#/transactions?statuses=unreviewed), [a transaction](#/transactions?id=TRANSACTION_ID), [budgets](#/categories), [accounts](#/accounts), [recurring](#/recurrings), [investments](#/investments), [cash flow](#/cashflow), [goals](#/goals), [dashboard](#/dashboard). Use ids returned by tools; never invent one.`;

export interface ChatContext {
  /** Screen the user is looking at while asking, e.g. "Transactions" and its hash route. */
  screen?: string;
  route?: string;
}

export interface Conversation {
  id: string;
  title: string;
  updated_at: string;
  messages: number;
}

/** Conversations newest first; the title is the first thing the user typed. */
export function listConversations(): Conversation[] {
  const d = getDb();
  const rows = d.prepare('SELECT conversation_id id, MAX(created_at) updated_at, COUNT(*) messages FROM chat_messages GROUP BY conversation_id ORDER BY updated_at DESC').all() as Array<{ id: string; updated_at: string; messages: number }>;
  const first = d.prepare("SELECT content FROM chat_messages WHERE conversation_id = ? AND role = 'user' ORDER BY id LIMIT 1");
  return rows.map((r) => {
    let title = 'New chat';
    const row = first.get(r.id) as { content: string } | undefined;
    if (row) { try { const c = JSON.parse(row.content); if (typeof c === 'string') title = c.trim().split('\n')[0].slice(0, 80); } catch { /* keep default */ } }
    return { ...r, title };
  });
}

export type SseWriter = (event: Record<string, unknown>) => void;

type Msg = Anthropic.MessageParam;

export function loadHistory(conversationId: string): Msg[] {
  const rows = getDb().prepare('SELECT role, content FROM chat_messages WHERE conversation_id = ? ORDER BY id').all(conversationId) as Array<{ role: 'user' | 'assistant'; content: string }>;
  return rows.map((r) => ({ role: r.role, content: JSON.parse(r.content) }));
}

function saveMessage(conversationId: string, role: 'user' | 'assistant', content: unknown): void {
  getDb().prepare('INSERT INTO chat_messages(conversation_id, role, content, created_at) VALUES (?,?,?,?)').run(conversationId, role, JSON.stringify(content), nowIso());
}

export async function chat(conversationId: string, userText: string, write: SseWriter, { context, signal }: { context?: ChatContext; signal?: AbortSignal } = {}): Promise<void> {
  if (!config.anthropicKey) {
    write({ type: 'error', message: 'ANTHROPIC_API_KEY is not set. Add it to .env and restart Daybook.' });
    write({ type: 'done' });
    return;
  }
  const client = new Anthropic({ apiKey: config.anthropicKey });
  const messages: Msg[] = loadHistory(conversationId).slice(-40);
  messages.push({ role: 'user', content: userText });
  saveMessage(conversationId, 'user', userText);
  const tools = anthropicTools() as Anthropic.Tool[];
  const system = context?.screen ? `${SYSTEM}\n\nThe user is looking at the ${context.screen} screen${context.route ? ` (${context.route})` : ''} while asking; "this" and "here" refer to it.` : SYSTEM;

  for (let turn = 0; turn < 12; turn++) {
    if (signal?.aborted) break;
    const stream = client.messages.stream({ model: config.model, max_tokens: 2048, system, messages, tools }, { signal });
    let partial = '';
    stream.on('text', (text) => { partial += text; write({ type: 'text', text }); });
    let final: Anthropic.Message;
    try {
      final = await stream.finalMessage();
    } catch (e) {
      // Client went away (Stop button, closed tab): keep what was said so the transcript stays coherent.
      if (signal?.aborted) { if (partial.trim()) saveMessage(conversationId, 'assistant', [{ type: 'text', text: partial }]); return; }
      throw e;
    }
    messages.push({ role: 'assistant', content: final.content });
    saveMessage(conversationId, 'assistant', final.content);

    const toolUses = final.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    if (final.stop_reason !== 'tool_use' || !toolUses.length) break;

    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      write({ type: 'tool', name: tu.name, input: tu.input, id: tu.id });
      try {
        const out = await runTool(tu.name, tu.input);
        results.push({ type: 'tool_result', tool_use_id: tu.id, content: truncate(JSON.stringify(out)) });
        write({ type: 'tool_result', name: tu.name, ok: true, id: tu.id });
      } catch (e) {
        results.push({ type: 'tool_result', tool_use_id: tu.id, content: `Error: ${(e as Error).message}`, is_error: true });
        write({ type: 'tool_result', name: tu.name, ok: false, error: (e as Error).message, id: tu.id });
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
