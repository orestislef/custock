// what the stock bug hunt found: an undone sale kept counting in the reports, a misread barcode
// landed in the unknown codes list, and the product page had no way to know a shop's own price.

import { beforeAll, describe, expect, it } from 'vitest';
import { hashPassword, migrate, openDb, seed, type Db, type SeedResult } from '@custock/db';
import { uuidv7 } from '@custock/core';
import { createApp, type App } from '../src/app';
import { rollup } from '../src/worker';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const SECRET = 'stock-hunt-test-secret-long-enough-1234';
const clock = Date.now();

describe('stock bug hunt', () => {
  let db: Db;
  let s: SeedResult;
  let app: App;
  const tokens: Record<string, string> = {};

  async function call(method: string, path: string, token?: string, body?: unknown) {
    const res = await app.request(path, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: Json = text;
    try { parsed = text ? JSON.parse(text) : null; } catch { /* not json */ }
    return { status: res.status, body: parsed };
  }
  const q = (sql: string, ...a: unknown[]) => db.prepare(sql).get(...a) as Json;
  let n = 0;
  const id = () => uuidv7(clock + ++n);
  const O = () => `/v1/orgs/${s.orgId}`;

  // a piece variant with stock in kifisia
  let variant = '';

  beforeAll(async () => {
    db = openDb(':memory:');
    migrate(db);
    s = seed(db, { passwordHash: hashPassword('custock'), now: clock });
    app = createApp({ db, dev: true, jwtSecret: SECRET, publicWebUrl: 'http://localhost:3000', corsOrigins: [], now: () => clock, rateLimit: false });
    for (const who of ['eleni', 'maria']) {
      const r = await call('POST', '/v1/auth/login', undefined, { email: `${who}@example.com`, password: 'custock' });
      tokens[who] = r.body.accessToken;
    }
    variant = q(
      `SELECT l.variant_id AS v FROM stock_levels l JOIN product_variants pv ON pv.id = l.variant_id JOIN products p ON p.id = pv.product_id
        WHERE l.shop_id = ? AND l.on_hand > 5 AND p.uom = 'piece' AND p.archived_at IS NULL
          -- a product without any offer, so the shop price test sees the shop price and not an offer
          AND NOT EXISTS (SELECT 1 FROM post_products pp WHERE pp.variant_id = l.variant_id AND pp.offer_price_minor IS NOT NULL)
        ORDER BY l.variant_id LIMIT 1`,
      s.shops.kifisia,
    ).v;
  });

  it('an undone sale leaves sales today, the sales chart, top sellers and the daily stats', async () => {
    const dash = async () => (await call('GET', `${O()}/reports/dashboard`, tokens.eleni)).body.salesTodayMinor as number;
    const series = async () => ((await call('GET', `${O()}/reports/sales?days=1`, tokens.eleni)).body as { value: number }[]).reduce((a, p) => a + p.value, 0);
    const top = async () => ((await call('GET', `${O()}/reports/top-sellers?days=1`, tokens.eleni)).body as { variantId: string; qty: number }[]).find((x) => x.variantId === variant)?.qty ?? 0;
    const stats = () => q('SELECT coalesce(sum(sales_qty), 0) AS n FROM daily_shop_stats WHERE shop_id = ?', s.shops.kifisia).n as number;

    rollup(db, clock);
    const before = { dash: await dash(), series: await series(), top: await top(), stats: stats() };
    const sale = id();
    const sold = await call('POST', `${O()}/movements`, tokens.maria, { movements: [{ id: sale, shopId: s.shops.kifisia, variantId: variant, qtyDelta: -500, kind: 'sale', occurredAt: clock }] });
    expect(sold.body.accepted).toEqual([sale]);
    rollup(db, clock);
    expect(await dash()).toBeGreaterThan(before.dash);
    // a sale this big puts the variant in the top ten whatever else the seed sold today
    expect(await top()).toBeGreaterThanOrEqual(500);
    expect(stats()).toBe(before.stats + 500);

    const undo = await call('POST', `${O()}/movements`, tokens.maria, { movements: [{ id: id(), shopId: s.shops.kifisia, variantId: variant, qtyDelta: 500, kind: 'reversal', refType: 'reversal', refId: sale, occurredAt: clock }] });
    expect(undo.body.accepted).toHaveLength(1);
    rollup(db, clock);
    expect(await dash()).toBe(before.dash);
    expect(await series()).toBe(before.series);
    expect(await top()).toBe(before.top);
    expect(stats()).toBe(before.stats);
  });

  it('an undone damage leaves the shrinkage report', async () => {
    const lost = async () => ((await call('GET', `${O()}/reports/shrinkage?days=1`, tokens.eleni)).body as { reason: string; qty: number }[]).find((r) => r.reason === 'damaged')?.qty ?? 0;
    const before = await lost();
    const dmg = id();
    await call('POST', `${O()}/movements`, tokens.maria, { movements: [{ id: dmg, shopId: s.shops.kifisia, variantId: variant, qtyDelta: -1, kind: 'damage', reason: 'damaged', occurredAt: clock }] });
    expect(await lost()).toBe(before + 1);
    await call('POST', `${O()}/movements`, tokens.maria, { movements: [{ id: id(), shopId: s.shops.kifisia, variantId: variant, qtyDelta: 1, kind: 'reversal', refType: 'reversal', refId: dmg, occurredAt: clock }] });
    expect(await lost()).toBe(before);
  });

  it('a misread barcode (the check digit does not match) is not kept as an unknown code', async () => {
    const count = () => q('SELECT count(*) AS n FROM unknown_scans WHERE org_id = ?', s.orgId).n as number;
    const before = count();
    const bad = await call('POST', `${O()}/scan`, tokens.maria, { code: '5201234567890', shopId: s.shops.kifisia });
    expect(bad.body.valid).toBe(false);
    expect(bad.body.match).toBe('unknown');
    expect(count()).toBe(before);
    const good = await call('POST', `${O()}/scan`, tokens.maria, { code: '5201234567894', shopId: s.shops.kifisia });
    expect(good.body.valid).toBe(true);
    expect(count()).toBe(before + 1);
  });

  it("the product answers with each shop's own price, and a sale without a price uses it", async () => {
    const productId = q('SELECT product_id AS p FROM product_variants WHERE id = ?', variant).p;
    const set = await call('PUT', `${O()}/shops/${s.shops.kifisia}/variants/${variant}/settings`, tokens.eleni, { priceOverrideMinor: 1234 });
    expect(set.status).toBeLessThan(300);
    const p = await call('GET', `${O()}/products/${productId}`, tokens.eleni);
    const kif = p.body.levels.find((l: Json) => l.variantId === variant && l.shopId === s.shops.kifisia);
    const mar = p.body.levels.find((l: Json) => l.variantId === variant && l.shopId === s.shops.marousi);
    expect(kif.priceOverrideMinor).toBe(1234);
    expect(mar?.priceOverrideMinor ?? null).toBeNull();
    const sale = id();
    await call('POST', `${O()}/movements`, tokens.maria, { movements: [{ id: sale, shopId: s.shops.kifisia, variantId: variant, qtyDelta: -1, kind: 'sale', occurredAt: clock }] });
    expect(q('SELECT unit_price_minor AS p FROM stock_movements WHERE id = ?', sale).p).toBe(1234);
  });
});
