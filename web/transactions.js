// Transactions — docs/screens/transactions.md. Main list (windowed, day-grouped, multi-select + bulk bar)
// and a detail pane. All filter state round-trips through the URL hash so a view can be bookmarked.
import {
  $, $$, h, esc, money, txAmount, today, addDays, thisMonth, shiftMonth, dayHead, longDate, shortDate, monthLabel, parseTags,
  hue, catHue, catTag, api, cached, savedMsg, toast, store, I, titleBar, iconBtn, emptyState, popover, closePopover, menu, sheet, repositionPopover,
} from './lib.js';

const PAGE = 100;
const VIEWS_KEY = 'keel-tx-views';
const TYPES = [['regular', 'Regular'], ['income', 'Income'], ['transfer', 'Internal transfer']];
const STATUSES = [['pending', 'Pending'], ['unreviewed', 'Unreviewed'], ['excluded', 'Excluded']];
const SORTS = { date: ['Date', 'Newest first', 'Oldest first'], amount: ['Amount', 'Largest first', 'Smallest first'], name: ['Name', 'Z → A', 'A → Z'] };
const typeOf = (t) => (t.transfer ? 'transfer' : t.income ? 'income' : 'regular');
const typeLabel = { regular: 'Regular transaction', income: 'Income', transfer: 'Internal transfer' };
/** Counts toward the day's spend total (amount-sm, faint) in the day header. */
const isSpend = (t) => !t.excluded && !t.transfer && !t.split && t.amount > 0;

// ---------- filter state <-> URL ----------
const LIST_KEYS = ['accounts', 'categories', 'tags', 'types', 'statuses'];
function readParams(p) {
  const list = (k) => (p.get(k) ? p.get(k).split(',').filter(Boolean) : []);
  const f = { q: p.get('q') || '', from: p.get('from') || '', to: p.get('to') || '', min: p.get('min') || '', max: p.get('max') || '', sort: p.get('sort') || 'date', dir: p.get('dir') || '' };
  for (const k of LIST_KEYS) f[k] = list(k);
  // links from v1 screens and older bookmarks
  if (p.get('account_id')) f.accounts.push(p.get('account_id'));
  if (p.get('category_id')) f.categories.push(p.get('category_id'));
  if (p.get('unreviewed') === '1' || p.get('unreviewed') === 'true') f.statuses.push('unreviewed');
  if (p.get('pending') === '1' || p.get('pending') === 'true') f.statuses.push('pending');
  if (p.get('month')) { f.from = p.get('month') + '-01'; f.to = addDays(shiftMonth(p.get('month'), 1) + '-01', -1); }
  if (!SORTS[f.sort]) f.sort = 'date';
  return f;
}
const defaultDir = (sort) => (sort === 'name' ? 'asc' : 'desc');
function filterQuery(f, { forUrl = false } = {}) {
  const qs = new URLSearchParams();
  if (f.q) qs.set('q', f.q);
  for (const k of LIST_KEYS) if (f[k].length) qs.set(k, f[k].join(','));
  if (f.from) qs.set(forUrl ? 'from' : 'start', f.from);
  if (f.to) qs.set(forUrl ? 'to' : 'end', f.to);
  if (f.min) qs.set('min', f.min);
  if (f.max) qs.set('max', f.max);
  if (f.sort !== 'date') qs.set('sort', f.sort);
  if (f.dir && f.dir !== defaultDir(f.sort)) qs.set('dir', f.dir);
  if (!forUrl) { qs.set('transfers', 'true'); qs.set('excluded', 'true'); if (f.sort === 'name' && !f.dir) qs.set('dir', 'asc'); }
  return qs;
}
const hasFilters = (f) => Boolean(f.q || f.from || f.to || f.min || f.max || LIST_KEYS.some((k) => f[k].length));

const DATE_PRESETS = [
  ['This month', () => [thisMonth() + '-01', '']],
  ['Last month', () => { const m = shiftMonth(thisMonth(), -1); return [m + '-01', addDays(thisMonth() + '-01', -1)]; }],
  ['30D', () => [addDays(today(), -29), '']],
  ['90D', () => [addDays(today(), -89), '']],
  ['YTD', () => [today().slice(0, 4) + '-01-01', '']],
  ['All', () => ['', '']],
];

export async function transactionsScreen(params, shell) {
  const f = readParams(params);
  const [cats, acctRes, goals] = await Promise.all([cached('/categories'), cached('/accounts?hidden=true&closed=true'), cached('/goals').catch(() => [])]);
  const accts = acctRes.accounts;
  const catById = new Map(cats.map((c) => [c.id, c]));
  const acctById = new Map(accts.map((a) => [a.id, a]));
  const catPatch = (id) => { const c = catById.get(id); return { category_id: id || null, category_name: c?.name ?? null, category_emoji: c?.emoji ?? null, category_parent_id: c?.parent_id ?? null }; };

  const st = { rows: [], total: 0, hasMore: false, loading: false, token: 0, active: params.get('id') || null, detail: null, checked: new Set(), lastCheck: -1 };
  let items = [], offsets = [], totalH = 0, ROW_H = 40, HEAD_H = 30, measured = false, range = [-1, -1];

  // ---------- markup ----------
  const main = h(`<section class="pane pane--surface pane--main" aria-label="Transactions">
    <div class="pane-bar-slot"></div>
    <div class="chips" hidden></div>
    <div class="tx-list" role="listbox" aria-label="Transactions" aria-multiselectable="true" tabindex="0"></div>
    <div class="tx-foot body-sm"></div>
    <div class="bulkbar" hidden></div>
  </section>`);
  const detail = h('<section class="pane pane--surface pane--detail" aria-label="Transaction detail"></section>');
  const list = $('.tx-list', main), foot = $('.tx-foot', main), chips = $('.chips', main), bulkbar = $('.bulkbar', main);

  function renderBar() {
    const view = currentView();
    const single = !view && f.accounts.length === 1 && !hasFilters({ ...f, accounts: [] }) ? acctById.get(f.accounts[0])?.name : null;
    const title = view?.name || single || 'All transactions';
    const searching = Boolean(f.q) || main.classList.contains('is-searching');
    $('.pane-bar-slot', main).outerHTML = titleBar(
      `<button class="title-btn" data-act="views" aria-haspopup="menu">${esc(title)}${I.down}</button>`,
      `${searching ? `<input class="k-input bar-search" type="search" placeholder="Search" aria-label="Search transactions" value="${esc(f.q)}">` : ''}
       <button class="k-btn ${hasFilters({ ...f, q: '' }) ? 'is-on' : ''}" data-act="filter" aria-haspopup="dialog">${I.filter}<span class="hide-sm">Filter</span></button>
       <button class="k-btn ${f.sort !== 'date' || (f.dir && f.dir !== 'desc') ? 'is-on' : ''}" data-act="sort" aria-haspopup="menu">${I.sort}<span class="hide-sm">Sort</span></button>
       ${iconBtn(I.search, 'Search', 'data-act="search"')}${iconBtn(I.plus, 'Add transaction', 'data-act="add"')}${iconBtn(I.download, 'Download CSV', 'data-act="export"')}`,
    ).replace('<header class="k-titlebar pane-bar">', '<header class="k-titlebar pane-bar pane-bar-slot">');
    const input = $('.bar-search', main);
    if (input) {
      let deb;
      input.addEventListener('input', () => { clearTimeout(deb); deb = setTimeout(() => { f.q = input.value.trim(); applyFilters({ bar: false }); }, 200); });
      input.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !input.value) { e.stopPropagation(); main.classList.remove('is-searching'); renderBar(); list.focus(); } });
    }
  }

  function renderChips() {
    const parts = [];
    const chip = (label, value, key) => parts.push(`<span class="k-rule"><b>${esc(label)}</b>${esc(value)}<button class="k-rule__x" data-clear="${esc(key)}" aria-label="Remove ${esc(label)} filter">${I.x}</button></span>`);
    if (f.from || f.to) chip('Date', f.from && f.to ? `${shortDate(f.from)} – ${shortDate(f.to)}` : f.from ? `since ${shortDate(f.from)}` : `until ${shortDate(f.to)}`, 'date');
    f.accounts.forEach((id) => chip('Account', acctById.get(id)?.name ?? id, 'accounts:' + id));
    f.categories.forEach((id) => chip('Category', catById.get(id)?.name ?? id, 'categories:' + id));
    f.tags.forEach((t) => chip('Tag', '#' + t, 'tags:' + t));
    if (f.min || f.max) chip('Amount', f.min && f.max ? `${money(+f.min, { cents: false })} – ${money(+f.max, { cents: false })}` : f.min ? `≥ ${money(+f.min, { cents: false })}` : `≤ ${money(+f.max, { cents: false })}`, 'amount');
    f.types.forEach((t) => chip('Type', TYPES.find((x) => x[0] === t)?.[1] ?? t, 'types:' + t));
    f.statuses.forEach((s) => chip('Status', STATUSES.find((x) => x[0] === s)?.[1] ?? s, 'statuses:' + s));
    if (f.q) chip('Search', `“${f.q}”`, 'q');
    chips.hidden = !parts.length;
    chips.innerHTML = parts.join('') + (parts.length > 1 ? '<button class="chips__clear" data-clear="all">Clear all</button>' : '');
  }

  function writeHash() {
    const qs = filterQuery(f, { forUrl: true });
    if (st.active) qs.set('id', st.active);
    const s = qs.toString();
    history.replaceState(null, '', '#/transactions' + (s ? '?' + s : ''));
  }

  function applyFilters({ bar = true } = {}) {
    if (bar) renderBar();
    renderChips();
    writeHash();
    load();
  }

  // ---------- data ----------
  async function load({ append = false } = {}) {
    const token = ++st.token;
    st.loading = true;
    if (!append) { st.rows = []; st.checked.clear(); st.lastCheck = -1; renderBulk(); list.innerHTML = skeleton(); foot.textContent = ''; }
    const qs = filterQuery(f);
    qs.set('limit', String(PAGE)); qs.set('offset', String(append ? st.rows.length : 0));
    try {
      const r = await api('/transactions?' + qs);
      if (token !== st.token) return;
      st.rows = append ? st.rows.concat(r.transactions) : r.transactions;
      st.total = r.total; st.hasMore = r.has_more;
    } catch (e) {
      if (token !== st.token) return;
      list.innerHTML = `<div class="pane-error body-sm">Couldn’t load transactions. ${esc(e.message)}</div>`;
      return;
    } finally { if (token === st.token) st.loading = false; }
    if (!append) main.scrollTop = 0;
    rebuild();
  }

  function rebuild() {
    if (!measured && list.isConnected) measure();
    items = []; offsets = []; totalH = 0;
    const grouped = f.sort === 'date';
    let day = null, head = null;
    for (const t of st.rows) {
      if (grouped && t.date !== day) { day = t.date; head = { kind: 'head', date: day, total: 0 }; items.push(head); offsets.push(totalH); totalH += HEAD_H; }
      items.push({ kind: 'row', t }); offsets.push(totalH); totalH += ROW_H;
      if (head && isSpend(t)) head.total += t.amount;
    }
    if (!st.rows.length) {
      list.style.height = '';
      list.innerHTML = emptyState(hasFilters(f) ? 'No transactions match.' : 'Transactions will appear here after your first sync.');
    } else {
      list.style.height = totalH + 'px';
      list.innerHTML = '';
    }
    range = [-1, -1];
    paint(true);
    foot.textContent = st.rows.length ? `${st.total.toLocaleString('en-US')} transaction${st.total === 1 ? '' : 's'}${st.hasMore ? ` · showing ${st.rows.length.toLocaleString('en-US')}` : ''}` : '';
  }

  /** Windowed render: only the items intersecting the viewport (+ overscan) are in the DOM. */
  function paint(force = false) {
    if (!items.length) return;
    const top = main.scrollTop - list.offsetTop, view = main.clientHeight, over = 400;
    let lo = 0, hi = items.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (offsets[mid] + ROW_H < top - over) lo = mid + 1; else hi = mid; }
    let end = lo;
    while (end < items.length && offsets[end] < top + view + over) end++;
    if (!force && lo === range[0] && end === range[1]) return;
    range = [lo, end];
    let html = '';
    for (let i = lo; i < end; i++) html += itemHtml(items[i], offsets[i]);
    list.innerHTML = html;
    if (st.hasMore && !st.loading && end >= items.length - 25) load({ append: true });
  }
  let raf = 0;
  main.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; paint(); }); }, { passive: true });
  const ro = new ResizeObserver(() => paint(true));
  ro.observe(main);

  function itemHtml(it, y) {
    if (it.kind === 'head') return `<div class="k-dayhead tx-item" style="top:${y}px" role="presentation"><span class="k-eyebrow">${esc(dayHead(it.date))}</span><span class="k-dayhead__total">${it.total ? money(it.total) : ''}</span></div>`;
    return rowHtml(it.t, y);
  }
  function rowHtml(t, y) {
    const on = st.checked.has(t.id), active = t.id === st.active;
    const cls = ['k-row', 'k-txrow', 'tx-row', 'tx-item'];
    if (active) cls.push('k-row--selected');
    if (on) cls.push('is-checked');
    if (t.excluded) cls.push('is-excluded');
    if (t.split_parent_id) cls.push('is-child');
    const glyph = t.transfer ? `<span class="tx-glyph" title="Internal transfer">${I.transfer}</span>` : t.split ? `<span class="tx-glyph" title="Split">${I.layers}</span>` : '';
    const acct = t.account_name ? `${t.account_name}${t.account_mask ? ' ' + t.account_mask : ''}` : '';
    return `<div class="${cls.join(' ')}" style="top:${y}px" role="option" aria-selected="${active}" data-id="${esc(t.id)}">
      <span class="k-row__check tx-check" role="checkbox" aria-checked="${on}" aria-label="Select ${esc(t.name)}" data-check>${on ? I.check : ''}</span>
      <span class="k-row__review ${t.reviewed ? 'k-row__review--done' : ''}" data-review title="${t.reviewed ? 'Reviewed' : 'Needs review'} (R)"></span>
      <span class="tx-row__text">${glyph}<span class="k-row__name">${esc(t.name)}</span><span class="k-row__sub">${esc(acct)}</span></span>
      <span class="tx-row__tag">${tagFor(t)}</span>
      <span class="k-row__amt ${t.amount < 0 && !t.transfer ? 'k-row__amt--income' : ''} ${t.pending ? 'k-row__amt--pending' : ''}">${txAmount(t.amount)}</span>
    </div>`;
  }
  const tagFor = (t) => (t.transfer ? '' : t.category_id && t.category_name ? catTag(t.category_name, t.category_emoji, catHue(t)) : '<span class="k-tag tag--none">Uncategorized</span>');
  const skeleton = () => `<div class="skel-list">${Array.from({ length: 12 }, (_, i) => `<div class="skel-row"><i class="skel" style="width:${30 + ((i * 37) % 40)}%"></i><i class="skel skel--tag"></i><i class="skel skel--amt"></i></div>`).join('')}</div>`;

  function measure() {
    list.innerHTML = itemHtml({ kind: 'head', date: today(), total: 1 }, 0) + rowHtml({ id: '_', name: 'x', amount: 1, date: today() }, 0);
    const [hd, rw] = list.children;
    HEAD_H = hd.offsetHeight || HEAD_H; ROW_H = rw.offsetHeight || ROW_H;
    measured = Boolean(hd.offsetHeight);
    list.innerHTML = '';
  }

  const rowById = (id) => st.rows.find((r) => r.id === id);
  const rowIndex = (id) => st.rows.findIndex((r) => r.id === id);
  function patchLocal(id, patch) {
    const r = rowById(id);
    if (r) Object.assign(r, patch);
    if (st.detail?.id === id) Object.assign(st.detail, patch);
  }

  // ---------- list interactions ----------
  list.addEventListener('click', (e) => {
    const row = e.target.closest('.tx-row');
    if (!row) return;
    const id = row.dataset.id;
    if (e.target.closest('[data-check]') || e.metaKey || e.ctrlKey) return toggleCheck(id, e.shiftKey);
    if (e.shiftKey && st.lastCheck >= 0) return toggleCheck(id, true);
    if (e.target.closest('[data-review]')) { const t = rowById(id); return update(id, { reviewed: !t.reviewed }); }
    select(id, { open: true });
  });

  function toggleCheck(id, range_) {
    const i = rowIndex(id);
    if (range_ && st.lastCheck >= 0) {
      const [a, b] = [Math.min(i, st.lastCheck), Math.max(i, st.lastCheck)];
      for (let k = a; k <= b; k++) st.checked.add(st.rows[k].id);
    } else if (st.checked.has(id)) st.checked.delete(id);
    else st.checked.add(id);
    st.lastCheck = i;
    paint(true); renderBulk();
  }

  function select(id, { open = false } = {}) {
    st.active = id;
    writeHash();
    paint(true);
    ensureVisible(id);
    showDetail(id);
    if (open) shell.setDetailOpen(true);
  }

  function ensureVisible(id) {
    const i = items.findIndex((it) => it.t?.id === id);
    if (i < 0) return;
    const bar = $('.pane-bar', main)?.offsetHeight ?? 0, bulk = bulkbar.hidden ? 0 : bulkbar.offsetHeight;
    const y = list.offsetTop + offsets[i];
    const headAbove = items[i - 1]?.kind === 'head' ? HEAD_H : 0;
    if (y - headAbove < main.scrollTop + bar) main.scrollTop = y - headAbove - bar;
    else if (y + ROW_H > main.scrollTop + main.clientHeight - bulk) main.scrollTop = y + ROW_H - main.clientHeight + bulk;
  }

  function move(delta) {
    if (!st.rows.length) return;
    const i = rowIndex(st.active);
    const next = st.rows[Math.max(0, Math.min(st.rows.length - 1, i < 0 ? 0 : i + delta))];
    if (next && next.id !== st.active) select(next.id);
  }

  // ---------- edits (optimistic, write-through) ----------
  async function update(id, body, localPatch = body) {
    const before = { ...(rowById(id) || st.detail || {}) };
    patchLocal(id, localPatch);
    paint(true); if (st.detail?.id === id) renderDetail();
    try {
      const r = await api('/transactions/' + encodeURIComponent(id), { method: 'PATCH', body });
      patchLocal(id, pick(r.transaction));
      paint(true); if (st.detail?.id === id) renderDetail();
      toast(savedMsg(r));
    } catch (e) {
      patchLocal(id, pick(before));
      paint(true); if (st.detail?.id === id) renderDetail();
      toast(`Couldn’t save: ${e.message}`);
    }
  }
  const pick = (t) => { if (!t) return {}; const { raw, ...rest } = t; return rest; };

  async function bulk(body, localPatch) {
    const ids = [...st.checked];
    if (!ids.length) return;
    const before = new Map(ids.map((id) => [id, { ...rowById(id) }]));
    for (const id of ids) patchLocal(id, typeof localPatch === 'function' ? localPatch(rowById(id)) : localPatch);
    paint(true); if (st.detail && st.checked.has(st.detail.id)) renderDetail();
    try {
      let last;
      for (let i = 0; i < ids.length; i += 500) last = await api('/transactions/bulk', { method: 'POST', body: { transaction_ids: ids.slice(i, i + 500), ...body } });
      toast(`${ids.length} updated · ${savedMsg(last)}`);
    } catch (e) {
      for (const [id, b] of before) patchLocal(id, b);
      paint(true);
      toast(`Couldn’t save: ${e.message}`);
    }
  }

  async function remove(ids) {
    if (!ids.length || !confirm(`Delete ${ids.length === 1 ? 'this transaction' : ids.length + ' transactions'}? Rows synced from Copilot come back on the next sync unless deleted there too.`)) return;
    try {
      for (let i = 0; i < ids.length; i += 500) await api('/transactions/delete', { method: 'POST', body: { transaction_ids: ids.slice(i, i + 500) } });
      const gone = new Set(ids);
      st.rows = st.rows.filter((r) => !gone.has(r.id) && !gone.has(r.split_parent_id));
      st.total = Math.max(0, st.total - ids.length);
      ids.forEach((id) => st.checked.delete(id));
      if (gone.has(st.active)) { st.active = null; writeHash(); renderDetailEmpty(); shell.setDetailOpen(false); }
      rebuild(); renderBulk();
      toast(ids.length === 1 ? 'Deleted' : `Deleted ${ids.length}`);
    } catch (e) { toast(`Couldn’t delete: ${e.message}`); }
  }

  // ---------- bulk bar ----------
  function renderBulk() {
    const n = st.checked.size;
    bulkbar.hidden = !n;
    if (!n) return;
    bulkbar.innerHTML = `<div class="bulkbar__actions">
      <button class="k-btn" data-bulk="categorize" aria-haspopup="dialog">Categorize${I.down}</button>
      <button class="k-btn" data-bulk="review">Mark reviewed</button>
      <button class="k-btn" data-bulk="tag" aria-haspopup="dialog">Tag${I.down}</button>
      <button class="k-btn" data-bulk="exclude">Exclude</button>
      <button class="k-btn bulkbar__danger" data-bulk="delete">Delete</button></div>
      <span class="bulkbar__count body-sm">${n} selected</span>${iconBtn(I.x, 'Clear selection', 'data-bulk="clear"')}`;
  }
  bulkbar.addEventListener('click', (e) => {
    const b = e.target.closest('[data-bulk]');
    if (!b) return;
    const act = b.dataset.bulk;
    if (act === 'clear') return clearChecks();
    if (act === 'review') return bulk({ reviewed: true }, { reviewed: 1 });
    if (act === 'exclude') return bulk({ excluded: true }, { excluded: 1 });
    if (act === 'delete') return remove([...st.checked]);
    if (act === 'categorize') return categoryPicker(b, null, (id) => bulk({ category_id: id }, catPatch(id)));
    if (act === 'tag') return tagPicker(b, (tag) => bulk({ add_tags: [tag] }, (r) => ({ tags: JSON.stringify([...new Set([...parseTags(r?.tags), tag])]) })));
  });
  function clearChecks() { st.checked.clear(); st.lastCheck = -1; paint(true); renderBulk(); }

  // ---------- pickers ----------
  function categoryPicker(anchor, current, onPick) {
    const parents = cats.filter((c) => !c.parent_id).sort((a, b) => a.name.localeCompare(b.name));
    const kids = (id) => cats.filter((c) => c.parent_id === id).sort((a, b) => a.name.localeCompare(b.name));
    const opt = (c, child) => `<button class="picker__item ${child ? 'picker__item--child' : ''}" data-id="${esc(c.id)}" data-name="${esc(c.name.toLowerCase())}" role="option" aria-selected="${c.id === current}">${catTag(c.name, c.emoji, hue(c.parent_id || c.id))}${c.id === current ? `<span class="picker__check">${I.check}</span>` : ''}</button>`;
    const el = h(`<div class="picker"><div class="k-search">${I.search}<input class="k-input" placeholder="Search categories" aria-label="Search categories"></div>
      <div class="picker__list" role="listbox"><button class="picker__item" data-id="" data-name="uncategorized" role="option"><span class="k-tag tag--none">Uncategorized</span></button>
      ${parents.map((p) => opt(p) + kids(p.id).map((c) => opt(c, true)).join('')).join('')}</div></div>`);
    const input = $('input', el);
    input.addEventListener('input', () => { const q = input.value.trim().toLowerCase(); $$('.picker__item', el).forEach((b) => { b.hidden = q && !b.dataset.name.includes(q); }); repositionPopover(); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const b = $$('.picker__item', el).find((x) => !x.hidden); if (b) { closePopover(); onPick(b.dataset.id); } } });
    el.addEventListener('click', (e) => { const b = e.target.closest('.picker__item'); if (b) { closePopover(); onPick(b.dataset.id); } });
    popover(anchor, el, { width: '280px' });
    input.focus();
  }

  async function tagPicker(anchor, onPick) {
    const tags = await cached('/tags', { fresh: true }).catch(() => []);
    const el = h(`<div class="picker"><div class="k-search">${I.hash}<input class="k-input" placeholder="Tag name" aria-label="Tag name"></div>
      <div class="picker__list">${tags.map((t) => `<button class="picker__item" data-tag="${esc(t.tag)}"><span class="tag-chip">#${esc(t.tag)}</span><span class="picker__count amount-sm">${t.n}</span></button>`).join('') || '<p class="body-sm picker__hint">Type a name and press Enter.</p>'}</div></div>`);
    const input = $('input', el);
    const done = (tag) => { tag = tag.trim().replace(/^#/, ''); if (!tag) return; closePopover(); onPick(tag); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(input.value); });
    el.addEventListener('click', (e) => { const b = e.target.closest('[data-tag]'); if (b) done(b.dataset.tag); });
    popover(anchor, el, { width: '240px' });
    input.focus();
  }

  function accountPicker(anchor, current, onPick) {
    menu(anchor, accts.filter((a) => !a.closed).map((a) => ({ label: `${a.name}${a.mask ? ' ' + a.mask : ''}`, icon: `<i class="acct-dot" style="background:var(--cat-${hue(a.id)})"></i>`, checked: a.id === current, run: () => onPick(a.id) })), { width: '260px' });
  }

  // ---------- title bar actions ----------
  main.addEventListener('click', (e) => {
    const clear = e.target.closest('[data-clear]');
    if (clear) {
      const [k, v] = clear.dataset.clear.split(/:(.*)/s);
      if (k === 'all') { Object.assign(f, readParams(new URLSearchParams())); }
      else if (k === 'date') { f.from = f.to = ''; }
      else if (k === 'amount') { f.min = f.max = ''; }
      else if (k === 'q') { f.q = ''; main.classList.remove('is-searching'); }
      else f[k] = f[k].filter((x) => x !== v);
      return applyFilters();
    }
    const b = e.target.closest('.pane-bar [data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'views') return viewsMenu(b);
    if (act === 'filter') return filterPopover(b);
    if (act === 'sort') return sortMenu(b);
    if (act === 'search') { const open = main.classList.toggle('is-searching'); if (!open && f.q) { f.q = ''; applyFilters(); return; } renderBar(); $('.bar-search', main)?.focus(); return; }
    if (act === 'add') return addSheet();
    if (act === 'export') { location.href = '/api/transactions/export.csv?' + filterQuery(f); return; }
  });

  function currentView() {
    const now = filterQuery(f, { forUrl: true }).toString();
    return now ? store.get(VIEWS_KEY, []).find((v) => v.query === now) : null;
  }
  function viewsMenu(anchor) {
    const views = store.get(VIEWS_KEY, []);
    const cur = currentView();
    const set = (patch) => { Object.assign(f, readParams(new URLSearchParams()), patch); applyFilters(); };
    menu(anchor, [
      { label: 'All transactions', checked: !hasFilters(f), run: () => set({}) },
      { heading: 'Accounts' },
      ...accts.filter((a) => !a.closed).map((a) => ({ label: a.name, icon: `<i class="acct-dot" style="background:var(--cat-${hue(a.id)})"></i>`, checked: f.accounts.length === 1 && f.accounts[0] === a.id && !hasFilters({ ...f, accounts: [] }), run: () => set({ accounts: [a.id] }) })),
      { heading: 'Saved views' },
      ...views.map((v) => ({ label: v.name, checked: cur === v, run: () => set(readParams(new URLSearchParams(v.query))) })),
      { label: 'Save current view…', icon: I.plus, disabled: !hasFilters(f) || Boolean(cur), run: () => { const name = prompt('Name this view'); if (name?.trim()) { store.set(VIEWS_KEY, [...views, { name: name.trim(), query: filterQuery(f, { forUrl: true }).toString() }]); renderBar(); toast('View saved'); } } },
      ...(cur ? [{ label: `Delete “${cur.name}”`, danger: true, run: () => { store.set(VIEWS_KEY, views.filter((v) => v !== cur)); renderBar(); } }] : []),
    ], { width: '260px' });
  }

  function sortMenu(anchor) {
    const dir = f.dir || defaultDir(f.sort);
    const [, descLabel, ascLabel] = SORTS[f.sort];
    menu(anchor, [
      ...Object.entries(SORTS).map(([k, [label]]) => ({ label, checked: f.sort === k, run: () => { f.sort = k; f.dir = ''; applyFilters(); } })),
      '-',
      { label: f.sort === 'name' ? ascLabel : descLabel, checked: dir === (f.sort === 'name' ? 'asc' : 'desc'), run: () => { f.dir = f.sort === 'name' ? 'asc' : 'desc'; applyFilters(); } },
      { label: f.sort === 'name' ? descLabel : ascLabel, checked: dir === (f.sort === 'name' ? 'desc' : 'asc'), run: () => { f.dir = f.sort === 'name' ? 'desc' : 'asc'; applyFilters(); } },
    ], { align: 'end', width: '200px' });
  }

  async function filterPopover(anchor) {
    const tags = await cached('/tags', { fresh: true }).catch(() => []);
    const parents = cats.filter((c) => !c.parent_id).sort((a, b) => a.name.localeCompare(b.name));
    const check = (key, value, label, extra = '') => `<label class="check-row ${extra}"><input type="checkbox" data-k="${key}" value="${esc(value)}" ${f[key].includes(value) ? 'checked' : ''}><span>${label}</span></label>`;
    const toggles = (key, opts) => `<div class="k-range filter__toggles">${opts.map(([v, l]) => `<button class="k-range__opt ${f[key].includes(v) ? 'k-range__opt--active' : ''}" data-k="${key}" data-v="${v}" aria-pressed="${f[key].includes(v)}">${l}</button>`).join('')}</div>`;
    const el = h(`<div class="filter">
      <section><div class="k-eyebrow">Date</div>
        <div class="k-range filter__toggles">${DATE_PRESETS.map(([l, fn]) => { const [a, b] = fn(); return `<button class="k-range__opt ${f.from === a && f.to === b && (a || b || l === 'All') ? 'k-range__opt--active' : ''}" data-preset="${l}">${l}</button>`; }).join('')}</div>
        <div class="filter__pair"><input class="k-input" type="date" data-f="from" value="${esc(f.from)}" aria-label="From"><span class="body-sm">to</span><input class="k-input" type="date" data-f="to" value="${esc(f.to)}" aria-label="To"></div></section>
      <section><div class="k-eyebrow">Accounts</div><div class="filter__list">${accts.map((a) => check('accounts', a.id, `<i class="acct-dot" style="background:var(--cat-${hue(a.id)})"></i>${esc(a.name)}${a.mask ? ` <span class="k-row__sub">${esc(a.mask)}</span>` : ''}`, a.hidden || a.closed ? 'is-faint' : '')).join('')}</div></section>
      <section><div class="k-eyebrow">Categories</div><div class="filter__list filter__list--tall">${parents.map((p) => check('categories', p.id, catTag(p.name, p.emoji, hue(p.id))) + cats.filter((c) => c.parent_id === p.id).map((c) => check('categories', c.id, catTag(c.name, c.emoji, hue(p.id)), 'check-row--child')).join('')).join('')}</div></section>
      <section><div class="k-eyebrow">Tags</div><div class="filter__list">${tags.map((t) => check('tags', t.tag, `#${esc(t.tag)}`)).join('') || '<p class="body-sm filter__hint">No tags yet.</p>'}</div></section>
      <section><div class="k-eyebrow">Amount</div><div class="filter__pair"><input class="k-input" type="number" min="0" step="any" inputmode="decimal" placeholder="Min" data-f="min" value="${esc(f.min)}" aria-label="Minimum amount"><span class="body-sm">to</span><input class="k-input" type="number" min="0" step="any" inputmode="decimal" placeholder="Max" data-f="max" value="${esc(f.max)}" aria-label="Maximum amount"></div></section>
      <section><div class="k-eyebrow">Type</div>${toggles('types', TYPES)}</section>
      <section><div class="k-eyebrow">Status</div>${toggles('statuses', STATUSES)}</section>
      <footer class="filter__foot"><button class="k-btn" data-reset>Clear all</button><button class="k-btn k-btn--primary" data-done>Done</button></footer>
    </div>`);
    let deb;
    const changed = (now = false) => { clearTimeout(deb); deb = setTimeout(() => { applyFilters(); repositionPopover(); }, now ? 0 : 300); };
    el.addEventListener('change', (e) => {
      const k = e.target.dataset.k;
      if (k) { const v = e.target.value; f[k] = e.target.checked ? [...new Set([...f[k], v])] : f[k].filter((x) => x !== v); changed(true); }
      if (e.target.dataset.f === 'from' || e.target.dataset.f === 'to') { f[e.target.dataset.f] = e.target.value; $$('[data-preset]', el).forEach((b) => b.classList.remove('k-range__opt--active')); changed(true); }
    });
    el.addEventListener('input', (e) => { const k = e.target.dataset.f; if (k === 'min' || k === 'max') { f[k] = e.target.value; changed(); } });
    el.addEventListener('click', (e) => {
      const p = e.target.closest('[data-preset]');
      if (p) { const [a, b] = DATE_PRESETS.find((x) => x[0] === p.dataset.preset)[1](); f.from = a; f.to = b; $('[data-f="from"]', el).value = a; $('[data-f="to"]', el).value = b; $$('[data-preset]', el).forEach((x) => x.classList.toggle('k-range__opt--active', x === p)); return changed(true); }
      const t = e.target.closest('[data-v]');
      if (t) { const k = t.dataset.k, v = t.dataset.v, on = !f[k].includes(v); f[k] = on ? [...f[k], v] : f[k].filter((x) => x !== v); t.classList.toggle('k-range__opt--active', on); t.setAttribute('aria-pressed', on); return changed(true); }
      if (e.target.closest('[data-reset]')) { const q = f.q; Object.assign(f, readParams(new URLSearchParams()), { q, sort: f.sort, dir: f.dir }); closePopover(); return applyFilters(); }
      if (e.target.closest('[data-done]')) closePopover();
    });
    popover(anchor, el, { width: '340px' });
  }

  // ---------- add / split sheets ----------
  function addSheet() {
    const opts = (list_, cur) => list_.map((x) => `<option value="${esc(x.id)}" ${x.id === cur ? 'selected' : ''}>${x.label}</option>`).join('');
    const catOpts = cats.filter((c) => !c.parent_id).sort((a, b) => a.name.localeCompare(b.name)).flatMap((p) => [p, ...cats.filter((c) => c.parent_id === p.id)]).map((c) => ({ id: c.id, label: `${c.parent_id ? '— ' : ''}${c.emoji ? esc(c.emoji) + ' ' : ''}${esc(c.name)}` }));
    const s = sheet(`<form class="form">
      <header class="form__head"><h2 class="h2">Add transaction</h2>${iconBtn(I.x, 'Close', 'type="button" data-act="close-sheet"')}</header>
      <label class="form__field"><span class="k-eyebrow">Date</span><input class="k-input" type="date" name="date" value="${today()}" required></label>
      <label class="form__field"><span class="k-eyebrow">Merchant</span><input class="k-input" name="name" required placeholder="Farmers market"></label>
      <div class="form__field"><span class="k-eyebrow">Amount</span><div class="filter__pair"><input class="k-input amount" type="number" name="amount" step="0.01" min="0" inputmode="decimal" required placeholder="0.00">
        <div class="k-range" role="radiogroup"><button type="button" class="k-range__opt k-range__opt--active" data-kind="expense" aria-pressed="true">Expense</button><button type="button" class="k-range__opt" data-kind="income" aria-pressed="false">Income</button></div></div></div>
      <label class="form__field"><span class="k-eyebrow">Account</span><select class="k-input" name="account_id"><option value="">No account</option>${opts(accts.filter((a) => !a.closed).map((a) => ({ id: a.id, label: esc(a.name) })), f.accounts[0])}</select></label>
      <label class="form__field"><span class="k-eyebrow">Category</span><select class="k-input" name="category_id"><option value="">Uncategorized</option>${opts(catOpts)}</select></label>
      <label class="form__field"><span class="k-eyebrow">Notes</span><textarea class="k-input notes" name="note" rows="3"></textarea></label>
      <footer class="form__foot"><button class="k-btn" type="button" data-act="close-sheet">Cancel</button><button class="k-btn k-btn--primary" type="submit">Add transaction</button></footer></form>`, { label: 'Add transaction' });
    const form = $('form', s.el);
    let kind = 'expense';
    form.addEventListener('click', (e) => { const b = e.target.closest('[data-kind]'); if (!b) return; kind = b.dataset.kind; $$('[data-kind]', form).forEach((x) => { x.classList.toggle('k-range__opt--active', x === b); x.setAttribute('aria-pressed', x === b); }); });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(form));
      const amount = Math.abs(Number(d.amount)) * (kind === 'income' ? -1 : 1);
      try {
        const r = await api('/transactions', { method: 'POST', body: { date: d.date, name: d.name.trim(), amount, account_id: d.account_id || undefined, category_id: d.category_id || undefined, note: d.note || undefined, type: kind === 'income' ? 'income' : 'regular' } });
        s.close(); toast(savedMsg(r));
        st.active = r.transaction.id; await load(); select(r.transaction.id, { open: true });
      } catch (err) { toast(`Couldn’t add: ${err.message}`); }
    });
    $('[name="name"]', form).focus();
  }

  async function splitSheet(t) {
    const existing = t.split ? (await api(`/transactions?q=&limit=50&transfers=true&excluded=true&start=${t.date}&end=${t.date}`)).transactions.filter((r) => r.split_parent_id === t.id) : [];
    const lines = existing.length ? existing.map((r) => ({ amount: Math.abs(r.amount), category_id: r.category_id || '' })) : [{ amount: Math.abs(t.amount), category_id: t.category_id || '' }, { amount: 0, category_id: '' }];
    const sign = t.amount < 0 ? -1 : 1, total = Math.abs(t.amount);
    const catOpts = (cur) => `<option value="">Uncategorized</option>` + cats.filter((c) => !c.parent_id).sort((a, b) => a.name.localeCompare(b.name)).flatMap((p) => [p, ...cats.filter((c) => c.parent_id === p.id)]).map((c) => `<option value="${esc(c.id)}" ${c.id === cur ? 'selected' : ''}>${c.parent_id ? '— ' : ''}${c.emoji ? esc(c.emoji) + ' ' : ''}${esc(c.name)}</option>`).join('');
    const s = sheet(`<form class="form">
      <header class="form__head"><h2 class="h2">Split ${esc(t.name)}</h2>${iconBtn(I.x, 'Close', 'type="button" data-act="close-sheet"')}</header>
      <p class="body-sm form__hint">Parts must add up to <span class="amount">${money(total)}</span>. The original stays visible; the parts carry the spend.</p>
      <div class="split-lines"></div>
      <button class="k-btn" type="button" data-add>${I.plus}Add part</button>
      <p class="body-sm split-remaining"></p>
      <footer class="form__foot">${t.split ? '<button class="k-btn bulkbar__danger" type="button" data-unsplit>Remove split</button>' : ''}<button class="k-btn" type="button" data-act="close-sheet">Cancel</button><button class="k-btn k-btn--primary" type="submit">Save split</button></footer></form>`, { label: 'Split transaction' });
    const form = $('form', s.el), box = $('.split-lines', form), rem = $('.split-remaining', form);
    const draw = () => {
      box.innerHTML = lines.map((l, i) => `<div class="split-line"><input class="k-input amount" type="number" step="0.01" min="0" inputmode="decimal" data-i="${i}" value="${l.amount || ''}" placeholder="0.00" aria-label="Part ${i + 1} amount"><select class="k-input" data-c="${i}" aria-label="Part ${i + 1} category">${catOpts(l.category_id)}</select>${iconBtn(I.x, 'Remove part', `type="button" data-del="${i}" ${lines.length <= 2 ? 'disabled' : ''}`)}</div>`).join('');
      left();
    };
    const left = () => { const r = Math.round((total - lines.reduce((a, l) => a + (Number(l.amount) || 0), 0)) * 100) / 100; rem.textContent = r === 0 ? 'Fully allocated.' : r > 0 ? `${money(r)} left to allocate` : `${money(-r)} over`; rem.classList.toggle('is-over', r < 0); return r; };
    form.addEventListener('input', (e) => { if (e.target.dataset.i) { lines[e.target.dataset.i].amount = Number(e.target.value); left(); } });
    form.addEventListener('change', (e) => { if (e.target.dataset.c) lines[e.target.dataset.c].category_id = e.target.value; });
    form.addEventListener('click', async (e) => {
      if (e.target.closest('[data-add]')) { lines.push({ amount: Math.max(0, left()), category_id: '' }); draw(); }
      const del = e.target.closest('[data-del]');
      if (del) { lines.splice(+del.dataset.del, 1); draw(); }
      if (e.target.closest('[data-unsplit]')) save([]);
    });
    const save = async (parts) => {
      try { const r = await api(`/transactions/${encodeURIComponent(t.id)}/split`, { method: 'POST', body: { splits: parts } }); s.close(); toast(parts.length ? `Split into ${parts.length} · ${savedMsg(r)}` : 'Split removed'); await load(); select(t.id); }
      catch (err) { toast(err.message); }
    };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (left() !== 0) return toast('Parts must add up to the original amount');
      save(lines.filter((l) => l.amount).map((l) => ({ amount: sign * Number(l.amount), category_id: l.category_id || undefined })));
    });
    draw();
  }

  // ---------- detail pane ----------
  function renderDetailEmpty() {
    if (st.active) return;
    detail.innerHTML = titleBar('<span class="pane-title">Transaction</span>', '', { back: true }) + `<div class="pane-empty">${emptyState('Select a transaction to see its details.')}</div>`;
  }

  async function showDetail(id) {
    const local = rowById(id);
    st.detail = local ? { ...local } : null;
    if (st.detail) renderDetail(); else detail.innerHTML = titleBar('<span class="pane-title">Transaction</span>', '', { back: true }) + '<div class="k-detail"><i class="skel skel--title"></i><i class="skel"></i><i class="skel"></i></div>';
    try {
      const [t, sim] = await Promise.all([api('/transactions/' + encodeURIComponent(id)), api(`/transactions/${encodeURIComponent(id)}/similar`).catch(() => null)]);
      if (st.active !== id) return;
      st.detail = { ...pick(t), similar: sim };
      renderDetail();
    } catch (e) {
      if (st.active !== id) return;
      detail.innerHTML = titleBar('<span class="pane-title">Transaction</span>', '', { back: true }) + `<div class="pane-empty">${emptyState(`Couldn’t load this transaction. ${e.message}`)}</div>`;
    }
  }

  function renderDetail() {
    const t = st.detail;
    if (!t) return renderDetailEmpty();
    const type = typeOf(t);
    const tags = parseTags(t.tags);
    const acct = acctById.get(t.account_id);
    const goal = goals.find((g) => g.id === t.goal_id);
    const notes = $('.notes', detail);
    const keepNotes = notes && document.activeElement === notes ? notes.value : null;
    detail.innerHTML = titleBar(
      `<button class="title-btn" data-d="type" aria-haspopup="menu">${typeLabel[type]}${I.down}</button>`,
      `<button class="k-btn" data-d="split" ${t.split_parent_id ? 'disabled title="This is part of a split"' : ''}>${I.split}<span class="hide-sm">Split</span></button>
       <button class="k-btn" data-d="recurring" ${t.recurring_id ? '' : 'disabled title="Not part of a recurring series"'}>${I.repeat}<span class="hide-sm">Recurring</span></button>
       ${iconBtn(I.more, 'More actions', 'data-d="more" aria-haspopup="menu"')}`,
      { back: true },
    ) + `<div class="k-detail tx-detail">
      <div class="k-detail__badges"><span class="k-detail__meta">${I.calendar}${esc(longDate(t.date))}</span><span class="k-detail__meta">${[t.pending ? 'Pending' : '', t.excluded ? 'Excluded' : '', t.split ? 'Split' : '', t.split_parent_id ? 'Part of a split' : ''].filter(Boolean).join(' · ')}</span></div>
      <div class="k-detail__row">
        <h1 class="k-detail__title editable" data-edit="name" tabindex="0" title="Click to rename">${esc(t.name)}</h1>
        <span class="k-detail__amount editable ${t.amount < 0 && !t.transfer ? 'is-income' : ''} ${t.pending ? 'is-pending' : ''} ${t.excluded ? 'is-excluded' : ''}" data-edit="amount" tabindex="0" title="Click to edit the amount">${txAmount(t.amount)}</span>
      </div>
      ${t.original_name && t.original_name !== t.name ? `<div class="k-detail__meta">Bank description: ${esc(t.original_name)}</div>` : ''}
      <div class="tx-fields">
        <div class="tx-field"><span class="k-eyebrow">Category</span>${type === 'transfer' ? '<span class="body-sm tx-field__none">Transfers aren’t categorized</span>' : `<button class="pick" data-d="category" aria-haspopup="dialog" title="Change category (E)">${tagFor(t)}</button>`}</div>
        <div class="tx-field"><span class="k-eyebrow">Account</span><button class="pick" data-d="account" aria-haspopup="menu"><span class="acct-pill"><i class="acct-dot" style="background:var(--cat-${hue(t.account_id)})"></i>${esc(acct?.name ?? t.account_name ?? 'No account')}${acct?.mask ? ' ' + esc(acct.mask) : ''}</span></button></div>
        <div class="tx-field tx-field--wide"><span class="k-eyebrow">Goal</span>${goal ? `<button class="pick" data-d="goal"><span class="acct-pill">${I.flag}${esc(goal.name)}</span></button>` : iconBtn(I.plus, 'Add to a goal', 'data-d="goal"')}</div>
        <label class="tx-field tx-field--wide"><span class="k-eyebrow">Notes</span><textarea class="k-input notes" rows="3" placeholder="Add a note">${esc(keepNotes ?? t.note ?? '')}</textarea></label>
        <div class="tx-field tx-field--wide"><span class="k-eyebrow">Tags</span><div class="tag-list">${tags.map((g) => `<span class="tag-chip">#${esc(g)}<button class="tag-chip__x" data-untag="${esc(g)}" aria-label="Remove tag ${esc(g)}">${I.x}</button></span>`).join('')}<button class="tag-add body-sm" data-d="tag">${I.hash}Add tag</button></div></div>
      </div>
      ${similarHtml(t)}
    </div>`;
    if (keepNotes != null) { const n = $('.notes', detail); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }
  }

  function similarHtml(t) {
    const sim = t.similar;
    if (sim === undefined) return '<section class="similar"><h2 class="h2">Similar transactions</h2><i class="skel"></i><i class="skel"></i></section>';
    if (!sim || !sim.months.length) return '';
    return `<section class="similar"><h2 class="h2">Similar transactions</h2>${sim.months.map((m) => {
      let day = null;
      return `<div class="similar__month"><div class="similar__head"><span class="body">${esc(monthLabel(m.month))}</span><span class="amount-sm" title="This account (all accounts)">${txAmount(m.account_total)} (${txAmount(m.all_total)})</span></div>
        ${m.transactions.map((r) => { const head = r.date !== day ? `<div class="k-dayhead"><span class="k-eyebrow">${esc(dayHead((day = r.date)))}</span></div>` : ''; return head + `<div class="k-row k-txrow--compact tx-row--compact" data-sim="${esc(r.id)}" role="button" tabindex="0">
          <span class="k-row__review ${r.reviewed ? 'k-row__review--done' : ''}"></span>
          <span class="tx-row__text"><span class="k-row__name">${esc(r.name)}</span><span class="k-row__sub">${esc(r.account_name ?? '')}${r.account_mask ? ' ' + esc(r.account_mask) : ''}</span></span>
          <span class="tx-row__tag">${tagFor(r)}</span>
          <span class="k-row__amt ${r.amount < 0 && !r.transfer ? 'k-row__amt--income' : ''} ${r.pending ? 'k-row__amt--pending' : ''}">${txAmount(r.amount)}</span></div>`; }).join('')}</div>`;
    }).join('')}</section>`;
  }

  detail.addEventListener('click', (e) => {
    const t = st.detail;
    if (e.target.closest('[data-act="back"]')) return closeDetail();
    const sim = e.target.closest('[data-sim]');
    if (sim) return select(sim.dataset.sim);
    const untag = e.target.closest('[data-untag]');
    if (untag && t) return update(t.id, { tags: parseTags(t.tags).filter((x) => x !== untag.dataset.untag) }, { tags: JSON.stringify(parseTags(t.tags).filter((x) => x !== untag.dataset.untag)) });
    const edit = e.target.closest('[data-edit]');
    if (edit && t) return inlineEdit(edit);
    const b = e.target.closest('[data-d]');
    if (!b || !t) return;
    const act = b.dataset.d;
    if (act === 'type') return menu(b, TYPES.map(([v, l]) => ({ label: l === 'Regular' ? 'Regular transaction' : l, checked: typeOf(t) === v, run: () => update(t.id, { type: v }, { transfer: v === 'transfer' ? 1 : 0, income: v === 'income' ? 1 : 0 }) })), { width: '220px' });
    if (act === 'category') return categoryPicker(b, t.category_id, (id) => update(t.id, { category_id: id }, catPatch(id)));
    if (act === 'account') return accountPicker(b, t.account_id, (id) => { const a = acctById.get(id); update(t.id, { account_id: id }, { account_id: id, account_name: a?.name, account_mask: a?.mask }); });
    if (act === 'goal') return menu(b, [...goals.map((g) => ({ label: g.name, icon: I.flag, checked: g.id === t.goal_id, run: () => update(t.id, { goal_id: g.id }) })), ...(goals.length ? [] : [{ label: 'No goals yet', disabled: true }]), ...(t.goal_id ? ['-', { label: 'Remove from goal', run: () => update(t.id, { goal_id: null }) }] : [])], { width: '220px' });
    if (act === 'tag') return tagPicker(b, (tag) => { const next = [...new Set([...parseTags(t.tags), tag])]; update(t.id, { tags: next }, { tags: JSON.stringify(next) }); });
    if (act === 'split') return splitSheet(t);
    if (act === 'recurring') return (location.hash = '#/recurrings');
    if (act === 'more') return menu(b, [
      { label: t.reviewed ? 'Mark unreviewed' : 'Mark reviewed', trail: '<kbd>R</kbd>', run: () => update(t.id, { reviewed: !t.reviewed }) },
      { label: t.excluded ? 'Include in spending' : 'Exclude from spending', run: () => update(t.id, { excluded: !t.excluded }) },
      '-',
      { label: 'Delete', danger: true, run: () => remove([t.id]) },
    ], { align: 'end', width: '220px' });
  });
  detail.addEventListener('keydown', (e) => { const edit = e.target.closest('[data-edit]'); if (edit && (e.key === 'Enter' || e.key === ' ') && !edit.querySelector('input')) { e.preventDefault(); inlineEdit(edit); } });
  detail.addEventListener('focusout', (e) => {
    if (!e.target.classList.contains('notes') || !st.detail) return;
    const v = e.target.value;
    if (v !== (st.detail.note ?? '')) update(st.detail.id, { note: v });
  });

  function inlineEdit(el) {
    if (el.querySelector('input')) return;
    const t = st.detail, isAmt = el.dataset.edit === 'amount';
    const input = h(`<input class="k-input inline-edit ${isAmt ? 'inline-edit--amount' : ''}" ${isAmt ? 'type="number" step="0.01" min="0" inputmode="decimal"' : ''} aria-label="${isAmt ? 'Amount' : 'Name'}">`);
    input.value = isAmt ? Math.abs(t.amount).toFixed(2) : t.name;
    el.replaceChildren(input); input.focus(); input.select();
    let done = false;
    const finish = (save) => {
      if (done) return; done = true;
      if (!save) return renderDetail();
      if (isAmt) { const n = Number(input.value); if (!input.value || Number.isNaN(n)) return renderDetail(); const amount = (t.amount < 0 ? -1 : 1) * Math.abs(n); if (amount !== t.amount) update(t.id, { amount }); else renderDetail(); }
      else { const name = input.value.trim(); if (name && name !== t.name) update(t.id, { name }); else renderDetail(); }
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') { e.stopPropagation(); finish(false); } });
    input.addEventListener('blur', () => finish(true));
  }

  function closeDetail() {
    shell.setDetailOpen(false);
    if (!matchMedia('(min-width: 1100px)').matches) { st.active = null; st.detail = null; writeHash(); paint(true); renderDetailEmpty(); }
  }

  // ---------- keyboard (called by the shell when focus isn't in a field) ----------
  function onKey(e) {
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); move(e.key === 'ArrowDown' ? 1 : -1); return true; }
    if (e.key === 'Enter' && st.active) { shell.setDetailOpen(true); return true; }
    if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); st.rows.forEach((r) => st.checked.add(r.id)); paint(true); renderBulk(); return true; }
    if (mod || e.altKey) return false;
    const t = st.detail;
    if (e.key.toLowerCase() === 'r' && t) { update(t.id, { reviewed: !t.reviewed }); return true; }
    if (e.key.toLowerCase() === 'e' && t && typeOf(t) !== 'transfer') { e.preventDefault(); shell.setDetailOpen(true); requestAnimationFrame(() => $('[data-d="category"]', detail)?.click()); return true; }
    if (e.key.toLowerCase() === 'f') { $('[data-act="filter"]', main)?.click(); return true; }
    if (e.key === '/') { e.preventDefault(); main.classList.add('is-searching'); renderBar(); $('.bar-search', main)?.focus(); return true; }
    if (e.key === 'Escape') {
      if (st.checked.size) { clearChecks(); return true; }
      if (shell.detailOpen()) { closeDetail(); return true; }
    }
    return false;
  }

  // ---------- mount ----------
  renderBar(); renderChips();
  if (st.active) { shell.setDetailOpen(true); showDetail(st.active); } else renderDetailEmpty();
  load();
  return { main, detail, onKey, destroy() { ro.disconnect(); closePopover(); } };
}
