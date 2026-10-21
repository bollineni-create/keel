// Daybook v1 screens (single-pane card grid). They render inside the shell's main pane and get
// migrated to the three-pane specs in docs/screens/ one at a time; Transactions lives in transactions.js.
import { $, h, esc, money, pct, today, thisMonth, monthLabel, monthShort, shiftMonth, dateLabel, api, toast, store, I, sheet, emptyState } from './lib.js';
import { connectionsCard, openAddAccount } from './connections.js';

let navigate = () => {}, refreshChrome = () => {};
export function bindShell(fns) { ({ navigate, refreshChrome } = fns); }

// ---------- charts (inline SVG) ----------
function lineChart(series, { height = 160, fmt = (v) => money(v, { cents: false }), labels = [], area = true } = {}) {
  const all = series.flatMap((s) => s.values);
  if (!all.length) return '<div class="empty">No data yet</div>';
  const min = Math.min(...all), max = Math.max(...all);
  const W = 1000, H = 1000;
  const n = Math.max(...series.map((s) => s.values.length));
  const x = (i) => (n === 1 ? W / 2 : (i / (n - 1)) * W);
  const y = (v) => (max === min ? H / 2 : (1 - (v - min) / (max - min)) * H);
  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="height:${height}px">`;
  for (const t of [0, 0.5, 1]) svg += `<line class="grid" x1="0" x2="${W}" y1="${(t * H).toFixed(1)}" y2="${(t * H).toFixed(1)}" vector-effect="non-scaling-stroke"/>`;
  series.forEach((s, si) => {
    const pts = s.values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    if (area && si === 0) svg += `<path class="area" d="M${pts[0]} L${pts.join(' L')} L${x(s.values.length - 1).toFixed(1)},${H} L${x(0).toFixed(1)},${H} Z"/>`;
    svg += `<path class="line ${s.cls || ''}" d="M${pts.join(' L')}" vector-effect="non-scaling-stroke"/>`;
  });
  svg += '</svg>';
  const xl = labels.map((l, i) => (l ? `<span style="left:${(x(i) / 10).toFixed(2)}%;transform:translateX(${i === 0 ? '0' : i === n - 1 ? '-100%' : '-50%'})">${esc(l)}</span>` : '')).join('');
  return `<div class="chart-wrap"><span class="ytick top">${esc(fmt(max))}</span><span class="ytick bottom">${esc(fmt(min))}</span>${svg}<div class="xticks">${xl}</div></div>`;
}
function barChart(rows, { height = 180 } = {}) {
  if (!rows.length) return '<div class="empty">No data yet</div>';
  const max = Math.max(...rows.flatMap((r) => [r.spend, r.income]), 1);
  const bars = rows.map((r) => `<div class="bargroup"><i class="bar-income" style="height:${((r.income / max) * 100).toFixed(1)}%"></i><i class="bar-spend" style="height:${((r.spend / max) * 100).toFixed(1)}%"></i><span>${monthShort(r.month)}</span></div>`).join('');
  return `<div class="chart-wrap"><span class="ytick top">${money(max, { cents: false })}</span><div class="bars" style="height:${height}px">${bars}</div></div>`;
}

// ---------- rows ----------
function txRow(t) {
  const cat = t.category_name || 'Uncategorized';
  return `<button class="row" data-tx="${esc(t.id)}">
    <span class="disc">${t.category_emoji ? esc(t.category_emoji) : t.income ? '💵' : '•'}</span>
    <span class="main"><span class="name">${esc(t.name)}</span>
      <span class="meta">${t.pending ? '<i class="pend" title="Pending"></i>' : ''}${!t.reviewed && !t.pending ? '<i class="unrev" title="Needs review"></i>' : ''}<span>${esc(cat)}</span>${t.account_name ? `<span>· ${esc(t.account_name)}${t.account_mask ? ' ••' + esc(t.account_mask) : ''}</span>` : ''}</span></span>
    <span class="amount ${t.amount < 0 ? 'pos' : ''}">${money(-t.amount, { sign: t.amount < 0 })}</span>
  </button>`;
}
function groupByDate(list) {
  const groups = new Map();
  for (const t of list) { if (!groups.has(t.date)) groups.set(t.date, []); groups.get(t.date).push(t); }
  return [...groups].map(([d, rows]) => `<div class="date-head"><span class="label">${dateLabel(d)}</span><span class="mono-sm faint">${money(rows.reduce((s, r) => s + (r.amount > 0 ? r.amount : 0), 0))}</span></div>${rows.map(txRow).join('')}`).join('');
}
function budgetRow(b) {
  const w = Math.min(100, b.pct);
  return `<div class="budget ${b.parent_id ? 'child' : ''}"><div class="top"><span class="name">${b.emoji ? esc(b.emoji) + ' ' : ''}${esc(b.name)}</span><span class="body-sm muted"><span class="amount ${b.status === 'over' ? 'neg' : ''}">${money(b.spent, { cents: false })}</span> of <span class="amount">${money(b.budget, { cents: false })}</span> · ${pct(b.pct)}</span></div><div class="bar ${b.status}"><i style="width:${w}%"></i></div></div>`;
}

// ---------- screens ----------
export const screens = {
  async '/'() {
    const [o, daily, unusual, txs] = await Promise.all([api('/overview'), api('/spending/daily'), api('/spending/unusual'), api('/transactions?limit=8')]);
    const m = o.month, nw = o.net_worth;
    const b = o.budgets;
    const atRisk = b.items.filter((i) => i.status !== 'ok').slice(0, 5);
    const prevDelta = m.prev_month_spend ? ((m.spend - m.prev_month_spend) / m.prev_month_spend) * 100 : 0;
    const budgetPct = b.total_budget ? (b.total_spent / b.total_budget) * 100 : 0;
    const dayLabels = daily.map((d, i) => (i === 0 || i === daily.length - 1 ? Number(d.date.slice(-2)) + '' : ''));
    return `
      <div class="screen-head"><div><div class="label">${monthLabel(m.month)}</div></div><div class="actions"><span class="chip ${m.days_left <= 5 ? 'amber' : ''}">${m.days_left} days left</span></div></div>
      <div class="grid">
        <div class="card col-4 stat"><span class="label">Spent this month</span><span class="amount-xl">${money(m.spend, { cents: false })}</span><span class="change muted">${money(m.budgeted, { cents: false })} budgeted · <span class="${prevDelta > 0 ? 'neg' : 'pos'}">${prevDelta > 0 ? '+' : ''}${prevDelta.toFixed(0)}%</span> vs last month</span></div>
        <div class="card col-4 stat"><span class="label">Income</span><span class="amount-xl">${money(m.income, { cents: false })}</span><span class="change ${m.net >= 0 ? 'pos' : 'neg'}">${money(m.net, { sign: true, cents: false })} net</span></div>
        <div class="card col-4 stat"><span class="label">Net worth</span><span class="amount-xl">${money(nw.total, { cents: false })}</span><span class="change muted">${money(nw.assets, { cents: false })} assets · ${money(nw.liabilities, { cents: false })} debt</span></div>
        <div class="card col-8"><div class="card-head"><h2 class="h2">Daily spend</h2><span class="body-sm muted">cumulative, non-recurring</span></div>${lineChart([{ values: daily.map((d) => d.cumulative) }], { labels: dayLabels, height: 170 })}</div>
        <div class="card col-4"><div class="card-head"><h2 class="h2">Budget</h2><a class="link" href="#/categories">All budgets</a></div>
          <div class="budget"><div class="top"><span class="name">Overall</span><span class="body-sm muted"><span class="amount">${money(b.total_spent, { cents: false })}</span> of <span class="amount">${money(b.total_budget, { cents: false })}</span></span></div><div class="bar ${budgetPct >= 100 ? 'over' : budgetPct >= 80 ? 'warn' : ''}"><i style="width:${Math.min(100, budgetPct)}%"></i></div></div>
          ${atRisk.length ? atRisk.map(budgetRow).join('') : '<p class="body-sm muted" style="padding-top:12px">Every budget is on track.</p>'}</div>
        <div class="card col-6"><div class="card-head"><h2 class="h2">Upcoming</h2><a class="link" href="#/recurrings">Recurring</a></div>
          ${o.upcoming.length ? `<div class="rows">${o.upcoming.slice(0, 6).map((r) => `<div class="row"><span class="disc">${esc(r.category_emoji || '↻')}</span><span class="main"><span class="name">${esc(r.name)}</span><span class="meta">${dateLabel(r.next_date)} · ${esc(r.frequency || '')}</span></span><span class="amount ${r.amount < 0 ? 'pos' : ''}">${money(-(r.amount ?? 0), { sign: r.amount < 0 })}</span></div>`).join('')}</div>` : '<p class="body-sm muted">Nothing due in the next two weeks.</p>'}</div>
        <div class="card col-6"><div class="card-head"><h2 class="h2">Needs a look</h2><a class="link" href="#/transactions?unreviewed=1">${m.unreviewed} unreviewed</a></div>
          ${unusual.length ? `<div class="rows">${unusual.slice(0, 5).map((t) => `<button class="row" data-tx="${esc(t.id)}"><span class="disc">!</span><span class="main"><span class="name">${esc(t.name)}</span><span class="meta">${dateLabel(t.date)} · ${esc(t.reason)}</span></span><span class="amount">${money(-t.amount)}</span></button>`).join('')}</div>` : '<p class="body-sm muted">No unusual spending this month.</p>'}</div>
        <div class="card col-12"><div class="card-head"><h2 class="h2">Latest</h2><a class="link" href="#/transactions">All transactions</a></div><div class="rows">${groupByDate(txs.transactions)}</div></div>
      </div>`;
  },

  async '/categories'(params) {
    const month = params.get('month') || thisMonth();
    const [b, cats] = await Promise.all([api('/budgets?month=' + month), api('/categories')]);
    const parents = b.items.filter((i) => !i.parent_id);
    const byParent = new Map();
    for (const i of b.items.filter((i) => i.parent_id)) { if (!byParent.has(i.parent_id)) byParent.set(i.parent_id, []); byParent.get(i.parent_id).push(i); }
    const orphans = b.items.filter((i) => i.parent_id && !parents.some((p) => p.category_id === i.parent_id));
    const pctAll = b.total_budget ? (b.total_spent / b.total_budget) * 100 : 0;
    const unbudgeted = cats.filter((c) => !c.excluded && !b.items.some((i) => i.category_id === c.id));
    const el = h(`<div>
      <div class="screen-head"><div><div class="label">${monthLabel(month)}</div></div>
        <div class="actions"><a class="btn" href="#/categories?month=${shiftMonth(month, -1)}">‹</a><a class="btn" href="#/categories?month=${shiftMonth(month, 1)}">›</a><button class="btn primary" id="add">Add budget</button></div></div>
      <div class="grid">
        <div class="card col-12"><div class="budget"><div class="top"><span class="name h2">All budgets</span><span class="body-sm muted"><span class="amount">${money(b.total_spent, { cents: false })}</span> of <span class="amount">${money(b.total_budget, { cents: false })}</span> · ${money(b.total_budget - b.total_spent, { cents: false })} left · ${b.days_left} days</span></div><div class="bar ${pctAll >= 100 ? 'over' : pctAll >= 80 ? 'warn' : ''}"><i style="width:${Math.min(100, pctAll)}%"></i></div></div></div>
        <div class="card col-12" id="list">${parents.map((p) => budgetRow(p) + (byParent.get(p.category_id) || []).map(budgetRow).join('')).join('')}${orphans.map(budgetRow).join('')}${!b.items.length ? '<div class="empty">No budgets yet. Add one, or sync from Copilot.</div>' : ''}</div>
      </div></div>`);
    el.querySelectorAll('.budget').forEach((row, idx) => {
      const item = [...parents.flatMap((p) => [p, ...(byParent.get(p.category_id) || [])]), ...orphans][idx - 1];
      if (!item) return;
      row.style.cursor = 'pointer';
      row.addEventListener('click', () => openBudgetSheet(item, cats));
    });
    $('#add', el).addEventListener('click', () => openBudgetSheet(null, unbudgeted));
    return el;
  },

  async '/recurrings'() {
    const list = await api('/recurring');
    const active = list.filter((r) => r.state === 'active');
    const monthly = active.filter((r) => (r.amount ?? 0) > 0).reduce((s, r) => s + (r.monthly_equivalent ?? 0), 0);
    const upcoming = active.filter((r) => r.next_date && r.next_date >= today()).sort((a, b) => a.next_date.localeCompare(b.next_date));
    const row = (r) => `<div class="row"><span class="disc">${esc(r.category_emoji || '↻')}</span><span class="main"><span class="name">${esc(r.name)}</span><span class="meta">${r.next_date ? dateLabel(r.next_date) + ' · ' : ''}${esc(r.frequency || '')}${r.category_name ? ' · ' + esc(r.category_name) : ''}${r.state !== 'active' ? ' · ' + r.state : ''}</span></span><span class="amount ${r.amount < 0 ? 'pos' : ''}">${money(-(r.amount ?? 0), { sign: r.amount < 0 })}</span></div>`;
    return `<div class="grid">
        <div class="card col-4 stat"><span class="label">Monthly equivalent</span><span class="amount-xl">${money(monthly, { cents: false })}</span><span class="change muted">${active.length} active</span></div>
        <div class="card col-8"><div class="card-head"><h2 class="h2">Next 30 days</h2></div><div class="rows">${upcoming.filter((r) => r.next_date <= new Date(Date.now() + 30 * 86400e3).toISOString().slice(0, 10)).map(row).join('') || '<p class="body-sm muted">Nothing due.</p>'}</div></div>
        <div class="card col-12"><div class="card-head"><h2 class="h2">All recurring</h2></div><div class="rows">${list.map(row).join('') || '<div class="empty">No recurring charges yet.</div>'}</div></div>
      </div>`;
  },

  async '/accounts'(params) {
    const days = Number(params.get('days') || 365);
    const [a, hist] = await Promise.all([api('/accounts'), api('/networth/history?days=' + days)]);
    const types = [['depository', 'Cash'], ['credit', 'Credit cards'], ['investment', 'Investments'], ['loan', 'Loans'], ['asset', 'Assets'], ['other', 'Other']];
    const first = hist[0]?.net_worth, last = hist.at(-1)?.net_worth;
    const delta = first != null ? last - first : null;
    const step = Math.max(1, Math.floor(hist.length / 6));
    const labels = hist.map((p, i) => (i % step === 0 || i === hist.length - 1 ? new Date(p.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: days <= 90 ? 'numeric' : undefined }) : ''));
    const el = h(`<div><div class="screen-head"><div><div class="label">Net worth</div><h1 class="amount-xl">${money(a.net_worth.total, { cents: false })}</h1>${delta != null ? `<p class="body-sm ${delta >= 0 ? 'pos' : 'neg'}">${money(delta, { sign: true, cents: false })} over ${days} days</p>` : ''}</div>
        <div class="actions"><div class="seg">${[30, 90, 365, 1095].map((d) => `<a href="#/accounts?days=${d}"><button class="${d === days ? 'active' : ''}">${d === 30 ? '1M' : d === 90 ? '3M' : d === 365 ? '1Y' : '3Y'}</button></a>`).join('')}</div><button class="btn primary" data-act="add-account">${I.plus}Add account</button></div></div>
      <div class="grid">
        <div class="card col-12">${lineChart([{ values: hist.map((p) => p.net_worth) }], { labels, height: 200 })}</div>
        ${!a.accounts.length ? `<div class="card col-12">${emptyState('No accounts yet. Add one to connect a bank directly, or sync from Copilot in Settings.', I.landmark)}</div>` : ''}
        ${types.map(([t, label]) => { const rows = a.accounts.filter((x) => x.type === t); if (!rows.length) return ''; const sum = rows.reduce((s, x) => s + x.balance, 0); const liab = t === 'credit' || t === 'loan'; return `<div class="card col-6"><div class="card-head"><h2 class="h2">${label}</h2><span class="amount ${liab ? 'neg' : ''}">${money(liab ? -sum : sum)}</span></div><div class="rows">${rows.map((x) => `<a class="row" href="#/transactions?accounts=${esc(x.id)}"><span class="disc">${t === 'credit' ? '💳' : t === 'investment' ? '📈' : t === 'loan' ? '🏦' : '🏛️'}</span><span class="main"><span class="name">${esc(x.name)}</span><span class="meta">${x.needs_attention ? '<span class="chip amber">Verification needed</span>' : ''}${esc(x.institution || '')}${x.mask ? ' ••' + esc(x.mask) : ''}${x.limit_amt ? ` · ${pct((x.balance / x.limit_amt) * 100)} of ${money(x.limit_amt, { cents: false })}` : ''}${x.source === 'manual' ? ' · Manual' : ''}</span></span><span class="amount ${liab ? 'neg' : ''}">${money(liab ? -x.balance : x.balance)}</span></a>`).join('')}</div></div>`; }).join('')}
      </div></div>`);
    el.querySelector('[data-act="add-account"]').addEventListener('click', () => openAddAccount());
    return el;
  },

  async '/investments'() {
    const hd = await api('/holdings');
    const gain = hd.holdings.reduce((s, x) => s + (x.gain ?? 0), 0);
    const basis = hd.holdings.reduce((s, x) => s + (x.cost_basis ?? 0), 0);
    return `<div class="screen-head"><div><div class="label">Portfolio</div><h1 class="amount-xl">${money(hd.total, { cents: false })}</h1><p class="body-sm ${gain >= 0 ? 'pos' : 'neg'}">${money(gain, { sign: true, cents: false })} unrealized${basis ? ` (${((gain / basis) * 100).toFixed(1)}%)` : ''}</p></div></div>
      <div class="card"><table class="t"><thead><tr><th>Holding</th><th>Account</th><th class="r">Qty</th><th class="r">Price</th><th class="r">Value</th><th class="r">Weight</th><th class="r">Gain</th></tr></thead><tbody>
      ${hd.holdings.map((x) => `<tr><td><strong>${esc(x.ticker || '')}</strong><div class="body-sm muted">${esc(x.name)}</div></td><td class="body-sm muted">${esc(x.account_name || '')}</td><td class="r amount">${x.quantity ?? '—'}</td><td class="r amount">${money(x.price)}</td><td class="r amount">${money(x.value)}</td><td class="r amount">${x.weight}%</td><td class="r amount ${x.gain > 0 ? 'pos' : x.gain < 0 ? 'neg' : ''}">${x.gain != null ? money(x.gain, { sign: true, cents: false }) : '—'}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">No holdings yet.</td></tr>'}
      </tbody></table></div>`;
  },

  async '/assistant'() {
    const conv = 'default';
    const history = await api('/chat/' + conv);
    const el = h(`<div class="chat">
      <div class="screen-head"><div></div><div class="actions"><button class="btn ghost" id="clear">New chat</button></div></div>
      <div class="log" id="log"></div>
      <div class="suggest" id="suggest">${['How am I doing this month?', 'What looks unusual?', 'Which budgets will I blow?', 'What subscriptions can I cut?', 'Review my unreviewed transactions'].map((s) => `<button class="btn">${s}</button>`).join('')}</div>
      <form class="composer" id="composer"><textarea class="input" id="msg" rows="1" placeholder="Ask about your money…"></textarea><button class="btn primary" type="submit">Send</button></form>
    </div>`);
    const log = $('#log', el);
    const addMsg = (role, text) => { const m = h(`<div class="msg ${role}"></div>`); if (role === 'assistant') m.innerHTML = md(text); else m.textContent = text; log.append(m); log.scrollTop = log.scrollHeight; return m; };
    for (const m of history) {
      if (typeof m.content === 'string') addMsg(m.role, m.content);
      else for (const b of m.content) { if (b.type === 'text' && b.text.trim()) addMsg(m.role, b.text); else if (b.type === 'tool_use') log.append(h(`<div class="toolcall">⚙ ${esc(b.name)}</div>`)); }
    }
    log.scrollTop = log.scrollHeight;
    async function send(text) {
      if (!text.trim()) return;
      $('#suggest', el).style.display = 'none';
      addMsg('user', text);
      $('#msg', el).value = '';
      let cur = null, buf = '';
      const res = await fetch('/api/assistant', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ conversation_id: conv, message: text }) });
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let carry = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        carry += dec.decode(value, { stream: true });
        const parts = carry.split('\n\n'); carry = parts.pop();
        for (const p of parts) {
          if (!p.startsWith('data: ')) continue;
          const ev = JSON.parse(p.slice(6));
          if (ev.type === 'text') { if (!cur) { cur = addMsg('assistant', ''); buf = ''; } buf += ev.text; cur.innerHTML = md(buf); log.scrollTop = log.scrollHeight; }
          else if (ev.type === 'tool') { cur = null; log.append(h(`<div class="toolcall">⚙ ${esc(ev.name)} ${esc(JSON.stringify(ev.input))}</div>`)); log.scrollTop = log.scrollHeight; }
          else if (ev.type === 'error') { addMsg('assistant', '⚠ ' + ev.message); }
        }
      }
      refreshChrome();
    }
    $('#composer', el).addEventListener('submit', (e) => { e.preventDefault(); send($('#msg', el).value); });
    $('#msg', el).addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(e.target.value); } });
    el.querySelectorAll('#suggest button').forEach((b) => b.addEventListener('click', () => send(b.textContent)));
    $('#clear', el).addEventListener('click', async () => { await api('/chat/' + conv, { method: 'DELETE' }); log.innerHTML = ''; $('#suggest', el).style.display = ''; });
    return el;
  },

  async '/settings'() {
    const s = await api('/status');
    const origin = location.origin;
    const theme = document.documentElement.dataset.theme;
    const el = h(`<div>
      <div class="screen-head"><h2 class="h2">Settings</h2><button class="k-btn k-btn--icon" data-act="close-sheet" aria-label="Close">${I.x}</button></div>
      <div class="grid">
        <div class="card col-6"><div class="card-head"><h2 class="h2">Data</h2><button class="btn primary" id="sync">Sync now</button></div>
          <dl class="kv"><dt>Last sync</dt><dd>${s.last_sync ? new Date(s.last_sync).toLocaleString() : 'never'}</dd><dt>Copilot</dt><dd>${s.copilot.enabled ? esc(s.copilot.command + ' ' + s.copilot.args.join(' ')) : 'off (KEEL_COPILOT=off)'}</dd>${s.copilot.enabled ? `<dt>Mode</dt><dd>${s.copilot.write ? 'live + write-through' : s.copilot.live ? 'live reads' : 'local cache (offline)'}</dd><dt>Queued writes</dt><dd>${s.queued_writes}</dd>` : ''}<dt>Bank connections</dt><dd>${s.connections.total}${s.connections.needs_attention ? ` (${s.connections.needs_attention} need attention)` : ''}</dd>${Object.entries(s.counts).map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
          ${s.last_sync_report?.warnings?.length ? `<p class="body-sm warn" style="margin-top:12px">${s.last_sync_report.warnings.map(esc).join('<br>')}</p>` : ''}
          <div style="margin-top:16px"><label class="label">Import Copilot CSV export</label><input type="file" id="csv" accept=".csv,text/csv" class="input" style="margin-top:6px"></div></div>
        <div class="card col-6"><div class="card-head"><h2 class="h2">Assistant</h2><span class="chip ${s.assistant.configured ? 'brand' : 'amber'}">${s.assistant.configured ? 'ready' : 'no API key'}</span></div>
          <dl class="kv"><dt>Model</dt><dd>${esc(s.assistant.model)}</dd><dt>Tools</dt><dd>${s.mcp.tools.length}</dd></dl>
          <p class="body-sm muted" style="margin-top:12px">Set <code>ANTHROPIC_API_KEY</code> in <code>.env</code> and restart to enable the in-app assistant.</p>
          <div class="toggle" style="margin-top:12px"><span>Light theme</span><button class="switch ${theme === 'light' ? 'on' : ''}" id="theme" aria-label="Toggle theme"></button></div></div>
        <div class="card col-12"><div class="card-head"><h2 class="h2">Connect Claude to Daybook (MCP)</h2></div>
          <p class="body-sm muted">Daybook serves the same ${s.mcp.tools.length} tools over MCP, so Claude Desktop, Claude Code and claude.ai can read and edit your finances.</p>
          <p class="label" style="margin-top:12px">Claude Code</p><pre class="code">claude mcp add --transport http daybook ${origin}/mcp</pre>
          <p class="label">Claude Desktop (claude_desktop_config.json)</p><pre class="code">{ "mcpServers": { "daybook": { "command": "npm", "args": ["--prefix", "/path/to/keel", "run", "-s", "mcp"] } } }</pre>
          <p class="label">claude.ai custom connector</p><pre class="code">Expose ${origin}/mcp over HTTPS (e.g. <code>tailscale funnel 4242</code> or <code>ngrok http 4242</code>), set KEEL_TOKEN in .env, then add the URL under Settings → Connectors with header Authorization: Bearer &lt;token&gt;.</pre>
          <p class="label">Tools</p><p class="mono-sm muted">${s.mcp.tools.map(esc).join(' · ')}</p></div>
      </div></div>`);
    $('#sync', el).addEventListener('click', async (e) => { e.target.disabled = true; e.target.textContent = 'Syncing…'; try { const r = await api('/sync', { method: 'POST' }); toast(`Synced: ${Object.entries(r.counts).map(([k, v]) => `${v} ${k}`).join(', ') || 'nothing new'}`); if (r.warnings.length) alert('Sync warnings:\n' + r.warnings.join('\n')); e.target.disabled = false; e.target.textContent = 'Sync now'; refreshChrome(); navigate(); } catch (err) { alert('Sync failed: ' + err.message); e.target.disabled = false; e.target.textContent = 'Sync now'; } });
    try { $('.grid', el).prepend(await connectionsCard()); } catch (err) { $('.grid', el).prepend(h(`<div class="card col-12"><p class="body-sm warn">Bank connections: ${esc(err.message)}</p></div>`)); }
    $('#csv', el).addEventListener('change', async (e) => { const f = e.target.files[0]; if (!f) return; const fd = new FormData(); fd.append('file', f); try { const r = await api('/import/csv', { method: 'POST', body: fd, headers: {} }); toast(`Imported ${r.imported} rows (${r.skipped} skipped)`); refreshChrome(); navigate(); } catch (err) { alert('Import failed: ' + err.message); } });
    $('#theme', el).addEventListener('click', (e) => { const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'; document.documentElement.dataset.theme = next; store.set('keel-theme', next); e.target.classList.toggle('on', next === 'light'); });
    return el;
  },
};


// Stand-ins until their specs are built (docs/screens/cashflow.md, goals.md).
screens['/cashflow'] = async () => {
  const trend = await api('/spending/trend?months=12');
  return `<div class="grid"><div class="card col-12"><div class="card-head"><h2 class="h2">Income vs spend</h2><span class="body-sm muted">last 12 months</span></div>${barChart(trend)}
    <div class="legend"><span><i style="background:var(--brand)"></i>Income</span><span><i style="background:var(--spend)"></i>Spend</span></div></div></div>`;
};
screens['/goals'] = async () => {
  const goals = await api('/goals');
  if (!goals.length) return emptyState('Your goals will appear here after you create them.', I.flag);
  return `<div class="grid">${goals.map((g) => { const p = g.target ? (g.current / g.target) * 100 : 0; return `<div class="card col-6"><div class="budget"><div class="top"><span class="name">${esc(g.name)}</span><span class="body-sm muted"><span class="amount">${money(g.current, { cents: false })}</span> of <span class="amount">${money(g.target, { cents: false })}</span> · ${pct(p)}</span></div><div class="bar"><i style="width:${Math.min(100, p)}%"></i></div></div></div>`; }).join('')}</div>`;
};

// ---------- sheets ----------
function openBudgetSheet(item, cats) {
  const s = sheet(`<div class="form">
    <h2 class="h1">${item ? esc(item.name) : 'New budget'}</h2>
    ${item ? '' : `<div class="field"><label>Category</label><select class="input" id="b-cat">${cats.map((c) => `<option value="${esc(c.id)}">${c.parent_id ? '— ' : ''}${c.emoji ? esc(c.emoji) + ' ' : ''}${esc(c.name)}</option>`).join('')}</select></div>`}
    <div class="field"><label>Monthly budget</label><input class="input amount" id="b-amt" type="number" min="0" step="1" value="${item ? item.budget : ''}" placeholder="0"></div>
    ${item ? `<p class="body-sm muted">Spent ${money(item.spent)} this month. Set to 0 to remove the budget.</p>` : ''}
    <div class="foot"><button class="btn" data-act="close-sheet">Cancel</button><button class="btn primary" id="save">Save</button></div></div>`, { label: 'Budget' });
  const root = s.el;
  $('#save', root).addEventListener('click', async () => {
    const catId = item ? item.category_id : $('#b-cat', root).value;
    const amount = Number($('#b-amt', root).value || 0);
    try { const r = await api('/budgets/' + encodeURIComponent(catId), { method: 'PUT', body: { amount } }); toast(r.copilot?.pushed ? 'Budget saved and pushed to Copilot' : 'Budget saved locally'); s.close(); navigate(); } catch (e) { alert(e.message); }
  });
}

// ---------- markdown-lite for assistant replies ----------
function md(text) {
  const lines = esc(text).split('\n');
  let out = '', inTable = false, inList = false;
  const inline = (s) => s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>').replace(/(?<!\*)\*(?!\*)([^*]+)\*(?!\*)/g, '<em>$1</em>');
  for (const l of lines) {
    if (/^\s*\|/.test(l)) { if (/^\s*\|[\s:-]+\|/.test(l)) continue; const cells = l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()); if (!inTable) { out += '<table>'; inTable = true; out += '<tr>' + cells.map((c) => `<th>${inline(c)}</th>`).join('') + '</tr>'; } else out += '<tr>' + cells.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>'; continue; }
    if (inTable) { out += '</table>'; inTable = false; }
    if (/^\s*[-*•]\s+/.test(l)) { if (!inList) { out += '<ul style="margin:4px 0 8px 18px;padding:0">'; inList = true; } out += `<li>${inline(l.replace(/^\s*[-*•]\s+/, ''))}</li>`; continue; }
    if (inList) { out += '</ul>'; inList = false; }
    if (/^#{1,3}\s/.test(l)) { out += `<p><strong>${inline(l.replace(/^#+\s/, ''))}</strong></p>`; continue; }
    if (l.trim() === '') continue;
    out += `<p>${inline(l)}</p>`;
  }
  if (inTable) out += '</table>'; if (inList) out += '</ul>';
  return out;
}

