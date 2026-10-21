// Shared helpers for the Daybook PWA: DOM, formatting, API, icons, popovers, sheets, toasts.

// ---------- DOM ----------
export const $ = (sel, el = document) => el.querySelector(sel);
export const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
export const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const isTyping = (el) => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
export const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
export const store = {
  get(k, fallback) { try { const v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

// ---------- formatting ----------
export const money = (n, { sign = false, cents = true } = {}) => {
  if (n == null || Number.isNaN(n)) return '—';
  const abs = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
  const neg = n < 0;
  return (neg ? '−' : sign && n > 0 ? '+' : '') + '$' + abs;
};
/** Sidebar balances: `$5,278`, `$47.9k` from 10k, `$1.2M` from 1M. */
export const moneyShort = (n) => {
  const a = Math.abs(n ?? 0), s = n < 0 ? '−' : '';
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  if (a >= 1e4) return `${s}$${(a / 1e3).toFixed(1).replace(/\.0$/, '')}k`;
  return `${s}$${Math.round(a).toLocaleString('en-US')}`;
};
/** Copilot convention: positive = money out (shown plain), negative = money in (shown `+$`, positive colour). */
export const txAmount = (amount) => (amount < 0 ? '+' : '') + money(Math.abs(amount));
export const pct = (n) => `${Math.round(n)}%`;
export const today = () => isoDay(new Date());
export const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return isoDay(d); };
export const thisMonth = () => today().slice(0, 7);
export const monthLabel = (m) => new Date(m + '-02T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
export const monthShort = (m) => new Date(m + '-02T12:00:00').toLocaleDateString('en-US', { month: 'short' });
export const shiftMonth = (m, n) => { const [y, mm] = m.split('-').map(Number); return new Date(Date.UTC(y, mm - 1 + n, 1)).toISOString().slice(0, 7); };
export const dateLabel = (d) => {
  if (d === today()) return 'Today';
  if (d === addDays(today(), -1)) return 'Yesterday';
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
};
/** Day-group eyebrow: TODAY · YESTERDAY · SUN, OCTOBER 18 (year added outside the current one). */
export const dayHead = (d) => {
  if (d === today()) return 'Today';
  if (d === addDays(today(), -1)) return 'Yesterday';
  const dt = new Date(d + 'T12:00:00');
  return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric', ...(d.slice(0, 4) !== today().slice(0, 4) && { year: 'numeric' }) });
};
export const longDate = (d) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
export const shortDate = (d) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(d.slice(0, 4) !== today().slice(0, 4) && { year: 'numeric' }) });
export const ago = (iso) => { if (!iso) return 'never'; const s = (Date.now() - Date.parse(iso)) / 1000; if (s < 90) return 'just now'; if (s < 5400) return `${Math.round(s / 60)} min ago`; if (s < 172800) return `${Math.round(s / 3600)} h ago`; return `${Math.round(s / 86400)} d ago`; };
export const parseTags = (v) => { if (Array.isArray(v)) return v.map(String); if (!v) return []; try { const j = JSON.parse(v); return Array.isArray(j) ? j.map(String) : []; } catch { return String(v).split(',').map((s) => s.trim()).filter(Boolean); } };

/** Stable hue 1–12 for a key; categories hash their parent so children inherit the parent's hue. */
export const hue = (key) => { let x = 0; for (const c of String(key ?? '')) x = (x * 31 + c.charCodeAt(0)) >>> 0; return (x % 12) + 1; };
export const catHue = (t) => hue(t.category_parent_id || t.parent_id || t.category_id || t.id);
export const catTag = (name, emoji, n) => `<span class="k-tag k-tag--${n}">${emoji ? `<span class="k-tag__emoji">${esc(emoji)}</span>` : ''}${esc(name)}</span>`;

// ---------- API ----------
export async function api(path, opts = {}) {
  const res = await fetch('/api' + path, { headers: { 'content-type': 'application/json', ...(opts.headers || {}) }, ...opts, body: opts.body && typeof opts.body !== 'string' && !(opts.body instanceof FormData) ? JSON.stringify(opts.body) : opts.body });
  if (!res.ok) { let msg = res.statusText; try { msg = (await res.json()).error || msg; } catch {} throw new Error(msg); }
  return res.json();
}
/** Write-through result → the toast the spec asks for. */
export const savedMsg = (r) => (r?.copilot?.pushed ? 'Saved and pushed to Copilot' : r?.copilot?.error ? 'Saved locally; Copilot push failed' : r?.copilot?.local ? 'Saved locally' : 'Saved locally, queued');

// Small shared caches for lists every screen needs (sidebar, pickers, palette).
const cache = new Map();
export function cached(path, { fresh = false } = {}) {
  if (fresh || !cache.has(path)) cache.set(path, api(path).catch((e) => { cache.delete(path); throw e; }));
  return cache.get(path);
}
export const invalidate = (...paths) => paths.forEach((p) => cache.delete(p));

// ---------- toast ----------
let toastTimer;
export function toast(msg) {
  let t = $('.toast');
  if (!t) { t = h('<div class="toast" role="status"></div>'); document.body.append(t); }
  t.textContent = msg; clearTimeout(toastTimer); toastTimer = setTimeout(() => t.remove(), 2600);
}

// ---------- icons (Lucide, ISC) ----------
const svg = (p) => `<svg viewBox="0 0 24 24" aria-hidden="true">${p}</svg>`;
export const I = {
  dashboard: svg('<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>'),
  list: svg('<path d="M3 12h.01M3 18h.01M3 6h.01M8 12h13M8 18h13M8 6h13"/>'),
  flag: svg('<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/>'),
  cashflow: svg('<path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/>'),
  landmark: svg('<path d="M3 22h18M6 18v-7M10 18v-7M14 18v-7M18 18v-7"/><path d="m12 2 8 5H4z"/>'),
  trending: svg('<path d="m22 7-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>'),
  tags: svg('<path d="m15 5 6.3 6.3a2.4 2.4 0 0 1 0 3.4L17 19"/><path d="M9.59 5.59A2 2 0 0 0 8.17 5H3a1 1 0 0 0-1 1v5.17a2 2 0 0 0 .59 1.42l5.7 5.7a2.43 2.43 0 0 0 3.42 0l3.58-3.58a2.43 2.43 0 0 0 0-3.42z"/><circle cx="6.5" cy="9.5" r=".5"/>'),
  repeat: svg('<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>'),
  chat: svg('<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>'),
  settings: svg('<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>'),
  rocket: svg('<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>'),
  help: svg('<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>'),
  search: svg('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>'),
  back: svg('<path d="m15 18-6-6 6-6"/>'),
  forward: svg('<path d="m9 18 6-6-6-6"/>'),
  down: svg('<path d="m6 9 6 6 6-6"/>'),
  refresh: svg('<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>'),
  filter: svg('<path d="M3 6h18M7 12h10M10 18h4"/>'),
  sort: svg('<path d="m21 16-4 4-4-4"/><path d="M17 20V4"/><path d="m3 8 4-4 4 4"/><path d="M7 4v16"/>'),
  plus: svg('<path d="M5 12h14M12 5v14"/>'),
  download: svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>'),
  x: svg('<path d="M18 6 6 18M6 6l12 12"/>'),
  calendar: svg('<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>'),
  check: svg('<path d="M20 6 9 17l-5-5"/>'),
  more: svg('<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>'),
  split: svg('<path d="M16 3h5v5M8 3H3v5"/><path d="M12 22v-8.3a4 4 0 0 0-1.17-2.87L3 3"/><path d="m15 9 6-6"/>'),
  hash: svg('<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/>'),
  layers: svg('<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>'),
  menu: svg('<path d="M4 12h16M4 6h16M4 18h16"/>'),
  arrowLeft: svg('<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>'),
  transfer: svg('<path d="m16 3 4 4-4 4"/><path d="M20 7H4"/><path d="m8 21-4-4 4-4"/><path d="M4 17h16"/>'),
};

// ---------- title bar ----------
/** TitleBar markup: `title` is HTML (may be a dropdown button), `actions` is HTML. */
export const titleBar = (title, actions = '', { back = false } = {}) => `<header class="k-titlebar pane-bar">
  <div class="k-titlebar__title">${back ? `<button class="k-btn k-btn--icon pane-back" data-act="back" aria-label="Back">${I.arrowLeft}</button>` : ''}${title}</div>
  <div class="k-titlebar__actions">${actions}</div></header>`;
export const iconBtn = (icon, label, attrs = '') => `<button class="k-btn k-btn--icon" aria-label="${esc(label)}" title="${esc(label)}" ${attrs}>${icon}</button>`;
export const emptyState = (text, icon = I.list) => `<div class="k-empty"><span class="k-empty__disc">${icon}</span><span>${esc(text)}</span></div>`;

// ---------- popover ----------
let openPop = null;
/** Anchored popover (radius-md, shadow-pop). One at a time; closes on outside click or Esc. Returns the panel. */
export function popover(anchor, content, { align = 'start', width, onClose } = {}) {
  closePopover();
  const panel = h('<div class="popover" role="dialog"></div>');
  if (width) panel.style.width = width;
  typeof content === 'string' ? (panel.innerHTML = content) : panel.append(content);
  document.body.append(panel);
  const place = () => {
    const r = anchor.getBoundingClientRect(), pw = panel.offsetWidth, ph = panel.offsetHeight, vw = innerWidth, vh = innerHeight, gap = 4;
    let left = align === 'end' ? r.right - pw : r.left;
    left = Math.max(8, Math.min(left, vw - pw - 8));
    let top = r.bottom + gap;
    if (top + ph > vh - 8) top = Math.max(8, r.top - ph - gap > 8 ? r.top - ph - gap : vh - ph - 8);
    panel.style.left = left + 'px'; panel.style.top = top + 'px';
  };
  place();
  const outside = (e) => { if (!panel.contains(e.target) && !anchor.contains(e.target)) closePopover(); };
  setTimeout(() => document.addEventListener('pointerdown', outside, true));
  addEventListener('resize', place);
  openPop = { panel, anchor, close: () => { document.removeEventListener('pointerdown', outside, true); removeEventListener('resize', place); panel.remove(); onClose?.(); }, place };
  anchor.setAttribute('aria-expanded', 'true');
  return panel;
}
export function closePopover() {
  if (!openPop) return false;
  const p = openPop; openPop = null;
  p.anchor.removeAttribute('aria-expanded');
  p.close();
  return true;
}
export const repositionPopover = () => openPop?.place();
/** Menu popover: items [{label, icon?, danger?, checked?, disabled?, run}] or '-' separators. */
export function menu(anchor, items, opts) {
  const el = h('<div class="menu" role="menu"></div>');
  for (const it of items) {
    if (it === '-') { el.append(h('<hr class="menu__sep">')); continue; }
    if (it.heading) { el.append(h(`<div class="menu__head k-eyebrow">${esc(it.heading)}</div>`)); continue; }
    const b = h(`<button class="menu__item ${it.danger ? 'menu__item--danger' : ''}" role="menuitem" ${it.disabled ? 'disabled' : ''}><span class="menu__check">${it.checked ? I.check : ''}</span>${it.icon || ''}<span class="menu__label">${esc(it.label)}</span>${it.trail ? `<span class="menu__trail">${it.trail}</span>` : ''}</button>`);
    b.addEventListener('click', () => { closePopover(); it.run?.(); });
    el.append(b);
  }
  return popover(anchor, el, opts);
}

// ---------- sheet ----------
let sheets = [];
/** Right-side sheet (Settings, add transaction, split). Returns { el, close }. */
export function sheet(content, { width = '420px', label = 'Sheet', onClose } = {}) {
  const scrim = h(`<div class="sheet-scrim"><aside class="sheet-panel" role="dialog" aria-label="${esc(label)}" style="--sheet-w:${width}"></aside></div>`);
  const panel = scrim.firstElementChild;
  typeof content === 'string' ? (panel.innerHTML = content) : panel.append(content);
  const close = () => { scrim.remove(); sheets = sheets.filter((s) => s !== api_); onClose?.(); };
  const api_ = { el: panel, close };
  scrim.addEventListener('click', (e) => { if (e.target === scrim) close(); });
  panel.addEventListener('click', (e) => { if (e.target.closest('[data-act="close-sheet"]')) close(); });
  document.body.append(scrim);
  sheets.push(api_);
  return api_;
}
export function closeTopSheet() { const s = sheets.at(-1); if (!s) return false; s.close(); return true; }
