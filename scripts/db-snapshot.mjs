// nightly snapshot of the live database with VACUUM INTO, keeps the newest N. safe while the api runs.
// usage: node scripts/db-snapshot.mjs --db /data/custock.db --out /data/snapshots [--keep 30]
// cron:  15 3 * * *  node /opt/custock/scripts/db-snapshot.mjs --db /var/lib/custock/custock.db --out /var/lib/custock/snapshots

import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
const Database = require('better-sqlite3');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
}

const dbPath = resolve(arg('db', 'apps/api/data/custock.db'));
const outDir = resolve(arg('out', 'apps/api/data/snapshots'));
const keep = Number(arg('keep', '30'));
if (!existsSync(dbPath)) {
  console.error(`no database at ${dbPath}`);
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 23);
const target = join(outDir, `custock-${stamp}.db`);
const db = new Database(dbPath, { readonly: true, fileMustExist: true });
db.prepare('VACUUM INTO ?').run(target);
db.close();

// the copy is checked right away, a broken snapshot is worse than none
const copy = new Database(target, { readonly: true });
const ok = copy.pragma('integrity_check', { simple: true });
copy.close();
if (ok !== 'ok') {
  rmSync(target);
  console.error(`snapshot failed the integrity check: ${ok}`);
  process.exit(1);
}

const snaps = readdirSync(outDir).filter((f) => /^custock-.*\.db$/.test(f)).sort();
for (const old of snaps.slice(0, Math.max(0, snaps.length - keep))) rmSync(join(outDir, old));

console.log(`snapshot ${target} (${Math.round(statSync(target).size / 1024)} kB), keeping ${Math.min(keep, snaps.length)}`);
