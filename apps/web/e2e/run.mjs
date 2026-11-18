// the end to end run: snapshot and build (unless --reuse and a build exists), a throwaway api with
// the seeded Lemoni business, the production web under /custock, then every test file in tests/.
//
//   pnpm --filter @custock/web e2e                 everything
//   pnpm --filter @custock/web e2e -- --reuse      keep the last build
//   pnpm --filter @custock/web e2e -- stock auth   only tests whose group or name matches
//
// nothing is ever sent: dev mode, outbox transport, no mail or push settings, local photo storage.

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import cfg from './e2e.config.mjs';
import { buildWeb, builtStandalone, snapshot, startApi, startWeb, stopAll, apiLog, webLog } from './env.mjs';
import { closeBrowser, launchBrowser, runAll, writeReport } from './lib.mjs';

const args = process.argv.slice(2).filter((a) => a !== '--');
const reuse = args.includes('--reuse');
const only = args.filter((a) => !a.startsWith('--'));

let standalone = reuse ? builtStandalone() : null;
if (!standalone) {
  console.log('snapshot and build');
  snapshot();
  standalone = buildWeb();
}
console.log('starting api and web');
await startApi();
await startWeb(standalone);
await launchBrowser();

const dir = join(import.meta.dirname, 'tests');
for (const f of readdirSync(dir).filter((f) => f.endsWith('.mjs')).sort()) await import(pathToFileURL(join(dir, f)).href);

let results = [];
try {
  results = await runAll({ only: only.length ? only : undefined });
} finally {
  writeReport(results);
  await closeBrowser();
  stopAll();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed. report: ${join(cfg.results, 'report.md')}`);
if (process.env.E2E_LOGS) console.log(apiLog.join('').slice(-4000), webLog.join('').slice(-2000));
process.exit(failed ? 1 : 0);
