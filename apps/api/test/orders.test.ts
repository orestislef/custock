// orders and price requests end to end (thinking/19-orders.md): the quote flow and the priced flow,
// prices that changed, limits, orders switched off at every level, who sees and does what, two taps
// at once, prices that run out, what confirmed orders hold of the stock, and the messages each step
// sends, to whom and in which language.

import { beforeAll, describe, expect, it } from 'vitest';
import { migrate, openDb, seed, hashPassword, type Db, type SeedResult } from '@custock/db';
import { createApp, type App } from '../src/app';
import { runJobs } from '../src/worker';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

let db: Db;
let s: SeedResult;
let app: App;
let clock = Date.now();
const SECRET = 'orders-test-secret-that-is-long-enough';
const WEB = 'http://localhost:3000';
const tokens: Record<string, string> = {};
const HOUR = 3600_000;

async function call(method: string, path: string, who?: string, body?: unknown) {
  const res = await app.request(path, {
    method,
    headers: { ...(who ? { Authorization: `Bearer ${tokens[who]}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as Json };
}

const q = <T = Json>(sql: string, ...p: unknown[]) => db.prepare(sql).get(...p) as T;
const qa = <T = Json>(sql: string, ...p: unknown[]) => db.prepare(sql).all(...p) as T[];
const org = () => `/v1/orgs/${s.orgId}`;
const shop = (key: 'kifisia' | 'marousi' | 'glyfada') => s.shops[key];
const onHand = (shopId: string, variantId: string) => q<{ on_hand: number } | undefined>('SELECT on_hand FROM stock_levels WHERE shop_id = ? AND variant_id = ?', shopId, variantId)?.on_hand ?? 0;
// the outbox stamps rows with the real time, so a test marks where it starts by row
const mark = () => q<{ n: number | null }>('SELECT max(rowid) AS n FROM dev_outbox').n ?? 0;
const outbox = (type: string, after: number) => qa("SELECT * FROM dev_outbox WHERE json_extract(payload, '$.type') = ? AND rowid > ? ORDER BY rowid", type, after);
let annaName = '';
const setMode = (mode: 'off' | 'quote' | 'priced') => call('PATCH', org(), 'eleni', { customerOrders: mode });
const setPolicy = (patch: Record<string, unknown>) => call('PATCH', `${org()}/policies`, 'eleni', patch);

// time moves on: sign everyone in again, access tokens live 15 minutes
async function jump(ms: number) {
  clock += ms;
  for (const who of ['eleni', 'maria', 'giorgos', 'dimitris', 'sofia', 'anna']) await login(who);
  const code = (await call('POST', '/v1/auth/otp/request', undefined, { email: 'buyer@example.com', locale: 'en' })).body.devCode;
  tokens.buyer = (await call('POST', '/v1/auth/otp/verify', undefined, { email: 'buyer@example.com', code })).body.accessToken;
}

async function login(who: string, email = `${who}@example.com`) {
  const r = await call('POST', '/v1/auth/login', undefined, { email, password: 'custock' });
  expect(r.status).toBe(200);
  tokens[who] = r.body.accessToken;
}

async function preview(who: string, shopId: string, lines: { variantId: string; qty: number }[]) {
  return call('POST', '/v1/c/orgs/lemoni/orders/preview', who, { shopId, lines });
}

// what the app does: price the lines for that shop, then send them with the prices it showed
async function place(who: string, shopId: string, lines: { variantId: string; qty: number }[], extra: Record<string, unknown> = {}) {
  const p = await preview(who, shopId, lines);
  expect(p.status, JSON.stringify(p.body)).toBe(200);
  return call('POST', '/v1/c/orgs/lemoni/orders', who, {
    shopId, lines: lines.map((l, i) => ({ ...l, seenUnitPriceMinor: p.body.lines[i].unitPriceMinor })), ...extra,
  });
}

beforeAll(async () => {
  db = openDb(':memory:');
  migrate(db);
  s = seed(db, { passwordHash: hashPassword('custock'), now: clock });
  app = createApp({ db, dev: true, jwtSecret: SECRET, publicWebUrl: WEB, corsOrigins: [], now: () => clock, rateLimit: false });
  for (const who of ['eleni', 'maria', 'giorgos', 'dimitris', 'sofia', 'anna']) await login(who);
  // a second customer with an app account, following the Kifisia shop
  const code = (await call('POST', '/v1/auth/otp/request', undefined, { email: 'buyer@example.com', locale: 'en' })).body.devCode;
  tokens.buyer = (await call('POST', '/v1/auth/otp/verify', undefined, { email: 'buyer@example.com', code })).body.accessToken;
  expect((await call('POST', '/v1/c/join/kif7q2', 'buyer', { push: false })).status).toBe(200);
  // plenty of stock where the orders are picked up
  annaName = q<{ name: string }>('SELECT name FROM customers WHERE user_id = ?', s.users.anna).name;
  db.prepare('UPDATE stock_levels SET on_hand = 40 WHERE shop_id = ? AND variant_id IN (?, ?)').run(shop('kifisia'), s.variants['p-olive-oil'], s.variants['p-thyme-honey']);
});

describe('settings', () => {
  it('the business setting, the shop switch and the feature switch decide where orders go', async () => {
    const o = await call('GET', '/v1/public/orgs/lemoni/order-options');
    expect(o.status).toBe(200);
    expect(o.body.mode).toBe('priced');
    expect(o.body.pricesShown).toBe(true);
    expect(o.body.shops.map((x: Json) => x.id).sort()).toEqual(Object.values(s.shops).sort());
    expect(o.body.limits).toEqual({ maxLines: 30, maxQty: 999, openPerCustomer: 5 });
    // the shop page carries the same
    expect((await call('GET', '/v1/public/orgs/lemoni')).body.orders.mode).toBe('priced');
    // one shop stops taking orders
    expect((await call('PATCH', `${org()}/shops/${shop('glyfada')}`, 'eleni', { customerOrders: 'off' })).body.customerOrders).toBe('off');
    expect((await call('GET', '/v1/public/orgs/lemoni/order-options')).body.shops.map((x: Json) => x.id)).not.toContain(shop('glyfada'));
    const there = await preview('anna', shop('glyfada'), [{ variantId: s.variants['p-olive-oil']!, qty: 1 }]);
    expect([there.status, there.body.code]).toEqual([403, 'orders_off']);
    await call('PATCH', `${org()}/shops/${shop('glyfada')}`, 'eleni', { customerOrders: null });
    // the business turns orders off
    expect((await setMode('off')).body.customerOrders).toBe('off');
    expect((await call('GET', '/v1/public/orgs/lemoni/order-options')).body).toMatchObject({ mode: 'off', shops: [] });
    const off = await preview('anna', shop('kifisia'), [{ variantId: s.variants['p-olive-oil']!, qty: 1 }]);
    expect([off.status, off.body.code]).toEqual([403, 'orders_off']);
    await setMode('priced');
    // the super admin switches the feature off: customers see off, the shop's screens are off
    db.prepare("UPDATE organizations SET disabled_features = '[\"orders\"]' WHERE id = ?").run(s.orgId);
    expect((await call('GET', '/v1/public/orgs/lemoni/order-options')).body.mode).toBe('off');
    expect((await preview('anna', shop('kifisia'), [{ variantId: s.variants['p-olive-oil']!, qty: 1 }])).body.code).toBe('orders_off');
    expect((await call('GET', `${org()}/orders`, 'maria')).body.code).toBe('feature_off');
    db.prepare("UPDATE organizations SET disabled_features = '[]' WHERE id = ?").run(s.orgId);
  });

  it('a staff member without the right to change business settings can not switch orders on', async () => {
    expect((await call('PATCH', org(), 'dimitris', { customerOrders: 'quote' })).status).toBe(403);
  });
});

describe('asking for a price', () => {
  let id = '';
  const oil = () => s.variants['p-olive-oil']!;
  const honey = () => s.variants['p-thyme-honey']!;

  it('the customer asks, the shop hears, the customer gets a note by email in their language', async () => {
    await setMode('quote');
    const since = mark();
    const p = await preview('anna', shop('kifisia'), [{ variantId: oil(), qty: 10 }, { variantId: honey(), qty: 2 }]);
    expect(p.body.priced).toBe(false);
    expect(p.body.lines.every((l: Json) => l.unitPriceMinor === null && l.problem === null)).toBe(true);
    const r = await place('anna', shop('kifisia'), [{ variantId: oil(), qty: 10 }, { variantId: honey(), qty: 2 }], { note: 'For Saturday', wantedOn: '2026-11-28' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    id = r.body.id;
    expect(r.body).toMatchObject({ number: 1001, status: 'requested', priced: false, totalMinor: null, note: 'For Saturday', wantedOn: '2026-11-28', actions: ['cancel'] });
    expect(r.body.lines.map((l: Json) => [l.qty, l.unitPriceMinor])).toEqual([[10, null], [2, null]]);
    expect(r.body.customer).toBeUndefined();
    // the shop: people who can send a price at Kifisia, not the staff who only hand over
    const pushes = outbox('orderNew', since);
    const to = new Set(pushes.map((x: Json) => x.user_id));
    expect(to.has(s.users.maria)).toBe(true);
    expect(to.has(s.users.eleni)).toBe(true);
    expect(to.has(s.users.dimitris)).toBe(false);
    expect(to.has(s.users.giorgos)).toBe(false);
    expect(pushes[0].title).toContain('1001');
    // the customer: an email in russian (anna reads russian), no push for this step
    const mail = outbox('order_received', since);
    expect(mail).toHaveLength(1);
    expect(mail[0].to_address).toBe('anna@example.com');
    expect(mail[0].locale).toBe('ru');
    expect(mail[0].html).toContain('/s/lemoni/orders/');
  });

  it('the shop sees it as its role allows, other shops do not see it at all', async () => {
    const staff = await call('GET', `${org()}/orders/${id}`, 'dimitris');
    expect(staff.status).toBe(200);
    expect(staff.body.actions).toEqual([]);
    expect(staff.body.lines[0].onHand).toBe(40);
    expect(staff.body.customer.name).toBe(annaName);
    expect((await call('POST', `${org()}/orders/${id}/quote`, 'dimitris', { lines: [{ lineNo: 1, unitPriceMinor: 1 }, { lineNo: 2, unitPriceMinor: 1 }] })).status).toBe(403);
    expect((await call('GET', `${org()}/orders/${id}`, 'giorgos')).status).toBe(404);
    expect((await call('GET', `${org()}/orders`, 'giorgos')).body.items.map((x: Json) => x.id)).not.toContain(id);
    const viewer = await call('GET', `${org()}/orders/${id}`, 'sofia');
    expect([viewer.status, viewer.body.actions]).toEqual([200, []]);
    const manager = await call('GET', `${org()}/orders/${id}`, 'maria');
    expect(manager.body.actions).toEqual(['quote', 'decline']);
    const list = await call('GET', `${org()}/orders?status=open&shopId=${shop('kifisia')}`, 'maria');
    expect(list.body.items[0]).toMatchObject({ id, number: 1001, status: 'requested', lineCount: 2, customerName: annaName });
    expect((await call('GET', `${org()}/orders/counts`, 'maria')).body.requested).toBe(1);
    expect((await call('GET', `${org()}/reports/dashboard`, 'maria')).body.newOrders).toBe(1);
  });

  it('the shop sends a price with fewer than asked, the customer hears by push and email', async () => {
    const since = mark();
    const r = await call('POST', `${org()}/orders/${id}/quote`, 'maria', {
      lines: [{ lineNo: 1, unitPriceMinor: 1100, qty: 8, note: 'Only 8 left' }, { lineNo: 2, unitPriceMinor: 1300 }],
      message: 'We have 8 of the oil.',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ status: 'quoted', totalMinor: 8 * 1100 + 2 * 1300, quoteMessage: 'We have 8 of the oil.', quotedByName: 'Maria Ioannou' });
    expect(r.body.quoteValidUntil).toBe(clock + 3 * 24 * HOUR);
    expect(r.body.lines[0]).toMatchObject({ qty: 8, requestedQty: 10, unitPriceMinor: 1100, lineTotalMinor: 8800, note: 'Only 8 left' });
    const quoted = r.body.events.find((e: Json) => e.kind === 'quoted');
    expect(quoted).toMatchObject({ actor: 'staff', actorName: 'Maria Ioannou', totalMinor: 11400, changedLines: [1, 2] });
    const push = outbox('order', since);
    expect(push).toHaveLength(1);
    expect(push[0].customer_id).toBeTruthy();
    expect(push[0].locale).toBe('ru');
    expect(JSON.parse(push[0].payload).url).toBe(`${WEB}/s/lemoni/orders/${id}`);
    const mail = outbox('order_quote', since);
    expect(mail).toHaveLength(1);
    expect(mail[0].html).toContain('114,00');
    expect((await call('GET', `${org()}/audit`, 'eleni')).body.items.some((a: Json) => a.action === 'order.quoted' && a.entityId === id)).toBe(true);
  });

  it('the customer says yes once, a second tap changes nothing, the person who quoted hears it', async () => {
    const mine = await call('GET', `/v1/c/orgs/lemoni/orders/${id}`, 'anna');
    expect(mine.body.actions).toEqual(['accept', 'reject', 'cancel']);
    // the customer sees the shop, never a person
    expect(mine.body.events.every((e: Json) => e.actorName === null)).toBe(true);
    const since = mark();
    const [a, b] = await Promise.all([call('POST', `/v1/c/orgs/lemoni/orders/${id}/accept`, 'anna'), call('POST', `/v1/c/orgs/lemoni/orders/${id}/accept`, 'anna')]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(a.body.status).toBe('confirmed');
    expect(qa("SELECT * FROM order_events WHERE order_id = ? AND kind = 'accepted'", id)).toHaveLength(1);
    const told = outbox('orderAnswered', since);
    expect(told.map((x: Json) => x.user_id)).toEqual([s.users.maria]);
  });

  it('confirmed orders hold stock without taking it: the product page and the stock list say so', async () => {
    const product = await call('GET', `${org()}/products/${s.products['p-olive-oil']}`, 'maria');
    const kif = product.body.levels.find((l: Json) => l.shopId === shop('kifisia') && l.variantId === oil());
    expect(kif).toMatchObject({ onHand: 40, onOrderQty: 8 });
    expect(product.body.orderHolds).toEqual([expect.objectContaining({ shopId: shop('kifisia'), orderId: id, number: 1001, qty: 8, status: 'confirmed', wantedOn: '2026-11-28', customerName: annaName })]);
    // another shop's manager sees their own shop only
    const other = await call('GET', `${org()}/products/${s.products['p-olive-oil']}`, 'giorgos');
    expect(other.body.orderHolds).toEqual([]);
    expect(other.body.levels.filter((l: Json) => l.shopId === shop('kifisia'))).toEqual([]);
    const list = await call('GET', `${org()}/products?shopId=${shop('kifisia')}&q=olive`, 'maria');
    const row = list.body.items.find((p: Json) => p.id === s.products['p-olive-oil']);
    expect(row.levels.find((l: Json) => l.shopId === shop('kifisia')).onOrderQty).toBe(8);
  });

  it('ready, then picked up: the stock goes down as sales of this order, at the agreed prices', async () => {
    const since = mark();
    const ready = await call('POST', `${org()}/orders/${id}/ready`, 'dimitris');
    expect(ready.body.status).toBe('ready');
    expect(outbox('order', since)).toHaveLength(1);
    expect(outbox('order_ready', since)).toHaveLength(1);
    const before = onHand(shop('kifisia'), oil());
    const done = await call('POST', `${org()}/orders/${id}/complete`, 'dimitris');
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body).toMatchObject({ status: 'completed', actions: [] });
    expect(done.body.closedAt).toBe(clock);
    expect(onHand(shop('kifisia'), oil())).toBe(before - 8);
    const moves = qa("SELECT kind, qty_delta, unit_price_minor, ref_type, ref_id FROM stock_movements WHERE ref_id = ? ORDER BY qty_delta", id);
    expect(moves).toEqual([
      { kind: 'sale', qty_delta: -8, unit_price_minor: 1100, ref_type: 'order', ref_id: id },
      { kind: 'sale', qty_delta: -2, unit_price_minor: 1300, ref_type: 'order', ref_id: id },
    ]);
    // nothing on orders any more
    const product = await call('GET', `${org()}/products/${s.products['p-olive-oil']}`, 'maria');
    expect(product.body.orderHolds).toEqual([]);
    const events = (await call('GET', `/v1/c/orgs/lemoni/orders/${id}`, 'anna')).body.events.map((e: Json) => e.kind);
    expect(events).toEqual(['requested', 'quoted', 'accepted', 'ready', 'completed']);
    // a finished order takes no more steps
    expect((await call('POST', `${org()}/orders/${id}/cancel`, 'maria', { reason: 'late' })).status).toBe(409);
  });
});

describe('orders at the shown prices', () => {
  const oil = () => s.variants['p-olive-oil']!;

  it('the order goes in priced and the shop confirms it as it is', async () => {
    await setMode('priced');
    const p = await preview('anna', shop('kifisia'), [{ variantId: oil(), qty: 3 }]);
    expect(p.body.priced).toBe(true);
    const unit = p.body.lines[0].unitPriceMinor;
    expect(unit).toBeGreaterThan(0);
    expect(p.body.totalMinor).toBe(unit * 3);
    const since = mark();
    const r = await place('anna', shop('kifisia'), [{ variantId: oil(), qty: 3 }]);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ status: 'requested', priced: true, totalMinor: unit * 3 });
    expect(outbox('orderNew', since)[0].body).toContain('€');
    const staff = await call('GET', `${org()}/orders/${r.body.id}`, 'maria');
    expect(staff.body.actions).toEqual(['quote', 'confirm', 'decline']);
    const [a, b] = await Promise.all([call('POST', `${org()}/orders/${r.body.id}/confirm`, 'maria'), call('POST', `${org()}/orders/${r.body.id}/confirm`, 'eleni')]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(qa("SELECT * FROM order_events WHERE order_id = ? AND kind = 'confirmed'", r.body.id)).toHaveLength(1);
    expect(outbox('order_confirmed', since)).toHaveLength(1);
    // the next order of the same oil shows what the confirmed one already holds
    const next = await place('anna', shop('kifisia'), [{ variantId: oil(), qty: 2 }]);
    const line = (await call('GET', `${org()}/orders/${next.body.id}`, 'maria')).body.lines[0];
    expect(line).toMatchObject({ onHand: onHand(shop('kifisia'), oil()), onOtherOrders: 3 });
    // the customer side never sees stock
    expect(next.body.lines[0].onHand).toBeUndefined();
    await call('POST', `${org()}/orders/${next.body.id}/cancel`, 'maria', { reason: 'test' });
    await call('POST', `${org()}/orders/${r.body.id}/cancel`, 'maria', { reason: 'Out of oil after all' });
  });

  it('a changed price turns it into a quote the customer has to accept', async () => {
    const r = await place('anna', shop('kifisia'), [{ variantId: oil(), qty: 2 }]);
    const changed = await call('POST', `${org()}/orders/${r.body.id}/quote`, 'maria', { lines: [{ lineNo: 1, unitPriceMinor: 999 }] });
    expect(changed.body).toMatchObject({ status: 'quoted', totalMinor: 1998 });
    expect((await call('POST', `${org()}/orders/${r.body.id}/confirm`, 'maria')).status).toBe(409);
    const yes = await call('POST', `/v1/c/orgs/lemoni/orders/${r.body.id}/accept`, 'anna');
    expect(yes.body.status).toBe('confirmed');
    await call('POST', `${org()}/orders/${r.body.id}/cancel`, 'maria', { reason: 'test' });
  });

  it('a price that changed since the app showed it is refused, nobody is surprised', async () => {
    const r = await call('POST', '/v1/c/orgs/lemoni/orders', 'anna', { shopId: shop('kifisia'), lines: [{ variantId: oil(), qty: 1, seenUnitPriceMinor: 1 }] });
    expect([r.status, r.body.code]).toEqual([409, 'prices_changed']);
  });

  it('a product that is gone can not be ordered', async () => {
    db.prepare('UPDATE products SET customer_visible = 0 WHERE id = ?').run(s.products['p-candle']);
    const p = await preview('anna', shop('kifisia'), [{ variantId: s.variants['p-candle']!, qty: 1 }]);
    expect(p.body.lines[0].problem).toBe('unavailable');
    const r = await call('POST', '/v1/c/orgs/lemoni/orders', 'anna', { shopId: shop('kifisia'), lines: [{ variantId: s.variants['p-candle']!, qty: 1, seenUnitPriceMinor: null }] });
    expect([r.status, r.body.fields?.['lines.0.variantId']]).toEqual([400, 'unavailable']);
    db.prepare('UPDATE products SET customer_visible = 1 WHERE id = ?').run(s.products['p-candle']);
  });
});

describe('limits', () => {
  it('too many products, too much of one, too many open orders', async () => {
    await setMode('quote');
    expect((await setPolicy({ 'orders.maxLines': 1, 'orders.maxQty': 5, 'orders.openPerCustomer': 1 })).status).toBe(200);
    const two = await call('POST', '/v1/c/orgs/lemoni/orders', 'buyer', { shopId: shop('kifisia'), lines: [{ variantId: s.variants['p-olive-oil'], qty: 1 }, { variantId: s.variants['p-thyme-honey'], qty: 1 }] });
    expect([two.status, two.body.code]).toEqual([403, 'limit_reached']);
    const much = await preview('buyer', shop('kifisia'), [{ variantId: s.variants['p-olive-oil']!, qty: 6 }]);
    expect(much.body.lines[0].problem).toBe('too_many');
    // by weight: 5 kg of feta is fine, 5.5 kg is not
    expect((await preview('buyer', shop('kifisia'), [{ variantId: s.variants['p-feta']!, qty: 5000 }])).body.lines[0].problem).toBeNull();
    expect((await preview('buyer', shop('kifisia'), [{ variantId: s.variants['p-feta']!, qty: 5500 }])).body.lines[0].problem).toBe('too_many');
    const first = await place('buyer', shop('kifisia'), [{ variantId: s.variants['p-olive-oil']!, qty: 1 }]);
    expect(first.status).toBe(201);
    expect((await preview('buyer', shop('kifisia'), [{ variantId: s.variants['p-olive-oil']!, qty: 1 }])).body.limits.openLeft).toBe(0);
    const second = await place('buyer', shop('kifisia'), [{ variantId: s.variants['p-olive-oil']!, qty: 1 }]);
    expect([second.status, second.body.code]).toEqual([403, 'limit_reached']);
    // the customer cancels, saying why or not
    const gone = await call('POST', `/v1/c/orgs/lemoni/orders/${first.body.id}/cancel`, 'buyer', { reason: null });
    expect(gone.body).toMatchObject({ status: 'cancelled', actions: [] });
    await setPolicy({ 'orders.maxLines': null, 'orders.maxQty': null, 'orders.openPerCustomer': null });
  });
});

describe('who sees what', () => {
  it('a customer sees only their own orders, and only by following the business', async () => {
    const annas = (await call('GET', '/v1/c/orgs/lemoni/orders', 'anna')).body.items;
    expect(annas.length).toBeGreaterThan(0);
    expect((await call('GET', `/v1/c/orgs/lemoni/orders/${annas[0].id}`, 'buyer')).status).toBe(404);
    expect((await call('GET', '/v1/c/orgs/lemoni/orders', 'buyer')).body.items.map((x: Json) => x.id)).not.toContain(annas[0].id);
    // staff are not customers here
    expect((await call('GET', '/v1/c/orgs/lemoni/orders', 'dimitris')).status).toBe(403);
  });
});

describe('prices that run out', () => {
  it('a yes after the price ran out is refused and the order expires', async () => {
    await setMode('quote');
    const r = await place('anna', shop('kifisia'), [{ variantId: s.variants['p-thyme-honey']!, qty: 1 }]);
    await call('POST', `${org()}/orders/${r.body.id}/quote`, 'maria', { lines: [{ lineNo: 1, unitPriceMinor: 1200 }], validUntil: clock + HOUR });
    await jump(2 * HOUR);
    const late = await call('POST', `/v1/c/orgs/lemoni/orders/${r.body.id}/accept`, 'anna');
    expect([late.status, late.body.code]).toEqual([410, 'quote_expired']);
    expect(q<Json>('SELECT status FROM orders WHERE id = ?', r.body.id).status).toBe('expired');
  });

  it('the worker expires prices nobody answered, the customer and the person who quoted hear it', async () => {
    const r = await place('anna', shop('kifisia'), [{ variantId: s.variants['p-thyme-honey']!, qty: 1 }]);
    await call('POST', `${org()}/orders/${r.body.id}/quote`, 'maria', { lines: [{ lineNo: 1, unitPriceMinor: 1200 }], validUntil: clock + HOUR });
    const since = mark();
    await jump(2 * HOUR);
    await runJobs({ cfg: { db, jwtSecret: SECRET, publicWebUrl: WEB } }, clock);
    expect(q<Json>('SELECT status FROM orders WHERE id = ?', r.body.id).status).toBe('expired');
    expect(outbox('order_expired', since)).toHaveLength(1);
    expect(outbox('orderExpired', since).map((x: Json) => x.user_id)).toEqual([s.users.maria]);
    const events = (await call('GET', `${org()}/orders/${r.body.id}`, 'maria')).body.events;
    expect(events.at(-1)).toMatchObject({ kind: 'expired', actor: 'system' });
  });
});

describe('edges', () => {
  it('declined and cancelled by the shop, always with a reason the customer reads', async () => {
    const r = await place('anna', shop('kifisia'), [{ variantId: s.variants['p-thyme-honey']!, qty: 1 }]);
    expect((await call('POST', `${org()}/orders/${r.body.id}/decline`, 'maria', { reason: '' })).status).toBe(400);
    const since = mark();
    const d = await call('POST', `${org()}/orders/${r.body.id}/decline`, 'maria', { reason: 'We make it only to order on Mondays' });
    expect(d.body).toMatchObject({ status: 'declined', cancelReason: 'We make it only to order on Mondays' });
    expect(outbox('order_declined', since)[0].html).toContain('Mondays');
    expect(JSON.parse(outbox('order', since)[0].payload).orderId).toBe(r.body.id);
  });

  it('picked up while the business does not sell below zero and stock is short: refused, nothing changes', async () => {
    db.prepare('UPDATE organizations SET allow_negative_stock = 0 WHERE id = ?').run(s.orgId);
    db.prepare('UPDATE stock_levels SET on_hand = 1 WHERE shop_id = ? AND variant_id = ?').run(shop('kifisia'), s.variants['p-tahini']);
    const r = await place('anna', shop('kifisia'), [{ variantId: s.variants['p-tahini']!, qty: 3 }]);
    await call('POST', `${org()}/orders/${r.body.id}/quote`, 'maria', { lines: [{ lineNo: 1, unitPriceMinor: 500 }] });
    await call('POST', `/v1/c/orgs/lemoni/orders/${r.body.id}/accept`, 'anna');
    const done = await call('POST', `${org()}/orders/${r.body.id}/complete`, 'dimitris');
    expect([done.status, done.body.code]).toEqual([409, 'negative_stock_blocked']);
    expect(q<Json>('SELECT status FROM orders WHERE id = ?', r.body.id).status).toBe('confirmed');
    expect(onHand(shop('kifisia'), s.variants['p-tahini']!)).toBe(1);
    db.prepare('UPDATE organizations SET allow_negative_stock = 1 WHERE id = ?').run(s.orgId);
    // with orders.takeStock off for this shop, picking up leaves the stock alone
    expect((await call('PATCH', `${org()}/shops/${shop('kifisia')}/policies`, 'eleni', { 'orders.takeStock': false })).status).toBe(200);
    expect((await call('POST', `${org()}/orders/${r.body.id}/complete`, 'dimitris')).body.status).toBe('completed');
    expect(onHand(shop('kifisia'), s.variants['p-tahini']!)).toBe(1);
    await call('PATCH', `${org()}/shops/${shop('kifisia')}/policies`, 'eleni', { 'orders.takeStock': null });
  });

  it('an erased customer: their orders stay for the books without name or contact, and nothing is sent to them', async () => {
    await setMode('quote');
    const r = await place('buyer', shop('kifisia'), [{ variantId: s.variants['p-thyme-honey']!, qty: 1 }]);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const customerId = q<Json>('SELECT customer_id FROM orders WHERE id = ?', r.body.id).customer_id;
    expect((await call('POST', `${org()}/customers/${customerId}/erase`, 'eleni')).status).toBeLessThan(300);
    const staff = await call('GET', `${org()}/orders/${r.body.id}`, 'maria');
    expect(staff.body.customer).toMatchObject({ erased: true, name: null, email: null, phone: null });
    const since = mark();
    await call('POST', `${org()}/orders/${r.body.id}/quote`, 'maria', { lines: [{ lineNo: 1, unitPriceMinor: 1200 }] });
    expect(qa('SELECT * FROM dev_outbox WHERE customer_id = ? AND rowid > ?', customerId, since)).toEqual([]);
  });

  it('every new email kind has a preview', async () => {
    for (const kind of ['orderReceived', 'orderQuote', 'orderConfirmed', 'orderReady', 'orderDeclined', 'orderCancelled', 'orderExpired']) {
      const res = await app.request(`/v1/dev/emails/${kind}?locale=el`);
      expect(res.status, kind).toBe(200);
    }
  });
});
