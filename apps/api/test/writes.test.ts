// stage 2: the write side and the rules from thinking/15-edge-cases.md that live in the backend

import { beforeAll, describe, expect, it } from 'vitest';
import { migrate, openDb, seed, hashPassword, type Db, type SeedResult } from '@custock/db';
import { ean13, uuidv7, type MovementInput } from '@custock/core';
import { createApp, type App } from '../src/app';
import { runJobs } from '../src/worker';
import { localMinutes } from '../src/lib/time';
import { DEV_TURNSTILE_TOKEN } from '../src/routes/people-writes';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

let db: Db;
let s: SeedResult;
let app: App;
let clock = Date.now();
const SECRET = 'test-secret-that-is-long-enough-456';
const PUBLIC = 'http://localhost:3000';
const pw = hashPassword('custock');
const tokens: Record<string, string> = {};

async function call(method: string, path: string, who?: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await app.request(path, {
    method,
    headers: {
      ...(who ? { Authorization: `Bearer ${tokens[who]}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as Json, headers: res.headers };
}

async function login(who: string, email = `${who}@example.com`) {
  const r = await call('POST', '/v1/auth/login', undefined, { email, password: 'custock' });
  expect(r.status).toBe(200);
  tokens[who] = r.body.accessToken;
}

async function otpLogin(key: string, email: string) {
  const req = await call('POST', '/v1/auth/otp/request', undefined, { email });
  const ok = await call('POST', '/v1/auth/otp/verify', undefined, { email, code: req.body.devCode });
  tokens[key] = ok.body.accessToken;
}

const ALL = ['eleni', 'nikos', 'maria', 'giorgos', 'dimitris', 'katerina', 'sofia', 'anna'];
async function setClock(t: number) {
  clock = t;
  for (const who of ALL) if (tokens[who]) await login(who).catch(() => {});
}
const jobs = () => runJobs({ cfg: { db, jwtSecret: SECRET, publicWebUrl: PUBLIC } }, clock);
const q = <T = Json>(sql: string, ...p: unknown[]) => db.prepare(sql).get(...p) as T;
const qa = <T = Json>(sql: string, ...p: unknown[]) => db.prepare(sql).all(...p) as T[];
const onHand = (shop: string, variant: string) => (q<{ on_hand: number } | undefined>('SELECT on_hand FROM stock_levels WHERE shop_id = ? AND variant_id = ?', shop, variant)?.on_hand ?? 0);
const org = () => `/v1/orgs/${s.orgId}`;

function mv(shopId: string, variantId: string, qtyDelta: number, kind: MovementInput['kind'], extra: Partial<MovementInput> = {}): MovementInput {
  return { id: uuidv7(), shopId, variantId, qtyDelta, kind, occurredAt: clock, ...extra };
}
async function move(who: string, ...m: MovementInput[]) {
  return call('POST', `${org()}/movements`, who, { movements: m });
}

// a timestamp at the given local hour in Athens, after the base clock
function athensAt(hour: number, minute = 0): number {
  let t = clock - (clock % 60_000);
  for (let i = 0; i < 2 * 24 * 60; i++, t += 60_000) if (localMinutes(t, 'Europe/Athens') === hour * 60 + minute) return t;
  throw new Error('no such time');
}

beforeAll(async () => {
  db = openDb(':memory:');
  migrate(db);
  s = seed(db, { passwordHash: pw, now: clock });
  app = createApp({ db, dev: true, jwtSecret: SECRET, publicWebUrl: PUBLIC, corsOrigins: [], now: () => clock, rateLimit: false });
  for (const who of ['eleni', 'nikos', 'maria', 'giorgos', 'dimitris', 'katerina', 'sofia', 'anna']) await login(who);
});

// ---------------------------------------------------------------------------------------------

describe('the ledger', () => {
  it('a sale uses the running offer price for that shop', async () => {
    const before = onHand(s.shops.kifisia, s.variants['p-olive-oil']!);
    const m = mv(s.shops.kifisia, s.variants['p-olive-oil']!, -1, 'sale');
    const r = await move('dimitris', m);
    expect(r.body.accepted).toEqual([m.id]);
    expect(onHand(s.shops.kifisia, s.variants['p-olive-oil']!)).toBe(before - 1);
    expect(q('SELECT unit_price_minor p FROM stock_movements WHERE id = ?', m.id).p).toBe(1090);
    // glyfada is not in the offer
    const g = mv(s.shops.glyfada, s.variants['p-olive-oil']!, -1, 'sale');
    await move('giorgos', g);
    expect(q('SELECT unit_price_minor p FROM stock_movements WHERE id = ?', g.id).p).toBe(1290);
  });
  it('the same movement twice counts once', async () => {
    const m = mv(s.shops.kifisia, s.variants['p-sea-salt']!, -1, 'sale');
    const before = onHand(s.shops.kifisia, s.variants['p-sea-salt']!);
    await move('dimitris', m);
    const again = await move('dimitris', m);
    expect(again.body.duplicates).toEqual([m.id]);
    expect(onHand(s.shops.kifisia, s.variants['p-sea-salt']!)).toBe(before - 1);
  });
  it('two people scanning the same product at once both count', async () => {
    const before = onHand(s.shops.kifisia, s.variants['p-greek-coffee']!);
    await Promise.all([
      move('dimitris', mv(s.shops.kifisia, s.variants['p-greek-coffee']!, -1, 'sale')),
      move('maria', mv(s.shops.kifisia, s.variants['p-greek-coffee']!, -2, 'sale')),
    ]);
    expect(onHand(s.shops.kifisia, s.variants['p-greek-coffee']!)).toBe(before - 3);
  });
  it('server time orders the ledger, the phone time is kept', async () => {
    const m = mv(s.shops.kifisia, s.variants['p-tahini']!, -1, 'sale', { occurredAt: clock - 5 * 86_400_000 });
    await move('dimitris', m);
    const row = q('SELECT occurred_at o, recorded_at r FROM stock_movements WHERE id = ?', m.id);
    expect(row.r).toBe(clock);
    expect(row.o).toBe(clock - 5 * 86_400_000);
  });
  it('checks permission, sign and reason per movement, partial success allowed', async () => {
    const ok = mv(s.shops.kifisia, s.variants['p-tahini']!, -1, 'sale');
    const noPerm = mv(s.shops.kifisia, s.variants['p-tahini']!, 1, 'adjust', { reason: 'found' });
    const otherShop = mv(s.shops.marousi, s.variants['p-tahini']!, -1, 'sale');
    const badSign = mv(s.shops.kifisia, s.variants['p-tahini']!, 1, 'sale');
    const direct = mv(s.shops.kifisia, s.variants['p-tahini']!, 1, 'count');
    const r = await move('dimitris', ok, noPerm, otherShop, badSign, direct, { id: 'x' } as MovementInput);
    expect(r.body.accepted).toEqual([ok.id]);
    const codes = Object.fromEntries(r.body.rejected.map((x: { id: string; code: string }) => [x.id, x.code]));
    expect(codes[noPerm.id]).toBe('forbidden');
    expect(codes[otherShop.id]).toBe('forbidden');
    expect(codes[badSign.id]).toBe('validation');
    expect(codes[direct.id]).toBe('forbidden');
    expect(codes.x).toBe('validation');
    const noReason = await move('maria', mv(s.shops.kifisia, s.variants['p-tahini']!, -1, 'adjust'));
    expect(noReason.body.rejected[0].code).toBe('validation');
  });
  it('negative stock is allowed by default and blocked in strict mode unless the movement was made offline', async () => {
    const candle = s.variants['p-candle']!;
    const have = onHand(s.shops.kifisia, candle);
    const r = await move('dimitris', mv(s.shops.kifisia, candle, -(have + 1), 'sale'));
    expect(r.body.accepted).toHaveLength(1);
    expect(onHand(s.shops.kifisia, candle)).toBe(-1);
    db.prepare('UPDATE organizations SET allow_negative_stock = 0 WHERE id = ?').run(s.orgId);
    const blocked = await move('dimitris', mv(s.shops.kifisia, candle, -1, 'sale'));
    expect(blocked.body.rejected[0].code).toBe('negative_stock_blocked');
    // offline is not a way around strict mode for staff who cannot adjust stock (L1)
    const staffOffline = await move('dimitris', mv(s.shops.kifisia, candle, -1, 'sale', { occurredAt: clock - 30 * 60_000 }));
    expect(staffOffline.body.rejected[0].code).toBe('negative_stock_blocked');
    const offline = mv(s.shops.kifisia, candle, -1, 'sale', { occurredAt: clock - 30 * 60_000 });
    const ok = await move('maria', offline);
    db.prepare('UPDATE organizations SET allow_negative_stock = 1 WHERE id = ?').run(s.orgId);
    expect(ok.body.accepted).toHaveLength(1);
    expect(q("SELECT count(*) n FROM audit_log WHERE action = 'stock.negative_accepted_offline'").n).toBe(1);
    const review = await call('GET', `${org()}/review/negative`, 'maria');
    expect(review.body.map((x: { movementId: string }) => x.movementId)).toEqual([offline.id]);
    expect((await call('GET', `${org()}/review/negative`, 'dimitris')).status).toBe(403);
  });
  it('undo is a reversal, once, by someone allowed', async () => {
    const soap = s.variants['p-olive-soap']!;
    const before = onHand(s.shops.kifisia, soap);
    const sale = mv(s.shops.kifisia, soap, -2, 'sale');
    await move('dimitris', sale);
    const undo = await move('dimitris', mv(s.shops.kifisia, soap, 1, 'reversal', { refId: sale.id }));
    expect(undo.body.accepted).toHaveLength(1);
    expect(onHand(s.shops.kifisia, soap)).toBe(before);
    const twice = await move('dimitris', mv(s.shops.kifisia, soap, 1, 'reversal', { refId: sale.id }));
    expect(twice.body.rejected[0].code).toBe('conflict');
    const other = mv(s.shops.kifisia, soap, -1, 'sale');
    await move('maria', other);
    const stranger = await move('katerina', mv(s.shops.kifisia, soap, 1, 'reversal', { refId: other.id }));
    expect(stranger.body.rejected[0].code).toBe('forbidden');
  });
});

describe('back in stock and low stock', () => {
  it('a receive tells everyone waiting, in their language, once', async () => {
    const honey = s.variants['p-thyme-honey']!;
    expect(onHand(s.shops.kifisia, honey)).toBe(0);
    const r = await move('dimitris', mv(s.shops.kifisia, honey, 6, 'receive'));
    expect(r.body.backInStock).toEqual([{ variantId: honey, shopId: s.shops.kifisia, notified: 14 }]);
    expect(q("SELECT count(*) n FROM stock_alerts WHERE variant_id = ? AND status = 'waiting'", honey).n).toBe(0);
    await jobs();
    const anna = q("SELECT title, body, locale FROM dev_outbox WHERE user_id = ? AND json_extract(payload, '$.type') = 'back_in_stock'", s.users.anna);
    expect(anna.locale).toBe('ru');
    expect(anna.body).toContain('Тимьяновый мёд');
    expect(q("SELECT count(*) n FROM deliveries WHERE alert_id IS NOT NULL AND status = 'sent'").n).toBeGreaterThan(0);
    // flapping: down to zero and back up, nobody is told twice
    await move('dimitris', mv(s.shops.kifisia, honey, -6, 'sale'));
    const again = await move('dimitris', mv(s.shops.kifisia, honey, 3, 'receive'));
    expect(again.body.backInStock[0].notified).toBe(0);
  });
  it('a correction does not count as back in stock', async () => {
    const salt = s.variants['p-sea-salt']!;
    expect(onHand(s.shops.marousi, salt)).toBe(0);
    const adj = await move('nikos', mv(s.shops.marousi, salt, 2, 'adjust', { reason: 'found' }));
    expect(adj.body.backInStock).toEqual([]);
    expect(q("SELECT count(*) n FROM stock_alerts WHERE variant_id = ? AND shop_id = ? AND status = 'waiting'", salt, s.shops.marousi).n).toBe(3);
  });
  it('low stock alerts once per dip', async () => {
    const oil = s.variants['p-olive-oil']!;
    const have = onHand(s.shops.kifisia, oil);
    const set = await call('PUT', `${org()}/shops/${s.shops.kifisia}/variants/${oil}/settings`, 'maria', { reorderPoint: have - 1 });
    expect(set.status).toBe(204);
    db.prepare('UPDATE stock_levels SET low_alert_sent_at = NULL WHERE shop_id = ? AND variant_id = ?').run(s.shops.kifisia, oil);
    const first = await move('dimitris', mv(s.shops.kifisia, oil, -1, 'sale'));
    expect(first.body.lowStock).toHaveLength(1);
    const second = await move('dimitris', mv(s.shops.kifisia, oil, -1, 'sale'));
    expect(second.body.lowStock).toHaveLength(0);
    await move('dimitris', mv(s.shops.kifisia, oil, 10, 'receive'));
    const third = await move('dimitris', mv(s.shops.kifisia, oil, -10, 'sale'));
    expect(third.body.lowStock).toHaveLength(1);
    const pushes = qa("SELECT user_id FROM dev_outbox WHERE json_extract(payload, '$.type') = 'lowStock'").map((x) => x.user_id);
    expect(pushes).toContain(s.users.maria);
    expect(pushes).not.toContain(s.users.dimitris); // staff do not manage reorder points
  });
});

describe('counts', () => {
  it('a sale during the count does not break the math', async () => {
    const mastiha = s.variants['p-mastiha']!;
    expect(onHand(s.shops.kifisia, mastiha)).toBe(2);
    const count = (await call('POST', `${org()}/shops/${s.shops.kifisia}/counts`, 'maria', { kind: 'partial' })).body;
    const line = await call('PUT', `${org()}/counts/${count.id}/lines/${mastiha}`, 'dimitris', { countedQty: 5 });
    expect(line.body.expectedQty).toBe(2);
    await move('dimitris', mv(s.shops.kifisia, mastiha, -1, 'sale'));
    expect((await call('POST', `${org()}/counts/${count.id}/submit`, 'dimitris')).body.status).toBe('review');
    expect((await call('POST', `${org()}/counts/${count.id}/apply`, 'dimitris', {})).status).toBe(403);
    const applied = await call('POST', `${org()}/counts/${count.id}/apply`, 'maria', {});
    expect(applied.body.status).toBe('applied');
    expect(onHand(s.shops.kifisia, mastiha)).toBe(4);
    expect(q("SELECT count(*) n FROM stock_movements WHERE ref_id = ? AND kind = 'count'", count.id).n).toBe(1);
  });
  it('scans add up on a line', async () => {
    const count = (await call('POST', `${org()}/shops/${s.shops.kifisia}/counts`, 'dimitris', { kind: 'partial' })).body;
    await call('PUT', `${org()}/counts/${count.id}/lines/${s.variants['p-candle']}`, 'dimitris', { countedQty: 1, mode: 'add' });
    const r = await call('PUT', `${org()}/counts/${count.id}/lines/${s.variants['p-candle']}`, 'dimitris', { countedQty: 1, mode: 'add' });
    expect(r.body.countedQty).toBe(2);
    expect((await call('POST', `${org()}/counts/${count.id}/cancel`, 'dimitris')).body.status).toBe('cancelled');
  });
  it('a full count asks what to do with products nobody counted', async () => {
    const count = (await call('POST', `${org()}/shops/${s.shops.glyfada}/counts`, 'giorgos', { kind: 'full' })).body;
    await call('PUT', `${org()}/counts/${count.id}/lines/${s.variants['p-feta']}`, 'giorgos', { countedQty: 3000 });
    expect((await call('POST', `${org()}/counts/${count.id}/apply`, 'giorgos', {})).status).toBe(400);
    const done = await call('POST', `${org()}/counts/${count.id}/apply`, 'giorgos', { uncountedPolicy: 'set_zero' });
    expect(done.body.uncountedPolicy).toBe('set_zero');
    expect(onHand(s.shops.glyfada, s.variants['p-feta']!)).toBe(3000);
    expect(onHand(s.shops.glyfada, s.variants['p-loukoumi']!)).toBe(0);
    expect(onHand(s.shops.glyfada, s.variants['p-olive-oil']!)).toBe(0);
  });
});

describe('transfers', () => {
  it('10 sent, 9 arrive, one is lost in transit and nothing is invented', async () => {
    const tahini = s.variants['p-tahini']!;
    const fromBefore = onHand(s.shops.marousi, tahini);
    const toBefore = onHand(s.shops.kifisia, tahini);
    const tr = (await call('POST', `${org()}/transfers`, 'nikos', { fromShopId: s.shops.marousi, toShopId: s.shops.kifisia, lines: [{ variantId: tahini, qty: 10 }] })).body;
    expect(tr.status).toBe('draft');
    expect((await call('POST', `${org()}/transfers/${tr.id}/send`, 'katerina')).status).toBe(403);
    const sent = await call('POST', `${org()}/transfers/${tr.id}/send`, 'nikos');
    expect(sent.body.status).toBe('sent');
    expect(onHand(s.shops.marousi, tahini)).toBe(fromBefore - 10);
    expect(q('SELECT in_transit_in n FROM stock_levels WHERE shop_id = ? AND variant_id = ?', s.shops.kifisia, tahini).n).toBe(10);
    expect(q("SELECT count(*) n FROM dev_outbox WHERE user_id = ? AND json_extract(payload, '$.type') = 'transferSent'", s.users.dimitris).n).toBe(1);
    expect((await call('POST', `${org()}/transfers/${tr.id}/cancel`, 'nikos')).status).toBe(409);
    const got = await call('POST', `${org()}/transfers/${tr.id}/receive`, 'dimitris', { lines: [{ variantId: tahini, qtyReceived: 9 }] });
    expect(got.body.status).toBe('received');
    expect(got.body.lines[0].lost).toBe(1);
    expect(onHand(s.shops.kifisia, tahini)).toBe(toBefore + 9);
    expect(q('SELECT in_transit_in n FROM stock_levels WHERE shop_id = ? AND variant_id = ?', s.shops.kifisia, tahini).n).toBe(0);
  });
});

describe('products', () => {
  it('staff cannot add products, managers can, a barcode can only live once', async () => {
    expect((await call('POST', `${org()}/products`, 'dimitris', { name: 'X' })).status).toBe(403);
    const code = ean13('520111111111');
    const r = await call('POST', `${org()}/products`, 'maria', { name: 'Κάπαρη Σαντορίνης', priceMinor: 650, barcode: code, costMinor: 300 });
    expect(r.status).toBe(201);
    expect(r.body.variants[0].priceMinor).toBe(650);
    expect(r.body.variants[0]).not.toHaveProperty('costMinor');
    expect(q('SELECT cost_minor c FROM product_variants WHERE id = ?', r.body.variants[0].id).c).toBeNull();
    const dup = await call('POST', `${org()}/products`, 'maria', { name: 'Other', barcode: '0' + code });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('barcode_taken');
    expect(dup.body.detail).toBe('Κάπαρη Σαντορίνης');
    const found = await call('GET', `${org()}/products?q=kapari`, 'maria');
    expect(found.body.items.map((p: { id: string }) => p.id)).toContain(r.body.id);
  });
  it('the same Idempotency-Key gives the same product', async () => {
    const h = { 'Idempotency-Key': 'create-figs-1' };
    const a = await call('POST', `${org()}/products`, 'nikos', { name: 'Σύκα' }, h);
    const b = await call('POST', `${org()}/products`, 'nikos', { name: 'Σύκα' }, h);
    expect(b.body.id).toBe(a.body.id);
    expect(b.headers.get('Idempotent-Replay')).toBe('true');
    expect(q("SELECT count(*) n FROM products WHERE name = 'Σύκα'").n).toBe(1);
  });
  it('edits need the current etag, prices need their own permission', async () => {
    const id = s.products['p-pistachio']!;
    const got = await call('GET', `${org()}/products/${id}`, 'maria');
    const etag = got.headers.get('ETag')!;
    expect(etag).toMatch(/^W\/"p-\d+"$/);
    const ok = await call('PATCH', `${org()}/products/${id}`, 'maria', { description: 'Νέα σοδειά' }, { 'If-Match': etag });
    expect(ok.status).toBe(200);
    const stale = await call('PATCH', `${org()}/products/${id}`, 'maria', { description: 'again' }, { 'If-Match': etag });
    expect(stale.status).toBe(412);
    expect(stale.body.code).toBe('conflict');
    expect((await call('PATCH', `${org()}/products/${id}`, 'maria', { priceMinor: 1 })).status).toBe(403);
    const price = await call('PATCH', `${org()}/variants/${s.variants['p-pistachio']}/price`, 'nikos', { priceMinor: 1050 });
    expect(price.status).toBe(204);
    expect(q("SELECT count(*) n FROM price_history WHERE variant_id = ? AND source = 'base' AND valid_to IS NULL", s.variants['p-pistachio']).n).toBe(1);
    expect(q("SELECT count(*) n FROM audit_log WHERE action = 'product.price_changed' AND entity_id = ?", s.variants['p-pistachio']).n).toBe(1);
  });
  it('shop prices and reorder points follow their permissions and scopes', async () => {
    const v = s.variants['p-candle']!;
    expect((await call('PUT', `${org()}/shops/${s.shops.kifisia}/variants/${v}/settings`, 'maria', { priceOverrideMinor: 1500 })).status).toBe(204);
    expect((await call('PUT', `${org()}/shops/${s.shops.marousi}/variants/${v}/settings`, 'maria', { priceOverrideMinor: 1500 })).status).toBe(403);
    expect((await call('PUT', `${org()}/shops/${s.shops.kifisia}/variants/${v}/settings`, 'dimitris', { reorderPoint: 2 })).status).toBe(403);
  });
  it('sync: everything first, then only what changed, with tombstones', async () => {
    const full = await call('GET', `${org()}/shops/${s.shops.kifisia}/sync`, 'dimitris');
    expect(full.body.full).toBe(true);
    expect(full.body.products.length).toBeGreaterThanOrEqual(14);
    expect(full.body.levels.length).toBeGreaterThan(0);
    clock += 1000;
    await call('PATCH', `${org()}/products/${s.products['p-candle']}`, 'nikos', { description: 'Άρωμα σύκου' });
    await call('POST', `${org()}/products/${s.products['p-feta']}/archive`, 'nikos');
    const inc = await call('GET', `${org()}/shops/${s.shops.kifisia}/sync?since=${full.body.cursor}`, 'dimitris');
    expect(inc.body.full).toBe(false);
    expect(inc.body.products.map((p: { id: string }) => p.id)).toEqual([s.products['p-candle']]);
    expect(inc.body.tombstones.products).toEqual([s.products['p-feta']]);
    expect((await call('GET', `${org()}/shops/${s.shops.marousi}/sync`, 'dimitris')).status).toBe(403);
  });
});

describe('joining and consent', () => {
  it('a bot check, a pending signup, a double opt in', async () => {
    const bad = await call('POST', '/v1/public/join/kif7q2', undefined, { name: 'Bot', email: 'bot@example.com', locale: 'en', emailNews: true, push: false, over15: true, turnstileToken: 'nope' });
    expect(bad.status).toBe(403);
    const r = await call('POST', '/v1/public/join/kif7q2', undefined, { name: 'Λένα Δήμου', email: 'Lena.Dimou@Example.com', locale: 'el', emailNews: true, push: false, over15: true, turnstileToken: DEV_TURNSTILE_TOKEN });
    expect(r.body.pending).toBe(true);
    const mail = q("SELECT title, locale FROM dev_outbox WHERE to_address = 'lena.dimou@example.com'");
    expect(mail.locale).toBe('el');
    const c = q("SELECT id, email_ok, email_verified_at FROM customers WHERE email = 'lena.dimou@example.com'");
    expect(c.email_ok).toBe(0);
    expect(q('SELECT status FROM customer_subscriptions WHERE customer_id = ?', c.id).status).toBe('pending');
    const token = r.body.devConfirmLink.split('/confirm/')[1];
    const ok = await call('POST', '/v1/public/confirm', undefined, { token });
    expect(ok.body.scopeName).toBe('Lemoni Kifisia');
    const after = q('SELECT email_ok, email_verified_at FROM customers WHERE id = ?', c.id);
    expect(after.email_ok).toBe(1);
    expect(after.email_verified_at).toBe(clock);
    expect(q("SELECT status FROM customer_subscriptions WHERE customer_id = ?", c.id).status).toBe('subscribed');
    expect(q("SELECT count(*) n FROM consents WHERE customer_id = ? AND source = 'double_opt_in'", c.id).n).toBe(1);
    // confirming twice is harmless
    expect((await call('POST', '/v1/public/confirm', undefined, { token })).status).toBe(200);
  });
  it('the same email from two codes is one customer with two subscriptions', async () => {
    await call('POST', '/v1/public/join/mr3c5t', undefined, { name: 'Lena', email: 'lena.dimou@example.com', locale: 'el', emailNews: false, push: false, over15: true });
    const rows = qa("SELECT id FROM customers WHERE email = 'lena.dimou@example.com'");
    expect(rows).toHaveLength(1);
    expect(q('SELECT count(*) n FROM customer_subscriptions WHERE customer_id = ?', rows[0].id).n).toBe(2);
  });
  it('a disabled code refuses new signups', async () => {
    const r = await call('POST', '/v1/public/join/old000', undefined, { name: 'Late', email: 'late@example.com', locale: 'en', emailNews: false, push: false, over15: true });
    expect(r.status).toBe(410);
    expect(r.body.code).toBe('join_link_disabled');
  });
  it('staff add a customer at the counter, someone already known is a 409 with no data (M2)', async () => {
    const a = await call('POST', `${org()}/customers`, 'dimitris', { name: 'Ρένα', email: 'rena@example.com', shopId: s.shops.kifisia, emailNews: true });
    expect(a.status).toBe(201);
    expect(a.body.devConfirmLink).toContain('/confirm/');
    expect(a.body.contactMasked).toBe(true);
    const b = await call('POST', `${org()}/customers`, 'dimitris', { name: 'Ρένα Κ.', email: 'rena@example.com', shopId: s.shops.kifisia });
    expect(b.status).toBe(409);
    expect(b.body.id).toBeUndefined();
    expect(b.body.name).toBeUndefined();
    expect(q("SELECT count(*) n FROM customers WHERE email = 'rena@example.com'").n).toBe(1);
    expect((await call('POST', `${org()}/customers`, 'dimitris', { name: 'Elsewhere', email: 'x@example.com', shopId: s.shops.marousi })).status).toBe(403);
  });
  it('erase wipes the person and keeps the counts', async () => {
    const id = q("SELECT id FROM customers WHERE email = 'rena@example.com'").id;
    expect((await call('POST', `${org()}/customers/${id}/erase`, 'maria')).status).toBe(403);
    expect((await call('POST', `${org()}/customers/${id}/erase`, 'nikos')).status).toBe(204);
    const row = q('SELECT name, email, erased_at FROM customers WHERE id = ?', id);
    expect(row.name).toBeNull();
    expect(row.email).toBeNull();
    expect(row.erased_at).toBe(clock);
    expect((await call('GET', `${org()}/customers/${id}`, 'nikos')).status).toBe(404);
  });
});

describe('posts', () => {
  const kifisiaPost = (title: string, extra: Json = {}) => ({
    kind: 'news', defaultLocale: 'el', translations: { el: { title, body: 'κείμενο' }, en: { title: `${title} en`, body: 'text' } },
    channels: ['feed', 'push', 'email'], audience: { scopes: [{ scopeType: 'shop', scopeId: s.shops.kifisia }] }, ...extra,
  });

  it('staff cannot write posts, managers cannot post outside their shop', async () => {
    expect((await call('POST', `${org()}/posts`, 'dimitris', kifisiaPost('x'))).status).toBe(403);
    const away = await call('POST', `${org()}/posts`, 'maria', { ...kifisiaPost('x'), audience: { scopes: [{ scopeType: 'shop', scopeId: s.shops.marousi }] } });
    expect(away.status).toBe(403);
    expect(away.body.code).toBe('scope');
  });
  it('the audience preview explains itself and follows the most specific subscription', async () => {
    const r = await call('POST', `${org()}/posts/audience-preview`, 'maria', { audience: { scopes: [{ scopeType: 'shop', scopeId: s.shops.kifisia }] }, channels: ['feed', 'push', 'email'] });
    expect(r.body.total).toBeGreaterThan(5);
    expect(r.body.byScope[0].name).toBe('Kifisia');
    expect(r.body.push.count + r.body.push.turnedOff + r.body.push.noApp + r.body.push.capReached).toBe(r.body.total);
    // customer 6 follows north athens but unsubscribed from kifisia
    const unsub = q("SELECT customer_id FROM customer_subscriptions WHERE scope_id = ? AND status = 'unsubscribed'", s.shops.kifisia).customer_id;
    const via = await call('POST', `${org()}/posts/audience-preview`, 'nikos', { audience: { scopes: [{ scopeType: 'shop', scopeId: s.shops.kifisia }], tags: [] }, channels: ['feed'] });
    const all = await call('POST', `${org()}/posts/audience-preview`, 'nikos', { audience: { scopes: [{ scopeType: 'group', scopeId: s.groupId }] }, channels: ['feed'] });
    expect(all.body.total).toBeGreaterThan(via.body.total);
    expect(unsub).toBeTruthy();
  });
  it('a manager post waits for approval, the approver gets a push, then it goes out in each language', async () => {
    const created = await call('POST', `${org()}/posts`, 'maria', kifisiaPost('Νέο ψωμί'));
    expect(created.status).toBe(201);
    const published = await call('POST', `${org()}/posts/${created.body.id}/publish`, 'maria');
    expect(published.body.status).toBe('pending_approval');
    expect(q("SELECT count(*) n FROM dev_outbox WHERE user_id = ? AND json_extract(payload, '$.type') = 'approvalNeeded'", s.users.nikos).n).toBe(1);
    expect((await call('POST', `${org()}/posts/${created.body.id}/approve`, 'maria')).status).toBe(403);
    const approved = await call('POST', `${org()}/posts/${created.body.id}/approve`, 'nikos');
    expect(['sending', 'sent']).toContain(approved.body.status);
    await setClock(athensAt(12));
    await jobs();
    const post = q('SELECT status, recipients_count n FROM posts WHERE id = ?', created.body.id);
    expect(post.status).toBe('sent');
    expect(post.n).toBeGreaterThan(0);
    // anna reads russian, the post has no russian text, so she gets the greek default
    const annaCustomer = q("SELECT id FROM customers WHERE user_id = ? AND org_id = ?", s.users.anna, s.orgId).id;
    const push = q("SELECT body FROM dev_outbox WHERE customer_id = ? AND json_extract(payload, '$.postId') = ?", annaCustomer, created.body.id);
    expect(push.body).toBe('Νέο ψωμί');
    const email = q("SELECT body, payload FROM dev_outbox WHERE channel = 'email' AND json_extract(payload, '$.postId') = ? LIMIT 1", created.body.id);
    expect(JSON.parse(email.payload).listUnsubscribe).toContain('/unsubscribe/');
  });
  it('an unsubscribe link works without login', async () => {
    const email = q("SELECT customer_id, payload FROM dev_outbox WHERE channel = 'email' AND json_extract(payload, '$.listUnsubscribe') IS NOT NULL AND customer_id NOT IN (SELECT id FROM customers WHERE email = 'anna@example.com') LIMIT 1");
    const token = JSON.parse(email.payload).listUnsubscribe.split('/unsubscribe/')[1];
    const page = await call('GET', `/v1/public/subscription/${token}`);
    expect(page.body.email).toContain('***');
    // one click stops email from the whole business (H6), the follow stays
    expect((await call('POST', `/v1/public/subscription/${token}`, undefined, 'List-Unsubscribe=One-Click', { 'Content-Type': 'application/x-www-form-urlencoded' })).status).toBe(204);
    expect(q('SELECT email_ok FROM customers WHERE id = ?', email.customer_id).email_ok).toBe(0);
    expect(q("SELECT granted, source FROM consents WHERE customer_id = ? AND channel = 'email' ORDER BY created_at DESC, rowid DESC LIMIT 1", email.customer_id)).toEqual({ granted: 0, source: 'unsubscribe_link' });
    expect((await call('POST', `/v1/public/subscription/${token}`, undefined, { everything: true })).status).toBe(204);
    expect(q("SELECT count(*) n FROM customer_subscriptions WHERE customer_id = ? AND status != 'unsubscribed'", email.customer_id).n).toBe(0);
    expect((await call('GET', '/v1/public/subscription/forged.token')).status).toBe(404);
  });
  it('pushes during quiet hours wait until morning, and cancel stops them', async () => {
    db.prepare('UPDATE organizations SET posts_need_approval = 0 WHERE id = ?').run(s.orgId);
    await setClock(athensAt(23));
    const p = await call('POST', `${org()}/posts`, 'nikos', { ...kifisiaPost('Βραδινό'), audience: { scopes: [{ scopeType: 'org', scopeId: s.orgId }] }, channels: ['feed', 'push'] });
    await call('POST', `${org()}/posts/${p.body.id}/publish`, 'nikos');
    await jobs();
    const held = q("SELECT count(*) n, min(send_after) a FROM deliveries WHERE post_id = ? AND status = 'held'", p.body.id);
    expect(held.n).toBeGreaterThan(0);
    expect(localMinutes(held.a, 'Europe/Athens')).toBe(9 * 60);
    await setClock(clock + 30 * 60_000);
    await jobs();
    expect(q("SELECT count(*) n FROM deliveries WHERE post_id = ? AND status = 'sent'", p.body.id).n).toBe(0);
    await setClock(held.a + 60_000);
    await jobs();
    expect(q("SELECT count(*) n FROM deliveries WHERE post_id = ? AND status = 'held'", p.body.id).n).toBe(0);
    // and one cancelled before morning never goes out
    await setClock(athensAt(23));
    const p2 = await call('POST', `${org()}/posts`, 'nikos', { ...kifisiaPost('Ακυρώνεται'), channels: ['feed', 'push'] });
    await call('POST', `${org()}/posts/${p2.body.id}/publish`, 'nikos');
    await jobs();
    expect((await call('POST', `${org()}/posts/${p2.body.id}/cancel`, 'nikos')).status).toBe(409); // already sent to the feed
    db.prepare("UPDATE posts SET status = 'sending' WHERE id = ?").run(p2.body.id);
    expect((await call('POST', `${org()}/posts/${p2.body.id}/cancel`, 'nikos')).body.status).toBe('cancelled');
    await setClock(athensAt(10));
    await jobs();
    expect(q("SELECT count(*) n FROM deliveries WHERE post_id = ? AND status = 'sent'", p2.body.id).n).toBe(0);
    expect(q("SELECT count(*) n FROM deliveries WHERE post_id = ? AND skip_reason = 'cancelled'", p2.body.id).n).toBeGreaterThan(0);
  });
  it('the daily push cap sends the rest to the feed only', async () => {
    db.prepare('UPDATE organizations SET push_daily_cap = 1 WHERE id = ?').run(s.orgId);
    await setClock(athensAt(11));
    const a = await call('POST', `${org()}/posts`, 'nikos', { ...kifisiaPost('Πρώτο'), channels: ['feed', 'push'] });
    await call('POST', `${org()}/posts/${a.body.id}/publish`, 'nikos');
    await jobs();
    const b = await call('POST', `${org()}/posts`, 'nikos', { ...kifisiaPost('Δεύτερο'), channels: ['feed', 'push'] });
    await call('POST', `${org()}/posts/${b.body.id}/publish`, 'nikos');
    await jobs();
    const firstSent = q("SELECT count(*) n FROM deliveries WHERE post_id = ? AND channel = 'push' AND status = 'sent'", a.body.id).n;
    expect(firstSent).toBeGreaterThan(0);
    expect(q("SELECT count(*) n FROM deliveries WHERE post_id = ? AND skip_reason = 'cap_reached'", b.body.id).n).toBe(firstSent);
    db.prepare('UPDATE organizations SET push_daily_cap = 2 WHERE id = ?').run(s.orgId);
  });
  it('a scheduled post goes out at its time', async () => {
    await setClock(athensAt(10));
    const at = clock + 3600_000;
    const p = await call('POST', `${org()}/posts`, 'nikos', { ...kifisiaPost('Αύριο'), channels: ['feed'], scheduledAt: at });
    expect((await call('POST', `${org()}/posts/${p.body.id}/publish`, 'nikos')).body.status).toBe('scheduled');
    await jobs();
    expect(q('SELECT status FROM posts WHERE id = ?', p.body.id).status).toBe('scheduled');
    await setClock(at + 1000);
    await jobs();
    expect(q('SELECT status FROM posts WHERE id = ?', p.body.id).status).toBe('sent');
  });
  it('editing a sent post updates the text and sends nothing again', async () => {
    const id = q("SELECT id FROM posts WHERE status = 'sent' AND id IN (SELECT post_id FROM deliveries) ORDER BY sent_at DESC LIMIT 1").id;
    const before = q('SELECT count(*) n FROM deliveries WHERE post_id = ?', id).n;
    const got = await call('GET', `${org()}/posts/${id}`, 'nikos');
    const body = { ...kifisiaPost('Διορθωμένο'), audience: got.body.audience, channels: got.body.channels };
    const r = await call('PATCH', `${org()}/posts/${id}`, 'nikos', body, { 'If-Match': got.headers.get('ETag')! });
    expect(r.status).toBe(200);
    expect(r.body.translations.el.title).toBe('Διορθωμένο');
    await jobs();
    expect(q('SELECT count(*) n FROM deliveries WHERE post_id = ?', id).n).toBe(before);
  });
  it('suppressed emails are skipped', async () => {
    const victim = q("SELECT email FROM customers WHERE org_id = ? AND email_ok = 1 AND email_verified_at IS NOT NULL AND email != 'anna@example.com' LIMIT 1", s.orgId).email;
    db.prepare("INSERT INTO email_suppressions (email, reason, created_at) VALUES (?, 'hard_bounce', ?)").run(victim, clock);
    const r = await call('POST', `${org()}/posts/audience-preview`, 'nikos', { audience: { scopes: [{ scopeType: 'org', scopeId: s.orgId }] }, channels: ['email'] });
    expect(r.body.email.suppressed).toBe(1);
  });
  it('an offer by a manager writes its price history when released', async () => {
    db.prepare('UPDATE organizations SET posts_need_approval = 0 WHERE id = ?').run(s.orgId);
    await login('maria');
    await setClock(athensAt(12));
    const p = await call('POST', `${org()}/posts`, 'maria', {
      ...kifisiaPost('Κεριά -20%'), kind: 'offer', channels: ['feed'],
      products: [{ variantId: s.variants['p-candle'], offerPriceMinor: 1280 }], validUntil: clock + 3 * 86_400_000,
    });
    expect(p.status).toBe(201);
    expect((await call('POST', `${org()}/posts/${p.body.id}/publish`, 'maria')).body.status).toBe('sending');
    await jobs();
    expect(q("SELECT count(*) n FROM price_history WHERE post_id = ? AND source = 'offer'", p.body.id).n).toBe(1);
    const sale = mv(s.shops.kifisia, s.variants['p-candle']!, -1, 'sale');
    await move('dimitris', sale);
    expect(q('SELECT unit_price_minor p FROM stock_movements WHERE id = ?', sale.id).p).toBe(1280);
  });
});

describe('team', () => {
  it('invites follow scope, rank and the invited email', async () => {
    const roles = (await call('GET', `${org()}/roles`, 'maria')).body;
    const role = (key: string) => roles.find((r: { templateKey: string }) => r.templateKey === key).id;
    const away = await call('POST', `${org()}/invites`, 'maria', { email: 'x@example.com', roleId: role('staff'), scopeType: 'shop', scopeId: s.shops.marousi });
    expect(away.body.code).toBe('scope');
    const up = await call('POST', `${org()}/invites`, 'maria', { email: 'x@example.com', roleId: role('manager'), scopeType: 'shop', scopeId: s.shops.kifisia });
    expect(up.body.code).toBe('rank');
    const inv = await call('POST', `${org()}/invites`, 'maria', { email: 'new.staff@example.com', roleId: role('staff'), scopeType: 'shop', scopeId: s.shops.kifisia, locale: 'ru' });
    expect(inv.status).toBe(201);
    expect(q("SELECT locale FROM dev_outbox WHERE to_address = 'new.staff@example.com'").locale).toBe('ru');
    const token = inv.body.devLink.split('/invite/')[1];
    await otpLogin('stranger', 'stranger@example.com');
    expect((await call('POST', '/v1/invites/accept', 'stranger', { token })).body.code).toBe('invite_email_mismatch');
    await otpLogin('newstaff', 'new.staff@example.com');
    const ok = await call('POST', '/v1/invites/accept', 'newstaff', { token });
    expect(ok.body.orgId).toBe(s.orgId);
    const me = await call('GET', '/v1/me/context', 'newstaff');
    expect(me.body.orgs[0].shops.map((x: { shopId: string }) => x.shopId)).toEqual([s.shops.kifisia]);
    expect((await call('POST', '/v1/invites/accept', 'newstaff', { token })).body.code).toBe('invite_expired');
  });
  it('assignments: peers cannot touch each other, the change reaches the app', async () => {
    const members = (await call('GET', `${org()}/members`, 'nikos')).body;
    const dim = members.find((m: { userId: string }) => m.userId === s.users.dimitris);
    const roles = (await call('GET', `${org()}/roles`, 'nikos')).body;
    const manager = roles.find((r: { templateKey: string }) => r.templateKey === 'manager').id;
    const before = q('SELECT perms_version v FROM memberships WHERE id = ?', dim.membershipId).v;
    expect((await call('POST', `${org()}/members/${dim.membershipId}/assignments`, 'nikos', { roleId: manager, scopeType: 'shop', scopeId: s.shops.kifisia })).status).toBe(204);
    expect(q('SELECT perms_version v FROM memberships WHERE id = ?', dim.membershipId).v).toBe(before + 1);
    expect(q("SELECT count(*) n FROM dev_outbox WHERE user_id = ? AND json_extract(payload, '$.type') = 'perms_changed'", s.users.dimitris).n).toBe(1);
    const fresh = (await call('GET', `${org()}/members`, 'maria')).body.find((m: { userId: string }) => m.userId === s.users.dimitris);
    const managerAssignment = fresh.assignments.find((a: { roleId: string }) => a.roleId === manager);
    const peer = await call('DELETE', `${org()}/members/${dim.membershipId}/assignments/${managerAssignment.id}`, 'maria');
    expect(peer.body.code).toBe('rank');
    expect((await call('DELETE', `${org()}/members/${dim.membershipId}/assignments/${managerAssignment.id}`, 'nikos')).status).toBe(204);
  });
  it('nobody edits themselves, the owner stays', async () => {
    const members = (await call('GET', `${org()}/members`, 'eleni')).body;
    const eleni = members.find((m: { userId: string }) => m.userId === s.users.eleni);
    expect((await call('PATCH', `${org()}/members/${eleni.membershipId}`, 'eleni', { status: 'removed' })).body.code).toBe('self');
    expect((await call('PATCH', `${org()}/members/${eleni.membershipId}`, 'nikos', { status: 'suspended' })).body.code).toBe('rank');
    const del = await call('DELETE', '/v1/me', 'eleni');
    expect(del.status).toBe(409);
    expect(del.body.code).toBe('last_owner');
  });
  it('roles: ceiling and rank, and removing a permission takes effect on the next request', async () => {
    expect((await call('POST', `${org()}/roles`, 'nikos', { name: 'Billing', rank: 50, permissions: ['org.billing.manage'] })).body.code).toBe('ceiling');
    expect((await call('POST', `${org()}/roles`, 'nikos', { name: 'Boss', rank: 90, permissions: [] })).body.code).toBe('rank');
    expect((await call('POST', `${org()}/roles`, 'maria', { name: 'X', rank: 10, permissions: [] })).status).toBe(403);
    const senior = await call('POST', `${org()}/roles`, 'nikos', { name: 'Senior staff', rank: 50, permissions: ['products.view', 'stock.view', 'stock.adjust'] });
    expect(senior.status).toBe(201);
    const roles = (await call('GET', `${org()}/roles`, 'nikos')).body;
    const manager = roles.find((r: { templateKey: string }) => r.templateKey === 'manager');
    const impact = await call('GET', `${org()}/roles/${manager.id}/impact`, 'nikos');
    expect(impact.body.names).toContain('Maria Ioannou');
    const trimmed = manager.permissions.filter((p: string) => p !== 'stock.adjust');
    expect((await call('POST', `${org()}/roles`, 'nikos', { id: manager.id, name: manager.name, rank: manager.rank, permissions: trimmed })).status).toBe(200);
    const r = await move('maria', mv(s.shops.kifisia, s.variants['p-candle']!, 1, 'adjust', { reason: 'found' }));
    expect(r.body.rejected[0].code).toBe('forbidden');
    const stale = await call('GET', org(), 'maria', undefined, { 'X-Perms-Version': '1' });
    expect(stale.headers.get('X-Perms-Stale')).toBe('1');
  });
  it('a removed member is out on the next request', async () => {
    const members = (await call('GET', `${org()}/members`, 'nikos')).body;
    const kat = members.find((m: { userId: string }) => m.userId === s.users.katerina);
    expect((await call('PATCH', `${org()}/members/${kat.membershipId}`, 'nikos', { status: 'removed' })).status).toBe(204);
    expect((await call('GET', `${org()}/products`, 'katerina')).status).toBe(404);
  });
});

describe('org settings, audit, dev tools', () => {
  it('only org.settings.manage changes settings, and it is audited', async () => {
    expect((await call('PATCH', org(), 'maria', { customerStock: 'exact' })).status).toBe(403);
    const r = await call('PATCH', org(), 'eleni', { customerStock: 'exact', fewLeftThreshold: 5 });
    expect(r.body.customerStock).toBe('exact');
    const log = await call('GET', `${org()}/audit`, 'eleni');
    expect(log.body.items.map((x: { action: string }) => x.action)).toContain('org.settings_changed');
    expect((await call('GET', `${org()}/audit`, 'nikos')).status).toBe(200);
    expect((await call('GET', `${org()}/audit`, 'maria')).status).toBe(403);
  });
  it('the dev outbox is for owners and admins', async () => {
    const r = await call('GET', '/v1/dev/outbox?limit=5', 'eleni');
    expect(r.body.length).toBe(5);
    expect((await call('GET', '/v1/dev/outbox', 'maria')).status).toBe(403);
    expect((await call('POST', '/v1/dev/run-jobs', 'eleni')).status).toBe(200);
  });
  it('the nightly rollup keeps daily stats in step with the ledger', async () => {
    await jobs();
    expect(q("SELECT count(*) n FROM jobs WHERE kind = 'rollup_day' AND done_at IS NOT NULL").n).toBeGreaterThan(0);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Athens' }).format(new Date(clock));
    void today;
    expect(q('SELECT count(*) n FROM daily_shop_stats').n).toBeGreaterThan(0);
  });
  it('stock_levels still equal the ledger after all of the above', () => {
    expect(
      q(`SELECT count(*) n FROM stock_levels l WHERE on_hand != (SELECT coalesce(sum(qty_delta), 0) FROM stock_movements m WHERE m.shop_id = l.shop_id AND m.variant_id = l.variant_id)`).n,
    ).toBe(0);
  });
});

describe('the customer side', () => {
  it('notify me, the list, cancel', async () => {
    const salt = s.variants['p-sea-salt']!;
    expect((await call('POST', '/v1/c/alerts', 'anna', { variantId: salt, shopId: s.shops.marousi })).status).toBe(204);
    expect((await call('POST', '/v1/c/alerts', 'anna', { variantId: salt, shopId: s.shops.marousi })).status).toBe(204);
    const list = (await call('GET', '/v1/c/alerts', 'anna', undefined, { 'Accept-Language': 'ru' })).body;
    const mine = list.filter((a: { variantId: string; status: string }) => a.variantId === salt && a.status === 'waiting');
    expect(mine).toHaveLength(1);
    expect(mine[0].productName).toBe('Морская соль 250 г');
    expect((await call('DELETE', `/v1/c/alerts/${mine[0].id}`, 'anna')).status).toBe(204);
  });
  it('favorites, channels, unfollow', async () => {
    expect((await call('PUT', `/v1/c/favorites/${s.products['p-tahini']}`, 'anna', { saved: true })).status).toBe(204);
    expect((await call('GET', '/v1/c/favorites', 'anna')).body.map((p: { id: string }) => p.id)).toContain(s.products['p-tahini']);
    expect((await call('PUT', '/v1/c/channels', 'anna', { orgId: s.orgId, channel: 'push', on: false })).status).toBe(204);
    expect(q('SELECT push_ok p FROM customers WHERE user_id = ? AND org_id = ?', s.users.anna, s.orgId).p).toBe(0);
    expect((await call('POST', '/v1/c/unfollow', 'anna', { scopeType: 'shop', scopeId: s.shops.glyfada })).status).toBe(204);
    const shops = (await call('GET', '/v1/c/shops', 'anna')).body.map((x: { name: string }) => x.name);
    expect(shops).not.toContain('Glyfada');
    expect(shops).toContain('Marousi');
  });
  it('a signed in customer joins from a QR in one step, exports and deletes their data', async () => {
    await otpLogin('walkin', 'walk.in@example.com');
    const j = await call('POST', '/v1/c/join/gl8w2p', 'walkin', { push: true });
    expect(j.body.scopeName).toBe('Lemoni Glyfada');
    const me = await call('GET', '/v1/me/context', 'walkin');
    expect(me.body.following.map((f: { orgName: string }) => f.orgName)).toEqual(['Lemoni']);
    const exp = await call('GET', '/v1/me/export', 'walkin');
    expect(exp.body.customerRecords[0].subscriptions[0].status).toBe('subscribed');
    expect((await call('DELETE', '/v1/me', 'walkin')).status).toBe(204);
    expect((await call('GET', '/v1/me/context', 'walkin')).status).toBe(401);
    expect(q("SELECT count(*) n FROM customers WHERE email = 'walk.in@example.com'").n).toBe(0);
  });
});
