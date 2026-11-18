// speed check on a big made up business: 2,000 products, 200,000 movements, 20,000 customers.
// run: pnpm --filter @custock/api bench   (prints a markdown table of median and worst times)

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashPassword, migrate, openDb, seedBig, type Db } from '@custock/db';
import { uuidv7 } from '@custock/core';
import { createBusiness } from '../src/services/bootstrap';
import { captureError } from '../src/lib/errors';
import { createApp } from '../src/app';

export interface BenchRow {
  name: string;
  who: string;
  path: string;
  median: number;
  worst: number;
  status: number;
}

export async function bench(opts: { runs?: number; log?: (s: string) => void } = {}): Promise<{ rows: BenchRow[]; setupMs: number; db: Db; cleanup: () => void }> {
  const log = opts.log ?? (() => {});
  const dir = mkdtempSync(join(tmpdir(), 'custock-bench-'));
  const db = openDb(join(dir, 'bench.db'));
  migrate(db);
  const started = Date.now();
  const big = seedBig(db, { passwordHash: hashPassword('custock') });
  db.pragma('optimize');
  // the platform side: a super admin, 300 more small businesses and 300 open errors
  const pw = hashPassword('custock');
  for (let i = 0; i < 300; i++) {
    createBusiness(db, { name: `Bench shop ${i}`, slug: `bench-${i}`, ownerEmail: `owner${i}@bench.example.com`, ownerName: `Owner ${i}`, passwordHash: pw, shopName: 'Main', webUrl: 'http://localhost:3000' });
  }
  const now0 = Date.now();
  db.prepare("INSERT INTO users (id, email, display_name, password_hash, email_verified_at, locale, created_at, updated_at, platform_role) VALUES (@id, 'super@bench.example.com', 'Super', @pw, @n, 'en', @n, @n, 'superadmin')")
    .run({ id: uuidv7(now0), pw, n: now0 });
  for (let i = 0; i < 300; i++) captureError(db, { kind: 'api', message: `bench failure number ${i} in module ${i % 17}`, stack: `Error
    at f${i} (src/x${i}.ts:1:1)`, route: `/v1/x${i}` }, { notify: false });
  db.pragma('optimize');
  const setupMs = Date.now() - started;
  log(`seeded in ${setupMs} ms`);
  const app = createApp({ db, dev: true, jwtSecret: 'bench-secret-that-is-long-enough-000', publicWebUrl: 'http://localhost:3000', corsOrigins: [], rateLimit: false });

  const token = async (email: string) => {
    const res = await app.request('/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'custock' }) });
    return ((await res.json()) as { accessToken: string }).accessToken;
  };
  const tokens = {
    owner: await token(`owner.${big.orgId.slice(-6)}@example.com`),
    manager: await token(`manager.${big.orgId.slice(-6)}@example.com`),
    superadmin: await token('super@bench.example.com'),
  };
  const org = `/v1/orgs/${big.orgId}`;
  const cases: [string, keyof typeof tokens, string][] = [
    ['products, first page', 'owner', `${org}/products?limit=50`],
    ['products, search "meli"', 'owner', `${org}/products?q=meli&limit=50`],
    ['products, low stock filter', 'owner', `${org}/products?filter=low&limit=50`],
    ['product detail', 'owner', `${org}/products/${big.productIds[100]}`],
    ['customers, first page (owner)', 'owner', `${org}/customers?limit=50`],
    ['customers, first page (shop manager)', 'manager', `${org}/customers?limit=50`],
    ['customers, search "maria"', 'owner', `${org}/customers?q=maria&limit=50`],
    ['customers, exact phone', 'owner', `${org}/customers?q=%2B306910004321&limit=50`],
    ['movements, first page', 'owner', `${org}/movements?limit=50`],
    ['dashboard (owner, all shops)', 'owner', `${org}/reports/dashboard`],
    ['dashboard (shop manager)', 'manager', `${org}/reports/dashboard`],
    ['sales per day, 30 days', 'owner', `${org}/reports/sales?days=30`],
    ['top sellers, 30 days', 'owner', `${org}/reports/top-sellers?days=30`],
    ['most wanted', 'owner', `${org}/reports/most-wanted`],
    ['shrinkage, 30 days', 'owner', `${org}/reports/shrinkage?days=30`],
    ['sync, full (one shop)', 'manager', `${org}/shops/${big.shops[0]}/sync`],
    ['me context (owner)', 'owner', '/v1/me/context'],
    ['me context (super admin, 301 businesses)', 'superadmin', '/v1/me/context'],
    ['business settings', 'owner', `${org}`],
    ['limits and options (owner)', 'owner', `${org}/policies`],
    ['audit, first page', 'owner', `${org}/audit`],
    ['platform overview (301 businesses)', 'superadmin', '/v1/platform/overview'],
    ['platform business list (301)', 'superadmin', '/v1/platform/businesses'],
    ['platform errors (300 open)', 'superadmin', '/v1/platform/errors'],
    ['storage meter (super admin)', 'superadmin', '/v1/platform/settings'],
  ];
  const variantIds = (db.prepare('SELECT id FROM product_variants WHERE org_id = ? LIMIT 50').all(big.orgId) as { id: string }[]).map((r) => r.id);
  // writes: one batch of 50 sales, the adjust limit and negative stock rules run per movement
  const writes: [string, keyof typeof tokens, string, () => string][] = [
    ['50 sales in one batch', 'manager', `${org}/movements`, () => {
      const t = Date.now();
      return JSON.stringify({ movements: Array.from({ length: 50 }, (_, i) => ({ id: uuidv7(t + i), shopId: big.shops[0], variantId: variantIds[i % variantIds.length], kind: 'sale', qtyDelta: -1, occurredAt: t })) });
    }],
  ];
  const runs = opts.runs ?? 7;
  const rows: BenchRow[] = [];
  for (const [name, who, path] of cases) {
    const times: number[] = [];
    let status = 0;
    for (let i = 0; i < runs + 2; i++) {
      const t0 = performance.now();
      const res = await app.request(path, { headers: { Authorization: `Bearer ${tokens[who]}` } });
      await res.arrayBuffer();
      const ms = performance.now() - t0;
      status = res.status;
      if (i >= 2) times.push(ms);
    }
    times.sort((a, b) => a - b);
    rows.push({ name, who, path, median: Math.round(times[Math.floor(times.length / 2)]!), worst: Math.round(times[times.length - 1]!), status });
  }
  for (const [name, who, path, body] of writes) {
    const times: number[] = [];
    let status = 0;
    for (let i = 0; i < runs + 2; i++) {
      const payload = body();
      const t0 = performance.now();
      const res = await app.request(path, { method: 'POST', headers: { Authorization: `Bearer ${tokens[who]}`, 'Content-Type': 'application/json' }, body: payload });
      await res.arrayBuffer();
      const ms = performance.now() - t0;
      status = res.status;
      if (i >= 2) times.push(ms);
    }
    times.sort((a, b) => a - b);
    rows.push({ name, who, path, median: Math.round(times[Math.floor(times.length / 2)]!), worst: Math.round(times[times.length - 1]!), status });
  }
  return {
    rows,
    setupMs,
    db,
    cleanup: () => {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/bench.ts')) {
  const { rows, cleanup } = await bench({ log: (s) => console.log(s) });
  console.log('\n| endpoint | median ms | worst ms |\n|---|---:|---:|');
  for (const r of rows) console.log(`| ${r.name} | ${r.median} | ${r.worst} |${r.status !== 200 ? ` status ${r.status}` : ''}`);
  cleanup();
}
