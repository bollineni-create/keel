import fs from 'node:fs';
import { getDb } from './db.js';
import { syncFromCopilot, copilot } from './sync/copilot.js';
import { importCopilotCsv } from './sync/csv.js';
import { seedDemo } from './demo.js';

const [cmd, arg] = process.argv.slice(2);
getDb();

switch (cmd) {
  case 'sync': {
    const r = await syncFromCopilot();
    console.log(JSON.stringify(r, null, 2));
    await copilot.close();
    break;
  }
  case 'import': {
    if (!arg) throw new Error('usage: npm run import -- path/to/copilot-export.csv');
    console.log(JSON.stringify(importCopilotCsv(fs.readFileSync(arg, 'utf8')), null, 2));
    break;
  }
  case 'demo': {
    console.log(JSON.stringify(seedDemo(), null, 2));
    break;
  }
  default:
    console.log('commands: sync | import <csv> | demo');
}
process.exit(0);
