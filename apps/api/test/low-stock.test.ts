// "running low" is one rule everywhere: at or below the shop's reorder point when set, else at or
// below the business's few left number, and above zero. the dashboard, the low filter and the
// alert agree with the badges the staff see.

import { beforeAll, describe, expect, it } from 'vitest';
import { hashPassword, migrate, openDb, seed, type Db, type SeedResult } from '@custock/db';
import { uuidv7 } from '@custock/core';
import { createApp, type App } from '../src/app';
import { isLow, lowThreshold } from '../src/lib/low-stock';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const SECRET = 'low-stock-test-secret-long-enough-12345';
const clock = Date.now();

describe('the low stock rule', () => {
  it('uses the reorder point when set, else the few left number, scaled for kilo, litre and metre', () => {
    expect(lowThreshold(null, 3, 'piece')).toBe(3);
    expect(lowThreshold(null, 3, 'kg')).toBe(3000);
    expect(lowThreshold(10, 3, 'piece')).toBe(10);
    expect(isLow(3, null, 3, 'piece')).toBe(true);
    expect(isLow(4, null, 3, 'piece')).toBe(false);
    expect(isLow(0, null, 3, 'piece')).toBe(false); // zero is out, not low
    expect(isLow(-1, null, 3, 'piece')).toBe(false);
    expect(isLow(2500, null, 3, 'kg')).toBe(true);
    expect(isLow(3, 1, 3, 'piece')).toBe(false); // a reorder point wins over the few left number
  });
});

describe('dashboard, filter and alert agree', () => {
  let db: Db;
  let s: SeedResult;
  let app: App;
  let tok = '';

  async function call(method: string, path: string, body?: unknown) {
    const res = await app.request(path, {
      method,
      headers: { Authorization: `Bearer ${tok}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as Json };
  }
  const org = () => `/v1/orgs/${s.orgId}`;
  const dashboard = async () => (await call('GET', `${org()}/reports/dashboard?shopId=${s.shops.kifisia}`)).body.lowStock as number;
  const lowIds = async () => ((await call('GET', `${org()}/products?filter=low&shopId=${s.shops.kifisia}&limit=200`)).body.items as Json[]).map((p) => p.id);
  const move = (variantId: string, kind: string, qtyDelta: number) =>
    call('POST', `${org()}/movements`, { movements: [{ id: uuidv7(), shopId: s.shops.kifisia, variantId, kind, qtyDelta, occurredAt: clock }] });

  beforeAll(async () => {
    db = openDb(':memory:');
    migrate(db);
    s = seed(db, { passwordHash: hashPassword('custock'), now: clock });
    app = createApp({ db, dev: true, jwtSecret: SECRET, publicWebUrl: 'https://custock.example.com', corsOrigins: [], now: () => Date.now(), rateLimit: false });
    const r = await app.request('/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'eleni@example.com', password: 'custock' }) });
    tok = ((await r.json()) as Json).accessToken;
  });

  it('counts a product at the few left number as low with no reorder point', async () => {
    const few = db.prepare('SELECT few_left_threshold AS n FROM organizations WHERE id = ?').get(s.orgId) as { n: number };
    const p = await call('POST', `${org()}/products`, { name: 'Low rule honey', uom: 'piece', variants: [{ priceMinor: 750 }] });
    expect(p.status).toBe(201);
    const v = p.body.variants[0].id as string;
    const before = await dashboard();

    expect((await move(v, 'receive', few.n + 2)).status).toBe(200);
    expect(await lowIds()).not.toContain(p.body.id);
    expect(await dashboard()).toBe(before);

    // a sale takes it to the few left number: low on the dashboard and in the filter, one alert
    expect((await move(v, 'sale', -2)).status).toBe(200);
    expect(await lowIds()).toContain(p.body.id);
    expect(await dashboard()).toBe(before + 1);
    const alerts = () => (db.prepare("SELECT count(*) AS n FROM dev_outbox WHERE channel = 'push' AND json_extract(payload, '$.type') = 'lowStock' AND json_extract(payload, '$.variantId') = ?").get(v) as { n: number }).n;
    expect(alerts()).toBeGreaterThan(0);
    const sent = alerts();

    // further sales in the same dip send nothing new
    expect((await move(v, 'sale', -1)).status).toBe(200);
    expect(alerts()).toBe(sent);

    // a reorder point below the stock takes it out of low again
    const set = await call('PUT', `${org()}/shops/${s.shops.kifisia}/variants/${v}/settings`, { reorderPoint: 0 });
    expect(set.status).toBeLessThan(300);
    expect(await lowIds()).not.toContain(p.body.id);
    expect(await dashboard()).toBe(before);

    // sold out: out, not low
    const left = few.n - 1;
    expect((await move(v, 'sale', -left)).status).toBe(200);
    expect(await lowIds()).not.toContain(p.body.id);
  });
});
