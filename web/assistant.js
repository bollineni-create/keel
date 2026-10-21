// Assistant — docs/screens/assistant.md. The front door of Keel: the home screen (conversation rail + chat)
// and the dock that rides alongside every other screen (⌘J). Both are one `chatView` over /api/assistant,
// the same tool registry Claude reaches over MCP, so what the assistant does here is what Claude does there.
import { $, h, esc, ago, api, cached, invalidate, store, toast, isMac, I, titleBar, iconBtn, sheet, menu, emptyState } from './lib.js';

const CONV_KEY = 'keel-conv';
const mod = isMac ? '⌘' : 'Ctrl+';
const newId = () => 'c_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
export const currentConversation = () => store.get(CONV_KEY, null);
const setCurrent = (id) => store.set(CONV_KEY, id);

// Where a tool call's data lives in the app, so each call card links to the screen that shows it.
const TOOL_SCREENS = {
  get_overview: () => '#/dashboard', get_month_summary: () => '#/dashboard',
  get_transactions: (i) => txRoute(i), find_unusual_transactions: (i) => txRoute(i), get_similar_transactions: (i) => (i?.transaction_id ? `#/transactions?id=${encodeURIComponent(i.transaction_id)}` : '#/transactions'),
  update_transaction: (i) => (i?.transaction_id ? `#/transactions?id=${encodeURIComponent(i.transaction_id)}` : '#/transactions'), split_transaction: (i) => (i?.transaction_id ? `#/transactions?id=${encodeURIComponent(i.transaction_id)}` : '#/transactions'),
  bulk_update_transactions: () => '#/transactions', review_transactions: () => '#/transactions?statuses=unreviewed', create_transaction: () => '#/transactions', delete_transactions: () => '#/transactions',
  get_spending_by_category: (i) => `#/categories${i?.month ? `?month=${i.month}` : ''}`, get_budgets: (i) => `#/categories${i?.month ? `?month=${i.month}` : ''}`, set_budget: () => '#/categories', get_categories: () => '#/categories',
  get_accounts: () => '#/accounts', get_net_worth_history: () => '#/accounts', get_recurring: () => '#/recurrings', get_holdings: () => '#/investments', get_goals: () => '#/goals', get_spending_trend: () => '#/cashflow',
};
function txRoute(i = {}) {
  const qs = new URLSearchParams();
  if (i.category_id) qs.set('categories', i.category_id);
  if (i.account_id) qs.set('accounts', i.account_id);
  if (i.month) qs.set('month', i.month);
  if (i.query) qs.set('q', i.query);
  if (i.unreviewed) qs.set('statuses', 'unreviewed');
  const s = qs.toString();
  return '#/transactions' + (s ? '?' + s : '');
}
const toolLabel = (name) => { const s = name.replace(/_/g, ' '); return s.charAt(0).toUpperCase() + s.slice(1); };
const toolSummary = (input) => {
  if (!input || typeof input !== 'object') return '';
  return Object.entries(input).filter(([, v]) => v != null && v !== '' && !(Array.isArray(v) && !v.length)).slice(0, 4)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? `${v.length} items` : typeof v === 'object' ? '…' : String(v).slice(0, 40)}`).join(' · ');
};

// ---------- markdown-lite (bold, code, em, links to Keel routes, lists, tables, headings) ----------
export function md(text) {
  const lines = esc(text).split('\n');
  let out = '', inTable = false, list = null;
  const inline = (s) => s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(?<!\*)\*(?!\*)([^*]+)\*(?!\*)/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\((#\/[^)\s]*|https?:\/\/[^)\s]+)\)/g, (_, t, href) => `<a class="chat-link" href="${href}" ${href.startsWith('http') ? 'target="_blank" rel="noopener"' : ''}>${t}</a>`);
  const closeList = () => { if (list) { out += `</${list}>`; list = null; } };
  for (const l of lines) {
    if (/^\s*\|/.test(l)) {
      closeList();
      if (/^\s*\|[\s:|-]+\|?\s*$/.test(l)) continue;
      const cells = l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      if (!inTable) { out += '<table><tr>' + cells.map((c) => `<th>${inline(c)}</th>`).join('') + '</tr>'; inTable = true; }
      else out += '<tr>' + cells.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>';
      continue;
    }
    if (inTable) { out += '</table>'; inTable = false; }
    const ul = /^\s*[-*•]\s+(.*)/.exec(l), ol = /^\s*\d+[.)]\s+(.*)/.exec(l);
    if (ul || ol) { const kind = ul ? 'ul' : 'ol'; if (list !== kind) { closeList(); out += `<${kind}>`; list = kind; } out += `<li>${inline((ul || ol)[1])}</li>`; continue; }
    closeList();
    if (/^#{1,4}\s/.test(l)) { out += `<p class="chat-h">${inline(l.replace(/^#+\s/, ''))}</p>`; continue; }
    if (l.trim() === '' || l.trim() === '---') continue;
    out += `<p>${inline(l)}</p>`;
  }
  if (inTable) out += '</table>';
  closeList();
  return out;
}

// ---------- starters: what's worth asking right now ----------
async function starters() {
  const out = [];
  try {
    const [s, b] = await Promise.all([api('/summary'), api('/budgets')]);
    if (s.unreviewed) out.push(`Review my ${s.unreviewed} unreviewed transaction${s.unreviewed === 1 ? '' : 's'}`);
    const over = b.items.filter((i) => i.status === 'over').sort((x, y) => y.pct - x.pct)[0];
    const warn = b.items.filter((i) => i.status === 'warn').sort((x, y) => y.pct - x.pct)[0];
    if (over) out.push(`Why am I over on ${over.name}?`);
    else if (warn) out.push(`Will I stay under budget on ${warn.name}?`);
  } catch { /* starters are a nicety */ }
  for (const q of ['How am I doing this month?', 'What looks unusual?', 'What subscriptions can I cut?', 'What’s due in the next two weeks?', 'How did last month compare?']) if (out.length < 6 && !out.includes(q)) out.push(q);
  return out;
}

// ---------- chat view (shared by the screen and the dock) ----------
/**
 * One conversation: transcript, starters, composer. `opts.compact` is the dock variant.
 * Returns { el, load(convId), send(text), destroy }.
 */
export function chatView({ compact = false, context = () => null, onConversation = () => {} } = {}) {
  let conv = null, busy = null, ready = null;
  const el = h(`<div class="chat ${compact ? 'chat--compact' : ''}">
    <div class="chat__log" role="log" aria-live="polite"></div>
    <div class="chat__foot">
      <div class="chat__starters" hidden></div>
      <form class="chat__composer">
        <textarea class="k-input chat__input" rows="1" placeholder="Ask about your money…" aria-label="Message" autocomplete="off"></textarea>
        <button class="k-btn k-btn--primary chat__send" type="submit" aria-label="Send">${I.send}</button>
        <button class="k-btn chat__stop" type="button" aria-label="Stop" hidden>${I.stop}</button>
      </form>
      <p class="chat__hint body-sm">Enter to send · Shift+Enter for a new line · Keel reads and edits through the same tools Claude gets over MCP.</p>
    </div></div>`);
  const log = $('.chat__log', el), input = $('.chat__input', el), form = $('.chat__composer', el), startersBox = $('.chat__starters', el), sendBtn = $('.chat__send', el), stopBtn = $('.chat__stop', el);

  const nearBottom = () => log.scrollHeight - log.scrollTop - log.clientHeight < 80;
  const scroll = (force) => { if (force || nearBottom()) log.scrollTop = log.scrollHeight; };
  const bubble = (role, html) => { const m = h(`<div class="chat-msg chat-msg--${role}"></div>`); m.innerHTML = html; log.append(m); return m; };
  const toolCard = (name, input, id) => {
    const route = TOOL_SCREENS[name]?.(input);
    const card = h(`<details class="chat-tool" data-tool="${esc(id || '')}">
      <summary><i class="dot chat-tool__dot"></i><span class="chat-tool__name">${esc(toolLabel(name))}</span><span class="chat-tool__sum body-sm">${esc(toolSummary(input))}</span>${route ? `<a class="chat-tool__open k-btn" href="${route}">Open</a>` : ''}</summary>
      <pre class="chat-tool__input">${esc(JSON.stringify(input ?? {}, null, 2))}</pre></details>`);
    log.append(card);
    return card;
  };
  const markTool = (id, ok, error) => {
    const card = id && log.querySelector(`[data-tool="${CSS.escape(id)}"]`);
    if (!card) return;
    card.classList.add(ok ? 'is-ok' : 'is-err');
    if (error) card.append(h(`<p class="chat-tool__err body-sm">${esc(error)}</p>`));
  };
  const autosize = () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 180) + 'px'; };

  async function showStarters() {
    const list = await (ready ??= starters());
    startersBox.innerHTML = list.slice(0, compact || !matchMedia('(min-width: 900px)').matches ? 3 : 6).map((s) => `<button class="k-btn chat__starter" type="button">${esc(s)}</button>`).join('');
    startersBox.hidden = false;
  }
  function welcome() {
    log.replaceChildren(h(`<div class="chat-welcome">
      <span class="k-empty__disc chat-welcome__disc">${I.chat}</span>
      <h2 class="h1">${compact ? 'Ask Keel' : 'What do you want to know?'}</h2>
      <p class="body chat-welcome__sub">Every account, transaction, budget and recurring charge is a question away. Keel can also review, categorize, split and budget for you.</p></div>`));
  }

  async function load(id) {
    conv = id || currentConversation() || newId();
    setCurrent(conv);
    onConversation(conv);
    log.replaceChildren(h('<div class="skel-list chat__skel"><i class="skel chat__skel-a"></i><i class="skel chat__skel-b"></i><i class="skel chat__skel-a"></i></div>'));
    let history = [];
    try { history = await api('/chat/' + encodeURIComponent(conv)); } catch (e) { log.replaceChildren(h(`<div class="pane-error body-sm">${esc(e.message)}</div>`)); return; }
    if (conv !== (id || conv)) return;
    log.replaceChildren();
    if (!history.length) { welcome(); showStarters(); }
    else {
      startersBox.hidden = true;
      for (const m of history) {
        if (typeof m.content === 'string') { bubble('user', esc(m.content)); continue; }
        for (const b of m.content) {
          if (b.type === 'text' && b.text.trim()) bubble(m.role, md(b.text));
          else if (b.type === 'tool_use') toolCard(b.name, b.input, b.id);
          else if (b.type === 'tool_result') markTool(b.tool_use_id, !b.is_error, b.is_error ? String(b.content).slice(0, 200) : '');
        }
      }
    }
    scroll(true);
  }

  async function send(text) {
    text = String(text ?? '').trim();
    if (!text || busy) return;
    if (!conv) await load();
    startersBox.hidden = true;
    if (log.querySelector('.chat-welcome')) log.replaceChildren();
    bubble('user', esc(text));
    input.value = ''; autosize();
    scroll(true);
    const first = !log.querySelector('.chat-msg--assistant');
    busy = new AbortController();
    el.classList.add('is-busy'); stopBtn.hidden = false; sendBtn.hidden = true;
    let cur = null, buf = '', typing = h('<div class="chat-typing"><i></i><i></i><i></i></div>');
    log.append(typing);
    try {
      const res = await fetch('/api/assistant', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ conversation_id: conv, message: text, context: context() }), signal: busy.signal });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
      const reader = res.body.getReader(), dec = new TextDecoder();
      let carry = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        carry += dec.decode(value, { stream: true });
        const parts = carry.split('\n\n'); carry = parts.pop();
        for (const p of parts) {
          if (!p.startsWith('data: ')) continue;
          const ev = JSON.parse(p.slice(6));
          typing.remove();
          if (ev.type === 'text') { if (!cur) { cur = bubble('assistant', ''); buf = ''; } buf += ev.text; cur.innerHTML = md(buf); }
          else if (ev.type === 'tool') { cur = null; toolCard(ev.name, ev.input, ev.id); log.append(typing); }
          else if (ev.type === 'tool_result') markTool(ev.id, ev.ok, ev.error);
          else if (ev.type === 'error') { cur = null; bubble('assistant', `<p class="chat-error">${esc(ev.message)}</p>${/API_KEY/.test(ev.message) ? '<p><button class="k-btn" data-act="settings" type="button">Open Settings</button></p>' : ''}`); }
          scroll();
        }
      }
    } catch (e) {
      if (e.name !== 'AbortError') bubble('assistant', `<p class="chat-error">${esc(e.message)}</p>`);
    } finally {
      typing.remove();
      busy = null;
      el.classList.remove('is-busy'); stopBtn.hidden = true; sendBtn.hidden = false;
      scroll();
      if (first) onConversation(conv, { changed: true });
      // Tool calls may have edited data: refresh what the rest of the app shows.
      invalidate('/accounts?hidden=true&closed=true', '/categories', '/goals', '/tags');
      dispatchEvent(new CustomEvent('keel:assistant-done'));
    }
  }

  function newChat() { load(newId()); input.focus(); }

  form.addEventListener('submit', (e) => { e.preventDefault(); send(input.value); });
  input.addEventListener('input', autosize);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(input.value); } });
  stopBtn.addEventListener('click', () => busy?.abort());
  startersBox.addEventListener('click', (e) => { const b = e.target.closest('.chat__starter'); if (b) send(b.textContent); });

  return { el, load, send, newChat, focus: () => input.focus(), get conversation() { return conv; }, destroy() { busy?.abort(); } };
}

// ---------- conversation rail ----------
async function conversationList(active) {
  let convs = [];
  try { convs = await api('/chat'); } catch { /* empty rail */ }
  if (active && !convs.some((c) => c.id === active)) convs.unshift({ id: active, title: 'New chat', updated_at: new Date().toISOString(), messages: 0, draft: true });
  return convs;
}
function railHtml(convs, active) {
  if (!convs.length) return `<p class="body-sm sidebar__hint">Your conversations will appear here.</p>`;
  return convs.map((c) => `<a class="k-nav__item chat-rail__item ${c.id === active ? 'k-nav__item--active' : ''}" href="#/?c=${encodeURIComponent(c.id)}" title="${esc(c.title)}">
    <span class="chat-rail__title">${esc(c.title)}</span><span class="chat-rail__when body-sm">${c.draft ? '' : ago(c.updated_at)}</span>
    <button class="k-btn k-btn--icon chat-rail__more" data-conv="${esc(c.id)}" aria-label="Conversation actions" type="button">${I.more}</button></a>`).join('');
}

// ---------- the Assistant screen (home) ----------
export async function assistantScreen(params, shell) {
  const status = await cached('/status').catch(() => null);
  const main = h(`<section class="pane pane--chat" aria-label="Assistant">
    ${titleBar(`<span class="pane-title">Assistant</span>${status && !status.assistant.configured ? '<span class="chip amber">no API key</span>' : ''}`,
      `<button class="k-btn k-btn--icon show-sm" data-act="chat-list" aria-label="Conversations" title="Conversations">${I.menu}</button><button class="k-btn" data-act="new-chat">${I.plus}<span class="hide-sm">New chat</span></button>`)}
    <div class="chat__body"></div></section>`);
  const rail = h(`<aside class="pane pane--surface pane--rail" aria-label="Conversations">
    ${titleBar('<span class="pane-title">Conversations</span>')}
    <nav class="k-nav chat-rail"></nav>
    <div class="chat-rail__foot body-sm">${status ? `${esc(status.assistant.model)} · ${status.mcp.tools.length} tools` : ''}</div></aside>`);
  const railNav = $('.chat-rail', rail);

  const view = chatView({ context: () => ({ screen: 'Assistant' }), onConversation: (id, { changed } = {}) => { if (changed) refreshRail(); else paintActive(id); } });
  $('.chat__body', main).append(view.el);

  async function refreshRail() { railNav.innerHTML = railHtml(await conversationList(view.conversation), view.conversation); }
  function paintActive(id) { railNav.querySelectorAll('.chat-rail__item').forEach((a) => a.classList.toggle('k-nav__item--active', a.getAttribute('href') === `#/?c=${encodeURIComponent(id)}`)); if (!railNav.querySelector('.k-nav__item--active')) refreshRail(); }

  async function convActions(anchor, id) {
    menu(anchor, [
      { label: 'Open', icon: I.chat, run: () => (location.hash = '#/?c=' + encodeURIComponent(id)) },
      { label: 'Delete conversation', icon: I.x, danger: true, run: async () => {
        try { await api('/chat/' + encodeURIComponent(id), { method: 'DELETE' }); toast('Conversation deleted'); if (id === view.conversation) view.newChat(); await refreshRail(); } catch (e) { toast(e.message); }
      } },
    ], { align: 'end' });
  }
  rail.addEventListener('click', (e) => { const b = e.target.closest('.chat-rail__more'); if (b) { e.preventDefault(); convActions(b, b.dataset.conv); } });
  main.addEventListener('click', async (e) => {
    if (e.target.closest('[data-act="new-chat"]')) { history.replaceState(null, '', '#/'); view.newChat(); refreshRail(); }
    if (e.target.closest('[data-act="chat-list"]')) {
      const convs = await conversationList(view.conversation);
      const s = sheet(`<div class="form"><header class="form__head"><h2 class="h2">Conversations</h2>${iconBtn(I.x, 'Close', 'data-act="close-sheet"')}</header><nav class="k-nav more__nav">${railHtml(convs, view.conversation)}</nav></div>`, { label: 'Conversations' });
      s.el.addEventListener('click', (ev) => { const b = ev.target.closest('.chat-rail__more'); if (b) { ev.preventDefault(); s.close(); return convActions(main.querySelector('[data-act="chat-list"]'), b.dataset.conv); } if (ev.target.closest('a')) s.close(); });
    }
  });

  await view.load(params.get('c') || undefined);
  if (params.get('q')) view.send(params.get('q'));
  refreshRail();
  setTimeout(() => view.focus(), 0);
  return {
    rail, main,
    focus: () => view.focus(),
    onKey(e) { if (e.key === '/') { e.preventDefault(); view.focus(); } },
    update(p) { const c = p.get('c'); if (c && c !== view.conversation) view.load(c); },
    destroy() { view.destroy(); },
  };
}

// ---------- the dock (assistant beside any other screen) ----------
let dock = null;
export function mountDock(host, { screenName }) {
  if (dock) return dock;
  const view = chatView({ compact: true, context: () => ({ screen: screenName(), route: location.hash || '#/' }) });
  host.replaceChildren(h(`<header class="k-titlebar pane-bar dock__bar"><div class="k-titlebar__title"><span class="pane-title">Ask Keel</span><kbd>${mod}J</kbd></div>
    <div class="k-titlebar__actions"><button class="k-btn k-btn--icon" data-act="new-chat" aria-label="New chat" title="New chat">${I.plus}</button><a class="k-btn k-btn--icon" href="#/" aria-label="Open the Assistant" title="Open the Assistant">${I.expand}</a>${iconBtn(I.x, 'Close', 'data-act="dock"')}</div></header>`), view.el);
  host.addEventListener('click', (e) => { if (e.target.closest('[data-act="new-chat"]')) view.newChat(); });
  view.load();
  dock = { view, destroy() { view.destroy(); host.replaceChildren(); dock = null; } };
  return dock;
}
export const dockMounted = () => dock;
export function unmountDock() { dock?.destroy(); }
