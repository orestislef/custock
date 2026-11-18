// what the big business hunt found: a product's history asked for the shop's latest movements and
// filtered them in the browser, so a busy shop showed an empty history for most products.

import { beforeAll, describe, expect, it } from 'vitest';
import { hashPassword, migrate, openDb, seed, type Db, type SeedResult } from '@custock/db';
import { uuidv7 } from '@custock/core';
import { createApp, type App } from '../src/app';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const SECRET = 'big-hunt-test-secret-that-is-long-enough';
const clock = Date.now();

describe('big business hunt', () => {
  let db: Db;
  let s: SeedResult;
  let app: App;
  let token = '';
  let n = 0;
  const id = () => uuidv7(clock + ++n);

  async function call(method: string, path: string, body?: unknown) {
    const res = await app.request(path, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as Json };
  }

  beforeAll(async () => {
    db = openDb(':memory:');
    migrate(db);
    s = seed(db, { passwordHash: hashPassword('custock'), now: clock });
    app = createApp({ db, dev: true, jwtSecret: SECRET, publicWebUrl: 'http://localhost:3000', corsOrigins: [], now: () => clock, rateLimit: false });
    const r = await app.request('/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'eleni@example.com', password: 'custock' }) });
    token = ((await r.json()) as Json).accessToken;
  });

  it("a product's history is that product's own movements, in pages, even in a busy shop", async () => {
    const O = `/v1/orgs/${s.orgId}`;
    const rows = db.prepare(
      `SELECT pv.id AS variant, pv.product_id AS product FROM product_variants pv JOIN products p ON p.id = pv.product_id
        WHERE p.org_id = ? AND p.archived_at IS NULL AND p.uom = 'piece' AND pv.archived_at IS NULL LIMIT 2`,
    ).all(s.orgId) as { variant: string; product: string }[];
    const [quiet, busy] = rows;
    // the quiet product gets 3 sales, then the busy one 60, so the shop's latest 30 are all the busy one
    const sell = (variant: string) => ({ id: id(), shopId: s.shops.kifisia, variantId: variant, qtyDelta: -1, kind: 'sale', occurredAt: clock });
    expect((await call('POST', `${O}/movements`, { movements: [sell(quiet!.variant), sell(quiet!.variant), sell(quiet!.variant)] })).status).toBe(200);
    for (let i = 0; i < 3; i++) {
      await call('POST', `${O}/movements`, { movements: Array.from({ length: 20 }, () => sell(busy!.variant)) });
    }

    const shopLatest = await call('GET', `${O}/movements?shopId=${s.shops.kifisia}&limit=30`);
    expect(shopLatest.body.items.some((m: Json) => m.variantId === quiet!.variant)).toBe(false);

    const own = await call('GET', `${O}/movements?productId=${quiet!.product}&shopId=${s.shops.kifisia}&limit=20`);
    expect(own.status).toBe(200);
    expect(own.body.items.length).toBeGreaterThanOrEqual(3);
    expect(own.body.items.every((m: Json) => m.variantId === quiet!.variant)).toBe(true);

    const first = await call('GET', `${O}/movements?productId=${busy!.product}&limit=20`);
    expect(first.body.items).toHaveLength(20);
    expect(first.body.nextCursor).toBeTruthy();
    const second = await call('GET', `${O}/movements?productId=${busy!.product}&limit=20&cursor=${encodeURIComponent(first.body.nextCursor)}`);
    expect(second.body.items.length).toBeGreaterThan(0);
    const seen = new Set(first.body.items.map((m: Json) => m.id));
    expect(second.body.items.some((m: Json) => seen.has(m.id))).toBe(false);
  });
});
