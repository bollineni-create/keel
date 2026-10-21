// Bank connections: the Settings card, the "Add account" sheet, Plaid Link and SimpleFIN setup tokens.
// Server side: src/sync/{plaid,simplefin,connections}.ts; routes under /api/connections.
import { $, h, esc, ago, api, toast, sheet, menu, iconBtn, I } from './lib.js';

const PLAID_JS = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
const SIMPLEFIN_URL = 'https://beta-bridge.simplefin.org/';
let onChange = () => {};
/** Called after anything that changes accounts (refreshes the sidebar and the current screen). */
export function bindConnections(fn) { onChange = fn; }

const statusChip = (c) => c.status === 'ok' ? '<span class="chip brand">Connected</span>'
  : c.status === 'syncing' ? '<span class="chip">Syncing…</span>'
  : c.status === 'needs_reauth' ? '<span class="chip amber">Verification needed</span>'
  : '<span class="chip amber">Error</span>';
const providerLabel = (p) => (p === 'plaid' ? 'Plaid' : p === 'simplefin' ? 'SimpleFIN' : p);

function summarize(r) {
  const s = r?.sync;
  if (!s) return 'Connected';
  if (s.error) return s.error;
  const c = s.counts || {};
  return `Connected: ${c.accounts ?? 0} accounts, ${c.transactions ?? 0} transactions${c.categorized ? `, ${c.categorized} categorized from your history` : ''}`;
}

// ---------- Plaid Link ----------
function loadPlaid() {
  if (window.Plaid) return Promise.resolve(window.Plaid);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = PLAID_JS;
    s.onload = () => resolve(window.Plaid);
    s.onerror = () => reject(new Error('Couldn’t load Plaid Link (offline, or blocked by the browser).'));
    document.head.append(s);
  });
}

/** Open Plaid Link: new connection, or update mode to repair `connectionId`. */
export async function startPlaidLink(connectionId) {
  const [Plaid, lt] = await Promise.all([loadPlaid(), api('/connections/plaid/link-token', { method: 'POST', body: connectionId ? { connection_id: connectionId } : {} })]);
  return new Promise((resolve) => {
    const handler = Plaid.create({
      token: lt.link_token,
      onSuccess: async (publicToken, metadata) => {
        try {
          toast(connectionId ? 'Fixed. Syncing…' : 'Linked. Pulling your accounts… (this can take a minute)');
          const r = connectionId
            ? await api(`/connections/${encodeURIComponent(connectionId)}/repaired`, { method: 'POST' })
            : await api('/connections/plaid/exchange', { method: 'POST', body: { public_token: publicToken, institution: metadata?.institution ? { name: metadata.institution.name, institution_id: metadata.institution.institution_id } : undefined } });
          if (r.duplicate_of) toast('You already had this bank connected. Remove the older connection so it doesn’t use up another Plaid slot.');
          else toast(summarize(r));
          resolve(r);
        } catch (e) { alert(`Plaid: ${e.message}`); resolve(null); }
      },
      onExit: (err) => { if (err) toast(`Plaid: ${err.display_message || err.error_message || err.error_code}`); resolve(null); },
    });
    handler.open();
  });
}

// ---------- SimpleFIN ----------
function openSimplefinSheet(after) {
  const s = sheet(`<div class="form">
    <header class="form__head"><h2 class="h2">Connect with SimpleFIN</h2>${iconBtn(I.x, 'Close', 'data-act="close-sheet"')}</header>
    <ol class="body-sm muted steps">
      <li>Open the <a class="link" href="${SIMPLEFIN_URL}" target="_blank" rel="noopener">SimpleFIN Bridge</a> ($15/year, up to 25 banks), sign up and connect your banks there.</li>
      <li>Under <strong>Apps</strong>, choose <strong>New connection</strong> and copy the Setup Token.</li>
      <li>Paste it here. Daybook uses it once, then keeps an encrypted access key on this Mac.</li>
    </ol>
    <div class="field"><label for="sf-token">Setup Token</label><textarea class="input" id="sf-token" rows="3" spellcheck="false" autocomplete="off" placeholder="aHR0cHM6Ly9…"></textarea></div>
    <p class="body-sm muted">SimpleFIN refreshes about once a day and sends about 90 days of history. Banks it can’t reach need you to sign in again on the Bridge site.</p>
    <div class="foot"><button class="btn" data-act="close-sheet">Cancel</button><button class="btn primary" id="sf-go">Connect</button></div></div>`, { label: 'SimpleFIN' });
  $('#sf-go', s.el).addEventListener('click', async (e) => {
    const token = $('#sf-token', s.el).value.trim();
    if (!token) return;
    e.target.disabled = true; e.target.textContent = 'Connecting…';
    try {
      const r = await api('/connections/simplefin', { method: 'POST', body: { setup_token: token } });
      toast(summarize(r)); s.close(); after();
    } catch (err) { alert(err.message); e.target.disabled = false; e.target.textContent = 'Connect'; }
  });
}

// ---------- add-account sheet (Accounts "+") ----------
/** `after` runs once a connection was added (defaults to refreshing the sidebar and screen). */
export async function openAddAccount(after = onChange) {
  const st = await api('/status').catch(() => ({}));
  const plaidReady = st.plaid?.configured;
  const s = sheet(`<div class="form">
    <header class="form__head"><h2 class="h2">Add an account</h2>${iconBtn(I.x, 'Close', 'data-act="close-sheet"')}</header>
    <div class="rows">
      <button class="row" data-add="plaid" ${plaidReady ? '' : 'disabled'}><span class="disc">🏦</span><span class="main"><span class="name">Connect a bank with Plaid</span><span class="meta">${plaidReady ? `Banks, cards, loans, investments${st.plaid.env === 'production' ? '' : ' · test banks (sandbox)'}` : 'Add PLAID_CLIENT_ID and PLAID_SECRET to .env first'}</span></span><span>${I.forward}</span></button>
      <button class="row" data-add="simplefin"><span class="disc">🔑</span><span class="main"><span class="name">Connect with SimpleFIN</span><span class="meta">Paste a Setup Token from the SimpleFIN Bridge</span></span><span>${I.forward}</span></button>
      <button class="row" data-add="csv"><span class="disc">📄</span><span class="main"><span class="name">Import a CSV</span><span class="meta">Copilot’s transaction export</span></span><span>${I.forward}</span></button>
    </div>
    ${plaidReady ? '' : `<p class="body-sm muted">Plaid’s free Trial plan covers up to 10 bank logins for life: sign up at dashboard.plaid.com, apply for Trial, and put the Production keys in <code>.env</code> with <code>PLAID_ENV=production</code>. Each real link uses a slot even if you remove it later, so try the flow with <code>PLAID_ENV=sandbox</code> first.</p>`}
    ${st.auth && !st.auth.token && !st.auth.local ? '<p class="body-sm warn">Connecting banks works from Daybook on your Mac, or from any device once KEEL_TOKEN is set.</p>' : ''}
  </div>`, { label: 'Add an account' });
  s.el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-add]');
    if (!b || b.disabled) return;
    s.close();
    if (b.dataset.add === 'plaid') startPlaidLink().then((r) => r && after()).catch((err) => alert(err.message));
    else if (b.dataset.add === 'simplefin') openSimplefinSheet(after);
    else location.hash = '#/settings';
  });
}

// ---------- Settings card ----------
export async function connectionsCard() {
  const { connections, providers } = await api('/connections');
  const el = h(`<div class="card col-12" id="connections">
    <div class="card-head"><h2 class="h2">Bank connections</h2><div class="actions"><button class="btn primary" data-act="add">${I.plus}Add account</button></div></div>
    ${connections.length ? '' : `<p class="body-sm muted">Connect banks directly with <strong>Plaid</strong> (the network Copilot mostly uses; free for up to 10 logins on its Trial plan) or <strong>SimpleFIN</strong> ($15/year). ${providers.copilot.enabled ? 'Copilot keeps syncing alongside; switch an account over when it shows up twice.' : ''}</p>`}
    <div class="rows">${connections.map((c) => `<div class="row conn" data-id="${esc(c.id)}">
      <span class="disc">${c.provider === 'plaid' ? '🏦' : '🔑'}</span>
      <span class="main"><span class="name">${esc(c.institution || providerLabel(c.provider))} ${statusChip(c)}</span>
        <span class="meta">${providerLabel(c.provider)} · ${c.accounts.length} account${c.accounts.length === 1 ? '' : 's'} · synced ${ago(c.last_synced)}${c.consent_expires_at ? ` · consent ends ${esc(new Date(c.consent_expires_at).toLocaleDateString())}` : ''}</span>
        ${c.error && c.status !== 'ok' ? `<span class="body-sm warn conn__error">${esc(c.error)}</span>` : ''}
        ${c.duplicates.map((x) => `<span class="body-sm conn__dup">Also from Copilot: ${esc(x.copilot_account_name)} ••${esc(x.mask)} <button class="btn ghost" data-switch="${esc(x.account_id)}" data-copilot="${esc(x.copilot_account_id)}">Use this connection from today</button></span>`).join('')}</span>
      <span class="actions">${c.status === 'needs_reauth' ? '<button class="btn primary" data-act="fix">Fix connection</button>' : '<button class="btn" data-act="sync">Sync</button>'}${iconBtn(I.more, 'More', 'data-act="more"')}</span>
    </div>`).join('')}</div></div>`);
  // After any change: refresh this card in place, plus the sidebar and the screen behind the sheet.
  const done = async () => { onChange(); try { el.replaceWith(await connectionsCard()); } catch {} };
  el.addEventListener('click', async (e) => {
    if (e.target.closest('[data-act="add"]')) return openAddAccount(done);
    const sw = e.target.closest('[data-switch]');
    if (sw) {
      if (!confirm('From today this account’s transactions and balance come from the bank connection, and the Copilot copy is hidden. Copilot keeps the history before today. Continue?')) return;
      try { await api(`/accounts/${encodeURIComponent(sw.dataset.switch)}/switch`, { method: 'POST', body: { copilot_account_id: sw.dataset.copilot } }); toast('Switched. No more double counting.'); done(); } catch (err) { alert(err.message); }
      return;
    }
    const row = e.target.closest('.conn');
    if (!row) return;
    const id = row.dataset.id;
    const c = connections.find((x) => x.id === id);
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'sync') syncOne(id, e.target.closest('button')).then(done);
    else if (act === 'fix') fix(c).then(done);
    else if (act === 'more') menu(e.target.closest('button'), [
      { label: 'Sync now', run: () => syncOne(id).then(done) },
      { label: 'Fix connection', run: () => fix(c).then(done) },
      '-',
      { label: 'Disconnect, keep history', run: () => remove(c, false).then(done) },
      { label: 'Disconnect and delete its data', danger: true, run: () => remove(c, true).then(done) },
    ], { align: 'end' });
  });
  return el;
}

async function syncOne(id, btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Syncing…'; }
  try {
    const r = await api(`/connections/${encodeURIComponent(id)}/sync`, { method: 'POST' });
    const c = r.connections?.[0];
    toast(c?.skipped ? `Not yet: ${c.skipped}` : c?.error ? c.error : `Synced ${c?.counts?.transactions ?? 0} transactions`);
  } catch (e) { alert(e.message); }
}

async function fix(c) {
  if (c.provider === 'plaid') return startPlaidLink(c.id).catch((e) => alert(e.message));
  window.open(SIMPLEFIN_URL, '_blank', 'noopener');
  if (confirm('Sign in to the bank again on the SimpleFIN Bridge, then come back here and press OK to sync.')) {
    await api(`/connections/${encodeURIComponent(c.id)}/repaired`, { method: 'POST' }).then((r) => toast(summarize(r))).catch((e) => alert(e.message));
  }
}

async function remove(c, deleteData) {
  const what = deleteData ? 'and delete its accounts and transactions from Daybook' : '(its accounts stay in Daybook as manual accounts)';
  const extra = c.provider === 'plaid' ? ' Plaid’s free Trial doesn’t give the slot back.' : '';
  if (!confirm(`Disconnect ${c.institution || providerLabel(c.provider)} ${what}?${extra}`)) return;
  try { const r = await api(`/connections/${encodeURIComponent(c.id)}${deleteData ? '?delete_data=1' : ''}`, { method: 'DELETE' }); r.warning ? alert(r.warning) : toast('Disconnected'); } catch (e) { alert(e.message); }
}
