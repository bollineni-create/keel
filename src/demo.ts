/** Seeds a plausible demo dataset so the UI can be explored before the first Copilot sync. */
import { getDb, nowIso, setMeta, upsert, type Row } from './db.js';

function rnd(seed: number) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

export function seedDemo(): Record<string, number> {
  const r = rnd(42);
  const d = getDb();
  for (const t of ['transactions', 'accounts', 'categories', 'budgets', 'recurrings', 'holdings', 'balance_history', 'goals']) d.prepare(`DELETE FROM ${t}`).run();

  const accounts: Row[] = [
    { id: 'chk', name: 'Everyday Checking', mask: '4821', type: 'depository', subtype: 'checking', institution: 'Demo Bank', balance: 6240.18, currency: 'USD', hidden: 0, closed: 0, updated_at: nowIso() },
    { id: 'sav', name: 'High-Yield Savings', mask: '0093', type: 'depository', subtype: 'savings', institution: 'Demo Bank', balance: 18400.0, currency: 'USD', hidden: 0, closed: 0, updated_at: nowIso() },
    { id: 'cc1', name: 'Rewards Card', mask: '7710', type: 'credit', subtype: 'credit card', institution: 'Demo Card', balance: 2130.55, limit_amt: 15000, currency: 'USD', hidden: 0, closed: 0, updated_at: nowIso() },
    { id: 'cc2', name: 'Travel Card', mask: '3301', type: 'credit', subtype: 'credit card', institution: 'Demo Card', balance: 412.9, limit_amt: 10000, currency: 'USD', hidden: 0, closed: 0, updated_at: nowIso() },
    { id: '401k', name: '401(k)', mask: '', type: 'investment', subtype: '401k', institution: 'Demo Retirement', balance: 41200.0, currency: 'USD', hidden: 0, closed: 0, updated_at: nowIso() },
    { id: 'roth', name: 'Roth IRA', mask: '', type: 'investment', subtype: 'roth', institution: 'Demo Brokerage', balance: 15870.0, currency: 'USD', hidden: 0, closed: 0, updated_at: nowIso() },
    { id: 'loan', name: '401(k) Loan', mask: '', type: 'loan', subtype: 'loan', institution: 'Demo Retirement', balance: 2950.0, currency: 'USD', hidden: 0, closed: 0, updated_at: nowIso() },
  ];
  upsert('accounts', accounts);

  const cats: Array<[string, string, string | null, string | null, number | null]> = [
    ['food', 'Food & Drink', null, '🍽️', 900], ['groceries', 'Groceries', 'food', '🛒', 450], ['dining', 'Restaurants', 'food', '🍜', 350], ['coffee', 'Coffee', 'food', '☕', 100],
    ['housing', 'Housing', null, '🏠', 2350], ['rent', 'Rent', 'housing', '🏠', 2250], ['utilities', 'Utilities', 'housing', '💡', 100],
    ['transport', 'Transport', null, '🚗', 350], ['gas', 'Gas', 'transport', '⛽', 120], ['rideshare', 'Rideshare', 'transport', '🚕', 80], ['parking', 'Parking & Tolls', 'transport', '🅿️', 60], ['charging', 'EV Charging', 'transport', '🔌', 90],
    ['shopping', 'Shopping', null, '🛍️', 300], ['subs', 'Subscriptions', null, '📺', 120], ['health', 'Health', null, '💊', 200], ['travel', 'Travel', null, '✈️', 300], ['fun', 'Entertainment', null, '🎟️', 150], ['income', 'Income', null, '💵', null], ['transfer', 'Transfers', null, '↔️', null],
  ];
  upsert('categories', cats.map(([id, name, parent_id, emoji, budget]) => ({ id, name, parent_id, emoji, color: null, excluded: id === 'transfer' ? 1 : 0, budget_amount: budget, raw: null })));
  upsert('budgets', cats.filter((c) => c[4]).map(([id, name, , , budget]) => ({ id: `cat:${id}`, category_id: id, name, amount: budget, period: 'monthly', amounts: null, raw: null })));

  const merchants: Array<[string, string, string, number, number]> = [
    ['Trader Joe\'s', 'groceries', 'cc1', 45, 110], ['Whole Foods', 'groceries', 'cc1', 60, 140], ['Safeway', 'groceries', 'cc1', 30, 90],
    ['Chipotle', 'dining', 'cc1', 12, 18], ['Din Tai Fung', 'dining', 'cc1', 48, 95], ['Local Thai', 'dining', 'cc1', 22, 40], ['Sushi Kashiba', 'dining', 'cc2', 90, 160],
    ['Starbucks', 'coffee', 'cc1', 5, 9], ['Victrola Coffee', 'coffee', 'cc1', 5, 8],
    ['Shell', 'gas', 'cc2', 40, 70], ['Uber', 'rideshare', 'cc1', 12, 38], ['SDOT Parking', 'parking', 'cc1', 4, 14], ['Tesla Supercharger', 'charging', 'cc2', 14, 32],
    ['Amazon', 'shopping', 'cc1', 15, 120], ['Target', 'shopping', 'cc1', 20, 80], ['Uniqlo', 'shopping', 'cc1', 40, 110],
    ['CVS', 'health', 'cc1', 10, 45], ['Bartell Drugs', 'health', 'cc1', 8, 30],
    ['AMC Theatres', 'fun', 'cc1', 16, 34], ['Steam', 'fun', 'cc1', 10, 60],
  ];
  const subs: Array<[string, string, string, number, number]> = [['Netflix', 'subs', 'cc1', 15.49, 14], ['Spotify', 'subs', 'cc1', 11.99, 3], ['iCloud', 'subs', 'cc1', 2.99, 22], ['Claude Pro', 'subs', 'cc1', 20.0, 9], ['Gym', 'health', 'chk', 59.0, 1], ['Seattle City Light', 'utilities', 'chk', 68.0, 17], ['Tesla Insurance', 'transport', 'chk', 142.0, 5]];

  const tx: Row[] = [];
  const bh: Row[] = [];
  const today = new Date();
  const start = new Date(today);
  start.setUTCMonth(start.getUTCMonth() - 11, 1);
  let id = 1;
  let chk = 5200, sav = 15000, cc1 = 1200, cc2 = 300, k401 = 35000, roth = 13000, loan = 3200;
  for (let dt = new Date(start); dt <= today; dt.setUTCDate(dt.getUTCDate() + 1)) {
    const date = dt.toISOString().slice(0, 10);
    const dom = dt.getUTCDate();
    const dow = dt.getUTCDay();
    const n = 1 + Math.floor(r() * (dow === 0 || dow === 6 ? 3 : 2));
    for (let i = 0; i < n; i++) {
      const m = merchants[Math.floor(r() * merchants.length)];
      const amount = Math.round((m[3] + r() * (m[4] - m[3])) * 100) / 100;
      const pending = dt.getTime() > today.getTime() - 3 * 86400000 && r() < 0.4 ? 1 : 0;
      tx.push({ id: `demo-${id++}`, date, name: m[0], original_name: m[0].toUpperCase(), amount, account_id: m[2], category_id: m[1], pending, reviewed: pending ? 0 : r() < 0.9 ? 1 : 0, excluded: 0, transfer: 0, income: 0, note: null, recurring_id: null, tags: null, source: 'demo', raw: null, updated_at: nowIso() });
      if (m[2] === 'cc1') cc1 += amount; else if (m[2] === 'cc2') cc2 += amount; else chk -= amount;
    }
    for (const s of subs) if (dom === s[4]) {
      tx.push({ id: `demo-${id++}`, date, name: s[0], original_name: s[0].toUpperCase(), amount: s[3], account_id: s[2], category_id: s[1], pending: 0, reviewed: 1, excluded: 0, transfer: 0, income: 0, note: null, recurring_id: `rec:${s[0]}`, tags: null, source: 'demo', raw: null, updated_at: nowIso() });
      if (s[2] === 'cc1') cc1 += s[3]; else chk -= s[3];
    }
    if (dom === 1) { tx.push({ id: `demo-${id++}`, date, name: 'Rent — The Ellipse', original_name: 'RENT', amount: 2250, account_id: 'chk', category_id: 'rent', pending: 0, reviewed: 1, excluded: 0, transfer: 0, income: 0, note: null, recurring_id: 'rec:Rent', tags: null, source: 'demo', raw: null, updated_at: nowIso() }); chk -= 2250; }
    if (dom === 15 || dom === 28) { const pay = 3890.12; tx.push({ id: `demo-${id++}`, date, name: 'JPMorgan Chase Payroll', original_name: 'JPMC PAYROLL', amount: -pay, account_id: 'chk', category_id: 'income', pending: 0, reviewed: 1, excluded: 0, transfer: 0, income: 1, note: null, recurring_id: 'rec:Payroll', tags: null, source: 'demo', raw: null, updated_at: nowIso() }); chk += pay; k401 += 420; loan -= 115; }
    if (dom === 20) { const pay = Math.round(cc1 * 100) / 100; tx.push({ id: `demo-${id++}`, date, name: 'Payment to Rewards Card', original_name: 'CARD PAYMENT', amount: pay, account_id: 'chk', category_id: 'transfer', pending: 0, reviewed: 1, excluded: 0, transfer: 1, income: 0, note: null, recurring_id: null, tags: null, source: 'demo', raw: null, updated_at: nowIso() }); tx.push({ id: `demo-${id++}`, date, name: 'Payment from Checking', original_name: 'PAYMENT', amount: -pay, account_id: 'cc1', category_id: 'transfer', pending: 0, reviewed: 1, excluded: 0, transfer: 1, income: 0, note: null, recurring_id: null, tags: null, source: 'demo', raw: null, updated_at: nowIso() }); chk -= pay; cc1 = 0; }
    if (dom === 2) { tx.push({ id: `demo-${id++}`, date, name: 'Transfer to Savings', original_name: 'XFER', amount: 600, account_id: 'chk', category_id: 'transfer', pending: 0, reviewed: 1, excluded: 0, transfer: 1, income: 0, note: null, recurring_id: null, tags: null, source: 'demo', raw: null, updated_at: nowIso() }); chk -= 600; sav += 600; }
    sav *= 1 + 0.042 / 365; k401 *= 1 + (r() - 0.47) * 0.012; roth *= 1 + (r() - 0.47) * 0.014;
    for (const [acct, bal] of [['chk', chk], ['sav', sav], ['cc1', cc1], ['cc2', cc2], ['401k', k401], ['roth', roth], ['loan', loan]] as Array<[string, number]>) bh.push({ date, account_id: acct, balance: Math.round(bal * 100) / 100 });
  }
  // one odd transaction for find_unusual_transactions
  tx.push({ id: `demo-${id++}`, date: today.toISOString().slice(0, 10), name: 'Apple Store', original_name: 'APPLE STORE', amount: 1249.0, account_id: 'cc1', category_id: 'shopping', pending: 1, reviewed: 0, excluded: 0, transfer: 0, income: 0, note: null, recurring_id: null, tags: null, source: 'demo', raw: null, updated_at: nowIso() });
  upsert('transactions', tx);
  upsert('balance_history', bh, ['date', 'account_id']);
  d.prepare('UPDATE accounts SET balance = (SELECT balance FROM balance_history b WHERE b.account_id = accounts.id ORDER BY date DESC LIMIT 1)').run();

  const nextOf = (dom: number) => { const n = new Date(today); if (n.getUTCDate() >= dom) n.setUTCMonth(n.getUTCMonth() + 1); n.setUTCDate(dom); return n.toISOString().slice(0, 10); };
  upsert('recurrings', [
    ...subs.map((s) => ({ id: `rec:${s[0]}`, name: s[0], amount: s[3], frequency: 'monthly', next_date: nextOf(s[4]), last_date: null, state: 'active', category_id: s[1], account_id: s[2], raw: null })),
    { id: 'rec:Rent', name: 'Rent — The Ellipse', amount: 2250, frequency: 'monthly', next_date: nextOf(1), last_date: null, state: 'active', category_id: 'rent', account_id: 'chk', raw: null },
    { id: 'rec:Payroll', name: 'JPMorgan Chase Payroll', amount: -3890.12, frequency: 'biweekly', next_date: nextOf(28), last_date: null, state: 'active', category_id: 'income', account_id: 'chk', raw: null },
  ]);
  upsert('holdings', [
    { id: 'h1', account_id: '401k', security_id: 'VFIAX', ticker: 'VFIAX', name: 'Vanguard 500 Index Admiral', quantity: 58.2, price: 540.1, value: 31433.8, cost_basis: 26200, raw: null },
    { id: 'h2', account_id: '401k', security_id: 'VTIAX', ticker: 'VTIAX', name: 'Vanguard Total Intl Stock Admiral', quantity: 220.0, price: 37.4, value: 8228, cost_basis: 7900, raw: null },
    { id: 'h3', account_id: 'roth', security_id: 'VTI', ticker: 'VTI', name: 'Vanguard Total Stock Market ETF', quantity: 42.0, price: 298.5, value: 12537, cost_basis: 10100, raw: null },
    { id: 'h4', account_id: 'roth', security_id: 'SCHD', ticker: 'SCHD', name: 'Schwab US Dividend Equity ETF', quantity: 110.0, price: 29.1, value: 3201, cost_basis: 3000, raw: null },
  ]);
  upsert('goals', [{ id: 'g1', name: 'Emergency fund', target: 25000, current: 18400, due: null, raw: null }]);
  setMeta('last_sync', nowIso());
  setMeta('demo', '1');
  return { accounts: accounts.length, categories: cats.length, transactions: tx.length, balance_history: bh.length };
}
