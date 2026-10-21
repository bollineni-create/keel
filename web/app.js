// Keel PWA — buildless ES modules. This file is the shell (docs/screens/shell.md): sidebar, panes,
// title bars, phone tab bar + More sheet, ⌘K palette, keyboard, and the hash router.
import { $, $$, h, esc, moneyShort, txAmount, ago, api, cached, invalidate, store, toast, isTyping, isMac, hue, catTag, I, titleBar, iconBtn, sheet, closeTopSheet, closePopover } from './lib.js';
import { screens as v1, bindShell } from './v1.js';
import { transactionsScreen } from './transactions.js';

const NAV = [
  { path: '/', label: 'Dashboard', icon: I.dashboard },
  { path: '/transactions', label: 'Transactions', icon: I.list },
  { path: '/goals', label: 'Goals', icon: I.flag },
  { path: '/cashflow', label: 'Cash flow', icon: I.cashflow },
  { path: '/accounts', label: 'Accounts', icon: I.landmark },
  { path: '/investments', label: 'Investments', icon: I.trending },
  { path: '/categories', label: 'Categories', icon: I.tags },
  { path: '/recurrings', label: 'Recurrings', icon: I.repeat },
  { path: '/assistant', label: 'Assistant', icon: I.chat },
];
const TABS = ['/', '/transactions', '/categories', '/accounts', '/assistant'];
const ALIASES = { '/home': '/', '/budgets': '/categories', '/recurring': '/recurrings', '/cash-flow': '/cashflow' };
const ACCOUNT_GROUPS = [['credit', 'Credit cards'], ['depository', 'Depository'], ['investment', 'Investments'], ['loan', 'Loans'], ['other', 'Other']];
const HELP_URL = 'https://github.com/bollineni-create/keel#readme';
const mod = isMac ? '⌘' : 'Ctrl+';

const app = $('#app'), content = $('#content');
let current = null, navToken = 0, status = null;

// ---------- sidebar ----------
function renderStatic() {
  $('#sidebar').innerHTML = `
    <div class="sidebar__controls">${iconBtn(I.back, 'Back', 'data-win="back"')}${iconBtn(I.forward, 'Forward', 'data-win="forward"')}${iconBtn(I.refresh, 'Refresh', 'data-win="refresh"')}</div>
    <button class="k-search sidebar__search" data-act="palette" aria-label="Search (${mod}K)">${I.search}<span class="k-input">Search<kbd>${mod}K</kbd></span></button>
    <nav class="k-nav sidebar__nav" id="nav" aria-label="Primary"></nav>
    <div class="sidebar__accounts" id="accounts" aria-label="My accounts"></div>
    <div class="sidebar__foot">
      <button class="k-nav__item" data-act="start">${I.rocket}<span>Start here</span><i class="dot dot--warning" id="start-dot" hidden></i></button>
      <a class="k-nav__item" href="${HELP_URL}" target="_blank" rel="noopener">${I.help}<span>Get help</span></a>
      <button class="k-nav__item" data-act="settings">${I.settings}<span>Settings</span></button>
      <div class="sync-status body-sm" id="sync-status"><i class="dot"></i><span>Loading…</span></div>
    </div>`;
  $('#tabbar').innerHTML = TABS.map((p) => NAV.find((n) => n.path === p)).map((n) => `<a href="#${n.path}" data-path="${n.path}">${n.icon}<span>${n.label}</span></a>`).join('') + `<button data-act="more">${I.menu}<span>More</span></button>`;
}

function renderNav(path) {
  $('#nav').innerHTML = NAV.map((n, i) => `<a class="k-nav__item ${n.path === path ? 'k-nav__item--active' : ''}" href="#${n.path}" ${n.path === path ? 'aria-current="page"' : ''} title="${n.label} (${mod}${i + 1})">${n.icon}<span>${n.label}</span></a>`).join('');
  $$('#tabbar a').forEach((a) => a.classList.toggle('is-active', a.dataset.path === path));
  $('#tabbar [data-act="more"]').classList.toggle('is-active', !TABS.includes(path));
}

async function renderAccounts({ fresh = false } = {}) {
  const box = $('#accounts');
  try {
    const { accounts } = await cached('/accounts?hidden=true&closed=true', { fresh });
    const collapsed = new Set(store.get('keel-collapsed', []));
    const groupOf = (a) => (ACCOUNT_GROUPS.some(([t]) => t === a.type) ? a.type : 'other');
    const activeAcct = currentAccountFilter();
    const groups = ACCOUNT_GROUPS.map(([type, label]) => {
      const rows = accounts.filter((a) => groupOf(a) === type).sort((a, b) => (a.hidden || a.closed) - (b.hidden || b.closed) || a.name.localeCompare(b.name));
      if (!rows.length) return '';
      const open = !collapsed.has(type);
      return `<div class="acct-group">
        <button class="acct-group__head" data-group="${type}" aria-expanded="${open}"><i class="k-caret ${open ? '' : 'is-closed'}"></i>${label}</button>
        <div class="acct-group__rows" ${open ? '' : 'hidden'}>${rows.map((a) => `<a class="k-acctnav ${a.hidden || a.closed ? 'k-acctnav--closed' : ''} ${a.id === activeAcct ? 'is-active' : ''}" href="#/transactions?accounts=${encodeURIComponent(a.id)}" title="${esc(a.name)}${a.mask ? ' ··' + esc(a.mask) : ''}${a.closed ? ' (closed)' : a.hidden ? ' (hidden)' : ''}">
          <i class="k-acctnav__dot" style="background:var(--cat-${hue(a.id)})"></i><span class="k-acctnav__name">${esc(a.name)}</span><span class="k-acctnav__bal">${moneyShort(a.balance)}</span></a>`).join('')}</div></div>`;
    }).join('');
    box.innerHTML = `<div class="k-eyebrow sidebar__eyebrow">My accounts</div>${groups || `<p class="body-sm sidebar__hint">Accounts appear after your first sync.</p>`}`;
  } catch {
    box.innerHTML = '<div class="k-eyebrow sidebar__eyebrow">My accounts</div>';
  }
}
function currentAccountFilter() {
  const [path, qs] = (location.hash.replace(/^#/, '') || '/').split('?');
  if (path !== '/transactions') return null;
  const a = new URLSearchParams(qs || '').get('accounts');
  return a && !a.includes(',') ? a : null;
}

async function renderStatus() {
  const el = $('#sync-status');
  try {
    if (!navigator.onLine) throw new Error('offline');
    status = await api('/status');
    const stale = !status.last_sync || Date.now() - Date.parse(status.last_sync) > 6 * 3600e3;
    el.innerHTML = `<i class="dot ${stale ? 'dot--warning' : 'dot--ok'}"></i><span>Synced ${ago(status.last_sync)}${status.queued_writes ? ` · ${status.queued_writes} queued` : ''}</span>`;
    el.classList.toggle('is-stale', stale);
    const steps = await onboarding();
    $('#start-dot').hidden = steps.every((s) => s.done);
  } catch {
    el.innerHTML = '<i class="dot dot--warning"></i><span>Offline</span>';
    el.classList.add('is-stale');
  }
}
function refreshChrome() { invalidate('/accounts?hidden=true&closed=true', '/categories', '/goals', '/tags'); renderAccounts({ fresh: true }); renderStatus(); }

// ---------- Start here (onboarding checklist) ----------
async function onboarding() {
  const s = status ?? (await api('/status'));
  const summary = await api('/summary').catch(() => ({ unreviewed: 0 }));
  const manual = store.get('keel-onboarding', {});
  return [
    { id: 'sync', label: 'Sync your Copilot data', hint: 'Pull accounts and transactions from the Copilot Mac app.', done: Boolean(s.last_sync), action: ['Open settings', openSettings] },
    { id: 'review', label: 'Review your transactions', hint: summary.unreviewed ? `${summary.unreviewed} waiting.` : 'All caught up.', done: !summary.unreviewed, action: ['Review', () => (location.hash = '#/transactions?statuses=unreviewed')] },
    { id: 'budget', label: 'Set a budget', hint: 'Give at least one category a monthly budget.', done: s.counts.budgets > 0, action: ['Categories', () => (location.hash = '#/categories')] },
    { id: 'mcp', label: 'Connect Claude over MCP', hint: 'Claude Desktop, Claude Code or claude.ai can read and edit your finances.', done: Boolean(manual.mcp), manual: true, action: ['Show me how', openSettings] },
    { id: 'phone', label: 'Add Keel to your phone', hint: 'Open Keel in Safari on your phone, then Share → Add to Home Screen.', done: Boolean(manual.phone), manual: true },
  ];
}
async function openStartHere() {
  const steps = await onboarding();
  const s = sheet(`<div class="form">
    <header class="form__head"><h2 class="h2">Start here</h2>${iconBtn(I.x, 'Close', 'data-act="close-sheet"')}</header>
    <p class="body-sm form__hint">${steps.filter((x) => x.done).length} of ${steps.length} done.</p>
    <ol class="checklist">${steps.map((x) => `<li class="checklist__item ${x.done ? 'is-done' : ''}">
      <span class="k-check ${x.done ? '' : 'k-check--todo'}">${x.done ? I.check : ''}</span>
      <div class="checklist__text"><div class="body">${esc(x.label)}</div><div class="body-sm">${esc(x.hint)}</div></div>
      <div class="checklist__acts">${x.action ? `<button class="k-btn" data-step="${x.id}">${esc(x.action[0])}</button>` : ''}${x.manual ? `<button class="k-btn" data-mark="${x.id}">${x.done ? 'Undo' : 'Mark done'}</button>` : ''}</div></li>`).join('')}</ol></div>`, { label: 'Start here' });
  s.el.addEventListener('click', (e) => {
    const step = e.target.closest('[data-step]');
    if (step) { s.close(); steps.find((x) => x.id === step.dataset.step).action[1](); }
    const mark = e.target.closest('[data-mark]');
    if (mark) { const m = store.get('keel-onboarding', {}); m[mark.dataset.mark] = !m[mark.dataset.mark]; store.set('keel-onboarding', m); s.close(); renderStatus(); openStartHere(); }
  });
}

async function openSettings() {
  try { const el = await v1['/settings'](); sheet(el, { width: '560px', label: 'Settings' }); }
  catch (e) { toast(`Couldn’t open settings: ${e.message}`); }
}

function openMore() {
  const rest = NAV.filter((n) => !TABS.includes(n.path));
  const s = sheet(`<div class="form more">
    <header class="form__head"><h2 class="h2">More</h2>${iconBtn(I.x, 'Close', 'data-act="close-sheet"')}</header>
    <button class="k-search sidebar__search" data-act="palette">${I.search}<span class="k-input">Search</span></button>
    <nav class="k-nav more__nav">${rest.map((n) => `<a class="k-nav__item" href="#${n.path}">${n.icon}<span>${n.label}</span></a>`).join('')}
      <hr class="menu__sep">
      <button class="k-nav__item" data-act="start">${I.rocket}<span>Start here</span></button>
      <a class="k-nav__item" href="${HELP_URL}" target="_blank" rel="noopener">${I.help}<span>Get help</span></a>
      <button class="k-nav__item" data-act="settings">${I.settings}<span>Settings</span></button></nav>
    <div class="sync-status body-sm">${$('#sync-status').innerHTML}</div></div>`, { label: 'More' });
  s.el.addEventListener('click', (e) => { if (e.target.closest('a, [data-act]') && !e.target.closest('[data-act="close-sheet"]')) s.close(); });
}

// ---------- ⌘K palette ----------
let palette = null;
async function openPalette() {
  if (palette) return;
  closePopover(); closeTopSheet();
  const el = h(`<div class="palette-scrim"><div class="palette" role="dialog" aria-label="Search">
    <div class="k-search palette__input">${I.search}<input class="k-input" placeholder="Search transactions, accounts, categories, recurrings" aria-label="Search" autocomplete="off"></div>
    <div class="palette__results" role="listbox"></div></div></div>`);
  document.body.append(el);
  const input = $('input', el), out = $('.palette__results', el);
  palette = { close: () => { el.remove(); palette = null; } };
  el.addEventListener('click', (e) => { if (e.target === el) palette.close(); });
  input.focus();
  const [cats, accts, recs] = await Promise.all([cached('/categories').catch(() => []), cached('/accounts?hidden=true&closed=true').then((r) => r.accounts).catch(() => []), cached('/recurring').catch(() => [])]);
  let results = [], sel = 0, token = 0, deb;
  const go = (r) => { palette?.close(); r.run(); };
  const draw = () => {
    let html = '', lastGroup = null;
    results.forEach((r, i) => {
      if (r.group !== lastGroup) { html += `<div class="palette__group k-eyebrow">${r.group}</div>`; lastGroup = r.group; }
      html += `<button class="palette__item ${i === sel ? 'is-sel' : ''}" data-i="${i}" role="option" aria-selected="${i === sel}">${r.html}</button>`;
    });
    out.innerHTML = html || `<div class="palette__none body-sm">${input.value ? 'No matches.' : ''}</div>`;
    out.querySelector('.is-sel')?.scrollIntoView({ block: 'nearest' });
  };
  const search = async () => {
    const q = input.value.trim().toLowerCase(), my = ++token;
    const m = (s) => String(s ?? '').toLowerCase().includes(q);
    const pages = NAV.filter((n) => m(n.label)).map((n) => ({ group: 'Go to', html: `${n.icon}<span>${n.label}</span>`, run: () => (location.hash = '#' + n.path) }));
    if (!q) { results = pages; sel = 0; return draw(); }
    const local = [
      ...pages,
      ...accts.filter((a) => m(a.name) || m(a.institution) || m(a.mask)).slice(0, 5).map((a) => ({ group: 'Accounts', html: `<i class="k-acctnav__dot" style="background:var(--cat-${hue(a.id)})"></i><span>${esc(a.name)}</span><span class="palette__trail amount-sm">${moneyShort(a.balance)}</span>`, run: () => (location.hash = '#/transactions?accounts=' + encodeURIComponent(a.id)) })),
      ...cats.filter((c) => m(c.name)).slice(0, 6).map((c) => ({ group: 'Categories', html: catTag(c.name, c.emoji, hue(c.parent_id || c.id)), run: () => (location.hash = '#/transactions?categories=' + encodeURIComponent(c.id)) })),
      ...recs.filter((r) => m(r.name)).slice(0, 5).map((r) => ({ group: 'Recurrings', html: `${I.repeat}<span>${esc(r.name)}</span><span class="palette__trail amount-sm">${r.amount != null ? txAmount(r.amount) : ''}</span>`, run: () => (location.hash = '#/recurrings') })),
    ];
    results = local; sel = 0; draw();
    clearTimeout(deb);
    deb = setTimeout(async () => {
      const r = await api('/transactions?' + new URLSearchParams({ q, limit: '8', transfers: 'true', excluded: 'true' })).catch(() => null);
      if (my !== token || !palette || !r) return;
      results = [...local, ...r.transactions.map((t) => ({ group: 'Transactions', html: `<span class="palette__date body-sm">${esc(t.date.slice(5).replace('-', '/'))}</span><span>${esc(t.name)}</span><span class="palette__trail amount-sm">${txAmount(t.amount)}</span>`, run: () => (location.hash = '#/transactions?id=' + encodeURIComponent(t.id)) }))];
      draw();
    }, 150);
  };
  input.addEventListener('input', search);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, Math.min(results.length - 1, sel + (e.key === 'ArrowDown' ? 1 : -1))); draw(); }
    if (e.key === 'Enter' && results[sel]) { e.preventDefault(); go(results[sel]); }
  });
  out.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) go(results[+b.dataset.i]); });
  search();
}

// ---------- panes ----------
const shellApi = {
  setDetailOpen(open) { content.classList.toggle('has-detail', open); },
  detailOpen() { return content.classList.contains('has-detail') && !matchMedia('(min-width: 1100px)').matches; },
};

// ---------- router ----------
async function navigate() {
  const token = ++navToken;
  const hash = location.hash.replace(/^#/, '') || '/';
  let [path, qs] = hash.split('?');
  path = ALIASES[path] ?? path;
  if (path === '/settings') { history.replaceState(null, '', '#/'); path = '/'; openSettings(); }
  if (!NAV.some((n) => n.path === path)) path = '/';
  const params = new URLSearchParams(qs || '');
  const nav = NAV.find((n) => n.path === path);
  renderNav(path);
  $$('#accounts .k-acctnav').forEach((a) => a.classList.toggle('is-active', a.getAttribute('href') === `#/transactions?accounts=${encodeURIComponent(currentAccountFilter() ?? '')}`));
  current?.destroy?.();
  current = null;
  closePopover();
  document.title = `${nav.label} · Keel`;
  try {
    if (path === '/transactions') {
      content.className = 'content content--split';
      const scr = await transactionsScreen(params, shellApi);
      if (token !== navToken) return scr.destroy();
      content.replaceChildren(scr.main, scr.detail);
      current = scr;
      return;
    }
    content.className = 'content';
    const pane = h(`<section class="pane" aria-label="${esc(nav.label)}">${titleBar(`<span class="pane-title">${esc(nav.label)}</span>`)}<div class="pane-body"><div class="skel-grid"><i class="skel skel--card"></i><i class="skel skel--card"></i><i class="skel skel--card"></i></div></div></section>`);
    content.replaceChildren(pane);
    const out = await v1[path](params);
    if (token !== navToken) return;
    $('.pane-body', pane).replaceChildren(typeof out === 'string' ? h(`<div>${out}</div>`) : out);
  } catch (e) {
    if (token !== navToken) return;
    content.className = 'content';
    content.replaceChildren(h(`<section class="pane">${titleBar(`<span class="pane-title">${esc(nav.label)}</span>`)}<div class="pane-error body-sm">Couldn’t load this screen. <span class="amount-sm">${esc(e.message)}</span></div></section>`));
  }
}

// ---------- events ----------
document.addEventListener('click', (e) => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'palette') { closeTopSheet(); return openPalette(); }
  if (act === 'settings') return openSettings();
  if (act === 'start') return openStartHere();
  if (act === 'more') return openMore();
  const win = e.target.closest('[data-win]')?.dataset.win;
  if (win === 'back') return history.back();
  if (win === 'forward') return history.forward();
  if (win === 'refresh') { refreshChrome(); return navigate(); }
  const group = e.target.closest('[data-group]');
  if (group) {
    const set = new Set(store.get('keel-collapsed', []));
    set.has(group.dataset.group) ? set.delete(group.dataset.group) : set.add(group.dataset.group);
    store.set('keel-collapsed', [...set]);
    return renderAccounts();
  }
  // v1 rows (dashboard) open the transaction on the Transactions screen
  const tx = e.target.closest('[data-tx]');
  if (tx) { e.preventDefault(); location.hash = '#/transactions?id=' + encodeURIComponent(tx.dataset.tx); }
});

document.addEventListener('keydown', (e) => {
  const mod_ = e.metaKey || e.ctrlKey;
  if (mod_ && e.key.toLowerCase() === 'k') { e.preventDefault(); return palette ? palette.close() : openPalette(); }
  if (e.key === 'Escape') {
    if (closePopover()) return;
    if (palette) return palette.close();
    if (closeTopSheet()) return;
  }
  if (palette || document.querySelector('.sheet-scrim')) return;
  if (mod_ && !e.shiftKey && !e.altKey && /^[1-9]$/.test(e.key)) { e.preventDefault(); location.hash = '#' + NAV[+e.key - 1].path; return; }
  if (isTyping(e.target) || document.querySelector('.popover')) return;
  current?.onKey?.(e);
});

addEventListener('hashchange', navigate);
addEventListener('online', renderStatus);
addEventListener('offline', renderStatus);
bindShell({ navigate, refreshChrome });
renderStatic();
renderAccounts();
renderStatus();
setInterval(renderStatus, 60_000);
navigate();
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('/sw.js').catch(() => {});
