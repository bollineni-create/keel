// Direct bank connections end to end against mocked Plaid and SimpleFIN APIs: npm test
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keel-test-'));
process.env.KEEL_DB = path.join(dir, 'keel.db');
process.env.KEEL_SECRET_KEY = 'a'.repeat(64);
process.env.KEEL_COPILOT = 'off';
process.env.PLAID_CLIENT_ID = 'test-client';
process.env.PLAID_SECRET = 'test-secret';
process.env.PLAID_ENV = 'sandbox';

type Mod = Record<string, any>;
let db: Mod, conns: Mod, enrich: Mod, plaid: Mod, sfin: Mod, sync: Mod, tools: Mod, secrets: Mod, q: Mod;

before(async () => {
  db = await import('../src/db.js');
  conns = await import('../src/sync/connections.js');
  enrich = await import('../src/sync/enrich.js');
  plaid = await import('../src/sync/plaid.js');
  sfin = await import('../src/sync/simplefin.js');
  sync = await import('../src/sync/index.js');
  tools = await import('../src/tools.js');
  secrets = await import('../src/sync/secrets.js');
  q = await import('../src/queries.js');
  db.getDb();
});

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const tx = (id: string) => db.getDb().prepare('SELECT * FROM transactions WHERE id = ?').get(id) as any;

test('secrets: round trip, tamper detection, redaction', () => {
  const sealed = secrets.encrypt('https://user:pass@bridge.example/simplefin');
  assert.ok(!sealed.includes('pass'));
  assert.equal(secrets.decrypt(sealed), 'https://user:pass@bridge.example/simplefin');
  const parts = sealed.split(':');
  parts[3] = Buffer.from('nope').toString('base64');
  assert.throws(() => secrets.decrypt(parts.join(':')));
  assert.equal(secrets.redact('GET https://abc:def@beta-bridge.simplefin.org/x failed'), 'GET https://***:***@beta-bridge.simplefin.org/x failed');
  assert.match(secrets.redact('token access-sandbox-1234abcd-5678'), /access-sandbox-\*\*\*/);
});

test('upsert: preserveEdited keeps Keel edits, insertOnly writes once', () => {
  const row = (name: string, category_id: string | null) => ({ id: 'u1', date: '2026-10-01', name, amount: 5, category_id, source: 'copilot' });
  db.upsert('transactions', [row('A', 'c1')], ['id'], { preserveEdited: true });
  db.markEdited('transactions', 'u1', ['category_id']);
  db.getDb().prepare(`UPDATE transactions SET category_id = 'mine' WHERE id = 'u1'`).run();
  db.upsert('transactions', [row('B', 'c2')], ['id'], { preserveEdited: true });
  assert.equal(tx('u1').name, 'B');
  assert.equal(tx('u1').category_id, 'mine');
  db.upsert('transactions', [row('C', 'c3')], ['id'], { insertOnly: ['category_id', 'name'] });
  assert.equal(tx('u1').name, 'B');
  db.getDb().prepare(`DELETE FROM transactions WHERE id = 'u1'`).run();
});

test('simplefin: windows never exceed 45 days', () => {
  const now = new Date('2026-10-21T12:00:00Z');
  const w = sfin.windows(null, now);
  assert.ok(w.length >= 3);
  for (const [s, e] of w) assert.ok((Date.parse(e) - Date.parse(s)) / 86400000 <= 45, `${s}..${e}`);
  assert.equal(w[0][0], '2026-07-23');
  assert.deepEqual(sfin.windows('2026-10-20T00:00:00Z', now), [['2026-10-13', '2026-10-22']]);
});

test('simplefin: type guesses', () => {
  assert.equal(sfin.guessType('Sapphire Preferred ...4321', 'Chase', -120), 'credit');
  assert.equal(sfin.guessType('Total Checking', 'Chase', 900), 'depository');
  assert.equal(sfin.guessType('Roth IRA', 'Fidelity', 9000), 'investment');
  assert.equal(sfin.guessType('Auto Loan', 'Capital One', -9000), 'loan');
  assert.equal(sfin.guessType('Everyday', 'Some CU', -40), 'credit');
});

let sfinId = '';
test('simplefin: claim, first sync, sign flip, ids, liabilities, partial failure', async () => {
  const claimUrl = 'https://bridge.example/simplefin/claim/abc';
  const access = 'https://u%40x:p%3Ass@bridge.example/simplefin';
  const calls: string[] = [];
  const now = Math.floor(Date.now() / 1000);
  sfin._setSimplefinFetch(async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    if (url === claimUrl) return new Response(access, { status: 200 });
    assert.ok(!url.includes('@'), 'credentials must not be in the URL');
    assert.equal((init?.headers as any).authorization, 'Basic ' + Buffer.from('u@x:p:ss').toString('base64'));
    assert.equal(init?.redirect, 'manual');
    const qs = new URL(url).searchParams;
    assert.equal(qs.get('version'), '2');
    return json({
      errlist: [{ code: 'con.auth', msg: 'Bad login', conn_id: 'CON-2' }, { code: 'gen.api', msg: 'range warning' }],
      connections: [{ conn_id: 'CON-1', name: 'First Bank' }, { conn_id: 'CON-2', name: 'Card Co' }],
      accounts: [
        { id: 'ACT-1', name: 'Checking 1234', conn_id: 'CON-1', currency: 'USD', balance: '1500.25', 'available-balance': '1400.00', 'balance-date': now,
          transactions: [
            { id: 'T1', posted: now - 86400, amount: '-42.50', description: 'POS DEBIT  TRADER JOES #12', payee: "Trader Joe's", pending: false },
            { id: 'T2', posted: now - 2 * 86400, amount: '2500.00', description: 'ACME PAYROLL', pending: false },
            { id: 'T3', posted: 0, transacted_at: now, amount: '-9.99', description: 'NETFLIX', pending: true },
          ] },
        { id: 'ACT-1', name: 'Visa Card ...9876', conn_id: 'CON-2', currency: 'USD', balance: '-320.10', 'balance-date': now, transactions: [] },
      ],
    });
  });
  const token = Buffer.from(claimUrl).toString('base64');
  const r = await tools.runTool('add_simplefin_connection', { setup_token: token });
  sfinId = r.connection.id;
  assert.equal(calls[0], `POST ${claimUrl}`);
  assert.equal(r.sync.status, 'needs_reauth');
  assert.match(r.sync.error, /Card Co/);
  const accounts = db.getDb().prepare('SELECT * FROM accounts WHERE connection_id = ? ORDER BY name').all(sfinId) as any[];
  assert.equal(accounts.length, 2, 'same SimpleFIN account id under two connections stays two accounts');
  const checking = accounts.find((a) => a.name.startsWith('Checking'));
  const card = accounts.find((a) => a.name.startsWith('Visa'));
  assert.equal(checking.type, 'depository');
  assert.equal(checking.mask, '1234');
  assert.equal(card.type, 'credit');
  assert.equal(card.balance, 320.1, 'liability stored as positive amount owed');
  assert.equal(card.needs_attention, 1);
  const tj = tx(`${checking.id}:T1`);
  assert.equal(tj.amount, 42.5, 'SimpleFIN deposit-positive flipped to Keel spend-positive');
  assert.equal(tj.name, "Trader Joe's");
  assert.equal(tj.source, 'simplefin');
  assert.equal(tx(`${checking.id}:T2`).amount, -2500);
  assert.equal(tx(`${checking.id}:T2`).income, 1);
  assert.equal(tx(`${checking.id}:T3`).pending, 1);
  // stored secret is sealed
  const raw = db.getDb().prepare('SELECT secret FROM connections WHERE id = ?').get(sfinId) as any;
  assert.ok(!raw.secret.includes('bridge.example'));
  // today's balance, walked back through the transactions: +42.50 spent yesterday, −2,500 paid in the day before
  const hist = db.getDb().prepare('SELECT date, balance FROM balance_history WHERE account_id = ? ORDER BY date').all(checking.id) as any[];
  assert.equal(hist.at(-1).balance, 1500.25);
  assert.deepEqual(hist.slice(0, 3).map((h) => h.balance), [-957.25, 1542.75, 1500.25]);
  // public view carries no secret
  assert.ok(!JSON.stringify(conns.listConnections()).includes('secret'));
});

test('simplefin: pending rows that re-post under a new id are dropped; edits survive; quota floor', async () => {
  const d = db.getDb();
  const checking = (d.prepare(`SELECT id FROM accounts WHERE connection_id = ? AND name LIKE 'Checking%'`).get(sfinId) as any).id;
  await tools.runTool('update_transaction', { transaction_id: `${checking}:T1`, note: 'weekly shop' });
  assert.equal((d.prepare('SELECT COUNT(*) n FROM pending_writes').get() as any).n, 0, 'bank rows are never queued for Copilot');
  const now = Math.floor(Date.now() / 1000);
  sfin._setSimplefinFetch(async () => json({
    errlist: [], connections: [{ conn_id: 'CON-1', name: 'First Bank' }, { conn_id: 'CON-2', name: 'Card Co' }],
    accounts: [{ id: 'ACT-1', name: 'Checking 1234', conn_id: 'CON-1', currency: 'USD', balance: '1490.26', 'balance-date': now,
      transactions: [
        { id: 'T1', posted: now - 86400, amount: '-42.50', description: 'POS DEBIT TRADER JOES #12', payee: "Trader Joe's" },
        { id: 'T3b', posted: now, amount: '-9.99', description: 'NETFLIX.COM' },
      ] }],
  }));
  // a manual sync within 30 minutes is refused by the provider floor
  const early = await sync.syncAll({ connection_id: sfinId, force: true });
  assert.match(early.connections[0].skipped, /every 30 min/);
  d.prepare('UPDATE connections SET last_attempt = ? WHERE id = ?').run(new Date(Date.now() - 3600e3).toISOString(), sfinId);
  const r = await sync.syncAll({ connection_id: sfinId, force: true });
  assert.equal(r.connections[0].status, 'ok', 'errlist clean → connection ok again');
  assert.equal(tx(`${checking}:T3`), undefined, 'stale pending row removed');
  assert.equal(tx(`${checking}:T3b`).amount, 9.99);
  assert.equal(tx(`${checking}:T1`).note, 'weekly shop');
  assert.equal(JSON.parse(tx(`${checking}:T1`).local_edits).note, 1);
});

test('simplefin: 403 marks the connection for a new token', async () => {
  db.getDb().prepare('UPDATE connections SET last_attempt = NULL WHERE id = ?').run(sfinId);
  sfin._setSimplefinFetch(async () => new Response('', { status: 403 }));
  const r = await sync.syncAll({ connection_id: sfinId, force: true });
  assert.equal(r.connections[0].status, 'needs_reauth');
  assert.equal(conns.getConnection(sfinId).status, 'needs_reauth');
  assert.ok(!r.connections[0].error.includes('p:ss'));
});

let plaidId = '';
test('plaid: link token, exchange, sync with pagination restart, pending→posted, holdings', async () => {
  const seen: Array<{ path: string; body: any }> = [];
  let syncCalls = 0;
  plaid._setPlaidFetch(async (url: string, init?: RequestInit) => {
    const p = new URL(url).pathname;
    const body = JSON.parse(String(init?.body ?? '{}'));
    seen.push({ path: p, body });
    assert.equal((init?.headers as any)['PLAID-SECRET'], 'test-secret');
    assert.ok(url.startsWith('https://sandbox.plaid.com/'));
    switch (p) {
      case '/link/token/create': return json({ link_token: 'link-sandbox-abc', expiration: '2026-10-21T13:00:00Z' });
      case '/item/public_token/exchange': return json({ access_token: 'access-sandbox-11111111-2222', item_id: 'item1' });
      case '/accounts/get': return json({
        item: { institution_id: 'ins_1', consent_expiration_time: null },
        accounts: [
          { account_id: 'chk', name: 'Plaid Checking', mask: '0000', type: 'depository', subtype: 'checking', balances: { current: 110, available: 100, iso_currency_code: 'USD' } },
          { account_id: 'cc', name: 'Plaid Credit Card', mask: '3333', type: 'credit', subtype: 'credit card', balances: { current: 410, limit: 2000, iso_currency_code: 'USD' } },
          { account_id: 'inv', name: 'Plaid IRA', mask: '5555', type: 'investment', subtype: 'ira', balances: { current: 3200 } },
        ],
      });
      case '/transactions/sync': {
        syncCalls++;
        if (syncCalls === 1) return json({ added: [{ transaction_id: 'x', account_id: 'chk', amount: 1, date: '2026-10-01' }], modified: [], removed: [], next_cursor: 'p1', has_more: true });
        if (syncCalls === 2) return json({ error_code: 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION', error_type: 'TRANSACTIONS_ERROR', error_message: 'retry' }, 400);
        if (syncCalls === 3) return json({ added: [
          { transaction_id: 'p-pend', account_id: 'cc', amount: 25.5, date: '2026-10-18', name: 'STARBUCKS', merchant_name: 'Starbucks', pending: true, personal_finance_category: { primary: 'FOOD_AND_DRINK', detailed: 'FOOD_AND_DRINK_COFFEE' } },
          { transaction_id: 'pay', account_id: 'cc', amount: -300, date: '2026-10-15', name: 'PAYMENT THANK YOU', pending: false, personal_finance_category: { primary: 'LOAN_PAYMENTS', detailed: 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT' } },
          { transaction_id: 'sal', account_id: 'chk', amount: -2000, date: '2026-10-15', name: 'ACME PAYROLL', pending: false, personal_finance_category: { primary: 'INCOME', detailed: 'INCOME_WAGES' } },
        ], modified: [], removed: [], next_cursor: 'c1', has_more: false });
        assert.equal(body.cursor, 'c1');
        return json({ added: [
          { transaction_id: 'p-post', pending_transaction_id: 'p-pend', account_id: 'cc', amount: 26.1, date: '2026-10-19', name: 'STARBUCKS', merchant_name: 'Starbucks', pending: false, personal_finance_category: { primary: 'FOOD_AND_DRINK', detailed: 'FOOD_AND_DRINK_COFFEE' } },
        ], modified: [], removed: [{ transaction_id: 'p-pend', account_id: 'cc' }], next_cursor: 'c2', has_more: false });
      }
      case '/investments/holdings/get': return json({ holdings: [{ account_id: 'inv', security_id: 's1', quantity: 10, institution_price: 320, institution_value: 3200, cost_basis: 2500 }], securities: [{ security_id: 's1', ticker_symbol: 'VTI', name: 'Vanguard Total Stock Market' }] });
      case '/institutions/get_by_id': return json({ institution: { name: 'Should not be needed' } });
      default: throw new Error(`unexpected ${p}`);
    }
  });
  const lt = await tools.runTool('plaid_create_link_token', {});
  assert.equal(lt.link_token, 'link-sandbox-abc');
  const create = seen.find((s) => s.path === '/link/token/create')!.body;
  assert.deepEqual(create.products, ['transactions']);
  assert.equal(create.transactions.days_requested, 730);
  const r = await tools.runTool('plaid_exchange_public_token', { public_token: 'public-sandbox-xyz', institution: { name: 'First Platypus Bank', institution_id: 'ins_1' } });
  plaidId = r.connection.id;
  assert.equal(r.sync.status, 'ok', JSON.stringify(r.sync));
  assert.equal(r.connection.institution, 'First Platypus Bank');
  assert.equal(tx('plaid:x'), undefined, 'first attempt discarded after the pagination restart');
  const coffee = tx('plaid:p-pend');
  assert.equal(coffee.amount, 25.5, 'Plaid amounts already use Keel’s sign');
  assert.ok(coffee.category_id, 'Plaid category mapped onto a Keel category');
  const cat = db.getDb().prepare('SELECT name FROM categories WHERE id = ?').get(coffee.category_id) as any;
  assert.equal(cat.name, 'Coffee');
  assert.equal(tx('plaid:pay').transfer, 1, 'card payment is a transfer');
  assert.equal(tx('plaid:sal').income, 1);
  const cc = db.getDb().prepare(`SELECT * FROM accounts WHERE id = 'plaid:cc'`).get() as any;
  assert.equal(cc.balance, 410);
  assert.equal(cc.limit_amt, 2000);
  const h = db.getDb().prepare(`SELECT * FROM holdings WHERE account_id = 'plaid:inv'`).all() as any[];
  assert.equal(h[0].ticker, 'VTI');
  assert.equal(conns.getConnection(plaidId).cursor, 'c1');

  // user recategorizes and reviews the pending coffee; the posted row inherits it
  await tools.runTool('update_transaction', { transaction_id: 'plaid:p-pend', category_id: 'keel:restaurants', reviewed: true });
  db.getDb().prepare('UPDATE connections SET last_attempt = NULL WHERE id = ?').run(plaidId);
  const r2 = await sync.syncAll({ connection_id: plaidId });
  assert.equal(r2.connections[0].status, 'ok');
  assert.equal(tx('plaid:p-pend'), undefined);
  const posted = tx('plaid:p-post');
  assert.equal(posted.amount, 26.1);
  assert.equal(posted.category_id, 'keel:restaurants');
  assert.equal(posted.reviewed, 1);
  assert.equal(conns.getConnection(plaidId).cursor, 'c2');
});

test('plaid: ITEM_LOGIN_REQUIRED → needs_reauth, update-mode link token, repaired', async () => {
  plaid._setPlaidFetch(async (url: string, init?: RequestInit) => {
    const p = new URL(url).pathname;
    if (p === '/accounts/get') return json({ error_code: 'ITEM_LOGIN_REQUIRED', error_type: 'ITEM_ERROR', error_message: 'login required' }, 400);
    if (p === '/link/token/create') {
      const b = JSON.parse(String(init?.body));
      assert.equal(b.access_token, 'access-sandbox-11111111-2222');
      assert.equal(b.products, undefined, 'update mode sends no products');
      return json({ link_token: 'link-sandbox-update', expiration: 'x' });
    }
    throw new Error(p);
  });
  db.getDb().prepare('UPDATE connections SET last_attempt = NULL WHERE id = ?').run(plaidId);
  const r = await sync.syncAll({ connection_id: plaidId });
  assert.equal(r.connections[0].status, 'needs_reauth');
  const acct = q.listAccounts().find((a: any) => a.id === 'plaid:cc');
  assert.equal(acct.needs_attention, 1, 'accounts show Verification needed');
  const lt = await tools.runTool('plaid_create_link_token', { connection_id: plaidId });
  assert.equal(lt.mode, 'update');
});

test('switching a Copilot account to a connection stops double counting', async () => {
  const d = db.getDb();
  db.upsert('accounts', [{ id: 'cop-cc', name: 'Copilot card', mask: '3333', type: 'credit', balance: 400, source: 'copilot' }]);
  db.upsert('transactions', [
    { id: 'cop-old', date: '2026-09-01', name: 'Old', amount: 10, account_id: 'cop-cc', source: 'copilot' },
    { id: 'cop-new', date: '2026-10-20', name: 'New', amount: 11, account_id: 'cop-cc', source: 'copilot' },
  ]);
  db.upsert('balance_history', [{ date: '2026-09-01', account_id: 'cop-cc', balance: 300 }], ['date', 'account_id']);
  const dup = enrich.duplicateCandidates(plaidId);
  assert.deepEqual(dup.map((x: any) => [x.account_id, x.copilot_account_id]), [['plaid:cc', 'cop-cc']]);
  const r = await tools.runTool('switch_account_to_connection', { account_id: 'plaid:cc', copilot_account_id: 'cop-cc', from: '2026-10-01' });
  assert.equal(r.dropped_copilot, 1);
  assert.ok(tx('cop-old'));
  assert.equal(tx('cop-new'), undefined);
  assert.ok(!d.prepare(`SELECT 1 FROM transactions WHERE account_id = 'plaid:cc' AND date < '2026-10-01'`).get());
  assert.equal(enrich.supersededCutoffs().get('cop-cc'), '2026-10-01');
  assert.equal(enrich.takeoverDate('plaid:cc'), '2026-10-01');
  assert.ok(!q.listAccounts().some((a: any) => a.id === 'cop-cc'), 'Copilot copy hidden from net worth');
  assert.ok(d.prepare(`SELECT 1 FROM balance_history WHERE account_id = 'plaid:cc' AND date = '2026-09-01'`).get());
  assert.equal(enrich.duplicateCandidates(plaidId).length, 0);
});

test('transfer matching pairs a checking payment with the card credit', () => {
  const d = db.getDb();
  db.upsert('transactions', [
    { id: 'm-coffee', date: '2026-10-10', name: 'Coffee', amount: 150, account_id: 'plaid:chk', source: 'plaid', connection_id: plaidId, income: 0 },
    { id: 'm-out', date: '2026-10-10', name: 'CHASE CREDIT CRD AUTOPAY', amount: 150, account_id: 'plaid:chk', source: 'plaid', connection_id: plaidId, income: 0 },
    { id: 'm-in', date: '2026-10-11', name: 'Payment received', amount: -150, account_id: 'plaid:cc', source: 'plaid', connection_id: plaidId, income: 1 },
    { id: 'm-refund', date: '2026-10-12', name: 'Refund', amount: -40, account_id: 'plaid:cc', source: 'plaid', connection_id: plaidId, income: 1 },
    { id: 'm-buy', date: '2026-10-12', name: 'Hardware store', amount: 40, account_id: 'plaid:chk', source: 'plaid', connection_id: plaidId, income: 0 },
  ]);
  // two candidates on the outbound side (autopay and coffee) for one inbound: only the description-matched pair is marked
  enrich.matchTransfers(plaidId, 3650);
  assert.equal(tx('m-out').transfer + tx('m-in').transfer, 2);
  assert.equal(tx('m-in').income, 0);
  assert.equal(tx('m-coffee').transfer, 0, 'the coffee (listed first) is not paired with the card payment');
  assert.equal(tx('m-refund').transfer + tx('m-buy').transfer, 0, 'equal amounts without transfer wording stay as they are');
  d.prepare(`DELETE FROM transactions WHERE id LIKE 'm-%'`).run();
});

test('categorize from history uses the user’s own past choice for the merchant', () => {
  db.upsert('transactions', [
    { id: 'h-past', date: '2026-08-01', name: 'Blue Bottle', amount: 6, category_id: 'keel:coffee', account_id: null, source: 'copilot', connection_id: null },
    { id: 'h-new', date: '2026-10-01', name: 'blue bottle', amount: 7, category_id: null, account_id: 'plaid:chk', source: 'plaid', connection_id: plaidId },
  ]);
  assert.equal(enrich.categorizeFromHistory(plaidId) >= 1, true);
  assert.equal(tx('h-new').category_id, 'keel:coffee');
});

test('internal tools never reach the assistant or MCP', () => {
  const names = tools.anthropicTools().map((t: any) => t.name);
  for (const n of ['add_simplefin_connection', 'plaid_create_link_token', 'plaid_exchange_public_token', 'remove_connection']) assert.ok(!names.includes(n), n);
  assert.ok(names.includes('get_connections'));
  assert.ok(names.includes('sync_now'));
});

test('remove_connection keeps history as manual accounts unless asked to delete it', async () => {
  plaid._setPlaidFetch(async (url: string) => (new URL(url).pathname === '/item/remove' ? json({ request_id: 'r' }) : json({}, 500)));
  const r = await tools.runTool('remove_connection', { connection_id: plaidId, delete_data: true });
  assert.equal(r.revoked, true);
  assert.equal(tx('plaid:p-post'), undefined);
  assert.equal(enrich.supersededCutoffs().has('cop-cc'), false, 'Copilot account handed back');
  const keep = await tools.runTool('remove_connection', { connection_id: sfinId });
  assert.ok(keep.removed.accounts >= 1);
  const a = db.getDb().prepare(`SELECT source, connection_id FROM accounts WHERE id LIKE ?`).get(`sfin:${sfinId}:%`) as any;
  assert.deepEqual([a.source, a.connection_id], ['manual', null]);
  assert.equal(conns.connectionCount(), 0);
});
