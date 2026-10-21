import fs from 'node:fs';
import { getDb } from './db.js';
import { copilot } from './sync/copilot.js';
import { listConnections } from './sync/connections.js';
import { syncAll } from './sync/index.js';
import { importCopilotCsv } from './sync/csv.js';
import { runTool } from './tools.js';
import { seedDemo } from './demo.js';

const [cmd, arg, arg2] = process.argv.slice(2);
getDb();

switch (cmd) {
  case 'sync': {
    // npm run sync [-- copilot|plaid|simplefin|<connection id>]
    const provider = arg === 'copilot' || arg === 'plaid' || arg === 'simplefin' ? arg : undefined;
    const r = await syncAll({ provider, connection_id: arg && !provider ? arg : undefined, force: true });
    console.log(JSON.stringify(r, null, 2));
    await copilot.close();
    break;
  }
  case 'connections': {
    console.log(JSON.stringify(listConnections(), null, 2));
    break;
  }
  case 'connect': {
    // npm run connect -- simplefin <setup token>
    if (arg !== 'simplefin' || !arg2) throw new Error('usage: npm run connect -- simplefin <SimpleFIN setup token>   (Plaid connects from Settings in the app)');
    console.log(JSON.stringify(await runTool('add_simplefin_connection', { setup_token: arg2 }), null, 2));
    break;
  }
  case 'import': {
    if (!arg) throw new Error('usage: npm run import -- path/to/copilot-export.csv');
    console.log(JSON.stringify(importCopilotCsv(fs.readFileSync(arg, 'utf8')), null, 2));
    break;
  }
  case 'demo': {
    if (listConnections().length) throw new Error('Bank connections exist: demo data would mix with real data. Remove the connections first (Settings → Bank connections).');
    console.log(JSON.stringify(seedDemo(), null, 2));
    break;
  }
  default:
    console.log('commands: sync [copilot|plaid|simplefin|<connection id>] | connections | connect simplefin <token> | import <csv> | demo');
}
process.exit(0);
