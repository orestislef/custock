// the monthly restore test: open a snapshot (or a litestream restore) in a scratch copy and check
// that it is a working custock database. exits 1 when something is wrong.
// usage: node scripts/db-restore-check.mjs --file /data/snapshots/custock-2026-11-17T03-15-00.db

import { createRequire } from 'node:module';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
const Database = require('better-sqlite3');

const i = process.argv.indexOf('--file');
const file = i > 0 ? resolve(process.argv[i + 1]) : null;
if (!file || !existsSync(file)) {
  console.error('usage: node scripts/db-restore-check.mjs --file <snapshot.db>');
  process.exit(1);
}

const dir = mkdtempSync(join(tmpdir(), 'custock-restore-'));
const scratch = join(dir, 'restore.db');
copyFileSync(file, scratch);
const db = new Database(scratch);
const problems = [];
const one = (sql) => db.prepare(sql).get();

try {
  const integrity = db.pragma('integrity_check', { simple: true });
  if (integrity !== 'ok') problems.push(`integrity_check: ${integrity}`);
  const fk = db.pragma('foreign_key_check');
  if (fk.length) problems.push(`${fk.length} foreign key problems`);
  const migrations = one('SELECT count(*) AS n, max(name) AS last FROM schema_migrations');
  // the cached stock must equal the ledger
  const drift = one(`SELECT count(*) AS n FROM stock_levels l
    WHERE on_hand != (SELECT coalesce(sum(qty_delta), 0) FROM stock_movements m WHERE m.shop_id = l.shop_id AND m.variant_id = l.variant_id)`);
  if (drift.n) problems.push(`${drift.n} stock levels differ from the ledger`);
  // the search index can be rebuilt (rowids may have moved in the copy)
  const fts = one("SELECT count(*) AS n FROM sqlite_master WHERE name = 'products_fts'");
  if (fts.n) db.exec("INSERT INTO products_fts(products_fts) VALUES ('rebuild'); INSERT INTO customers_fts(customers_fts) VALUES ('rebuild');");
  const counts = {
    organizations: one('SELECT count(*) AS n FROM organizations').n,
    products: one('SELECT count(*) AS n FROM products').n,
    movements: one('SELECT count(*) AS n FROM stock_movements').n,
    customers: one('SELECT count(*) AS n FROM customers WHERE erased_at IS NULL').n,
    users: one('SELECT count(*) AS n FROM users WHERE deleted_at IS NULL').n,
  };
  console.log(`migrations: ${migrations.n} (last ${migrations.last})`);
  console.log(`rows: ${JSON.stringify(counts)}`);
} catch (err) {
  problems.push(String(err));
} finally {
  db.close();
  rmSync(dir, { recursive: true, force: true });
}

if (problems.length) {
  console.error(`restore check failed:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log('restore check passed');
