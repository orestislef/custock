// regression tests for the security review (critical, high and medium findings)

import { beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SignJWT } from 'jose';
import { migrate, openDb, seed, hashPassword, type Db, type SeedResult } from '@custock/db';
import { uuidv7, type MovementInput } from '@custock/core';
import { createApp, type App } from '../src/app';
import { rollup, runJobs } from '../src/worker';
import { localMinutes } from '../src/lib/time';
import type { Config } from '../src/types';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const SECRET = 'security-test-secret-that-is-long-enough';
const pw = hashPassword('custock');
let clock = Date.now();

interface World {
  db: Db;
  s: SeedResult;
  app: App;
  tokens: Record<string, string>;
  refresh: Record<string, string>;
}

function world(extra: Partial<Config> = {}): World {
  const db = openDb(':memory:');
  migrate(db);
  const s = seed(db, { passwordHash: pw, now: clock });
  const app = createApp({ db, dev: true, jwtSecret: SECRET, publicWebUrl: 'http://localhost:3000', corsOrigins: [], now: () => clock, rateLimit: false, ...extra });
  return { db, s, app, tokens: {}, refresh: {} };
}

async function call(w: World, method: string, path: string, who?: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await w.app.request(path, {
    method,
    headers: {
      ...(who ? { Authorization: `Bearer ${w.tokens[who]}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
  });
  const text = await res.text();
  let parsed: Json = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // not json
  }
  return { status: res.status, body: parsed, headers: res.headers };
}

async function login(w: World, who: string) {
  const r = await call(w, 'POST', '/v1/auth/login', undefined, { email: `${who}@example.com`, password: 'custock' });
  expect(r.status).toBe(200);
  w.tokens[who] = r.body.accessToken;
  w.refresh[who] = r.body.refreshToken;
}

const q = (w: World, sql: string, ...p: unknown[]) => w.db.prepare(sql).get(...p) as Json;
const role = (w: World, key: string) => q(w, 'SELECT id FROM roles WHERE org_id = ? AND template_key = ?', w.s.orgId, key).id as string;
const mv = (shopId: string, variantId: string, qtyDelta: number, kind: MovementInput['kind'], extra: Partial<MovementInput> = {}): MovementInput => ({ id: uuidv7(), shopId, variantId, qtyDelta, kind, occurredAt: clock, ...extra });

let w: World;
beforeAll(async () => {
  w = world();
  for (const who of ['eleni', 'nikos', 'maria', 'giorgos', 'dimitris', 'anna']) await login(w, who);
});

describe('C1 dev features only when asked for', () => {
  it('outside dev: no dev codes, no dev tools, no signups without a bot check secret, password users cannot use codes', async () => {
    const prod = world({ dev: false });
    const otp = await call(prod, 'POST', '/v1/auth/otp/request', undefined, { email: 'someone@example.com' });
    expect(otp.status).toBe(200);
    expect(otp.body.devCode).toBeUndefined();
    await login(prod, 'eleni');
    expect((await call(prod, 'GET', '/v1/dev/outbox', 'eleni')).status).toBe(404);
    const join = await call(prod, 'POST', '/v1/public/join/kif7q2', undefined, { name: 'A', email: 'a@example.com', locale: 'en', emailNews: true, push: false, over15: true });
    expect(join.status).toBe(403);
    // eleni has a password: a code must not log her in
    const code = '123456';
    prod.db.prepare("INSERT INTO otp_codes (id, email, code_hash, created_at, expires_at) VALUES (?, 'eleni@example.com', ?, ?, ?)").run(uuidv7(), (await import('@custock/db')).sha256(`eleni@example.com:${code}`), clock, clock + 600_000);
    expect((await call(prod, 'POST', '/v1/auth/otp/verify', undefined, { email: 'eleni@example.com', code })).status).toBe(401);
  });
  it('a 500 says nothing about internals', async () => {
    const broken = world({ dev: true });
    await login(broken, 'eleni');
    broken.db.exec('DROP TABLE shop_group_shops');
    const r = await call(broken, 'GET', `/v1/orgs/${broken.s.orgId}/shops`, 'eleni');
    expect(r.status).toBe(500);
    expect(r.body.code).toBe('internal');
    expect(r.body.detail).toBeUndefined();
    expect(JSON.stringify(r.body)).not.toContain('shop_group_shops');
  });
  it('a token naming one user with the session of another is refused', async () => {
    const sid = q(w, 'SELECT id FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1', w.s.users.dimitris).id;
    const forged = await new SignJWT({ sid }).setProtectedHeader({ alg: 'HS256' }).setSubject(w.s.users.eleni!).setIssuer('custock-dev').setIssuedAt().setExpirationTime('10m').sign(new TextEncoder().encode(SECRET));
    w.tokens.forged = forged;
    expect((await call(w, 'GET', '/v1/me/context', 'forged')).status).toBe(401);
  });
  it('the server refuses to start without a strong secret unless in dev', () => {
    const dir = mkdtempSync(join(tmpdir(), 'custock-'));
    const env = { ...process.env, CUSTOCK_DEV: '', CUSTOCK_JWT_SECRET: '', CUSTOCK_DB: join(dir, 'x.db'), CUSTOCK_WORKER: '0', PORT: '0' };
    const r = spawnSync(process.execPath, ['--import', 'tsx', 'src/main.ts'], { env, encoding: 'utf8', timeout: 30_000 });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('CUSTOCK_JWT_SECRET');
  });
});

describe('H1 rate limits', () => {
  it('a rotating X-Forwarded-For does not get around the per ip limit', async () => {
    const limited = world({ rateLimit: true });
    const codes: number[] = [];
    for (let i = 0; i < 25; i++) {
      const r = await call(limited, 'POST', '/v1/auth/login', undefined, { email: `nobody${i}@example.com`, password: 'x' }, { 'X-Forwarded-For': `10.0.0.${i}` });
      codes.push(r.status);
    }
    expect(codes.filter((x) => x === 429).length).toBeGreaterThan(0);
  });
  it('five wrong passwords lock that email, even for the right password', async () => {
    for (let i = 0; i < 5; i++) expect((await call(w, 'POST', '/v1/auth/login', undefined, { email: 'sofia@example.com', password: 'wrong' })).status).toBe(401);
    expect((await call(w, 'POST', '/v1/auth/login', undefined, { email: 'sofia@example.com', password: 'custock' })).status).toBe(429);
  });
  it('one time codes: a cap per hour and a lock after wrong codes', async () => {
    const email = 'otp.cap@example.com';
    for (let i = 0; i < 5; i++) expect((await call(w, 'POST', '/v1/auth/otp/request', undefined, { email })).status).toBe(200);
    expect((await call(w, 'POST', '/v1/auth/otp/request', undefined, { email })).status).toBe(429);
    const other = 'otp.lock@example.com';
    const good = (await call(w, 'POST', '/v1/auth/otp/request', undefined, { email: other })).body.devCode;
    for (let i = 0; i < 5; i++) await call(w, 'POST', '/v1/auth/otp/verify', undefined, { email: other, code: '000000' === good ? '111111' : '000000' });
    expect((await call(w, 'POST', '/v1/auth/otp/verify', undefined, { email: other, code: good })).status).toBe(429);
  });
});

describe('H2 H3 member status and invites', () => {
  it('a member who is admin elsewhere cannot be removed by a shop manager', async () => {
    const uid = uuidv7();
    const mid = uuidv7();
    w.db.prepare("INSERT INTO users (id, email, display_name, locale, created_at, updated_at) VALUES (?, 'tgt@example.com', 'T', 'en', ?, ?)").run(uid, clock, clock);
    w.db.prepare("INSERT INTO memberships (id, org_id, user_id, status, joined_at) VALUES (?, ?, ?, 'active', ?)").run(mid, w.s.orgId, uid, clock);
    const add = w.db.prepare('INSERT INTO role_assignments (id, org_id, membership_id, role_id, scope_type, scope_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    add.run(uuidv7(), w.s.orgId, mid, role(w, 'staff'), 'shop', w.s.shops.kifisia, clock);
    add.run(uuidv7(), w.s.orgId, mid, role(w, 'admin'), 'shop', w.s.shops.glyfada, clock);
    const r = await call(w, 'PATCH', `/v1/orgs/${w.s.orgId}/members/${mid}`, 'maria', { status: 'removed' });
    expect(r.status).toBe(403);
    expect(q(w, 'SELECT status FROM memberships WHERE id = ?', mid).status).toBe('active');
  });
  it('a suspended admin re-invited as staff comes back as staff only', async () => {
    const own = world();
    for (const who of ['eleni', 'maria', 'nikos']) await login(own, who);
    const nikosM = q(own, 'SELECT id FROM memberships WHERE org_id = ? AND user_id = ?', own.s.orgId, own.s.users.nikos).id;
    expect((await call(own, 'PATCH', `/v1/orgs/${own.s.orgId}/members/${nikosM}`, 'eleni', { status: 'suspended' })).status).toBe(204);
    const inv = await call(own, 'POST', `/v1/orgs/${own.s.orgId}/invites`, 'maria', { email: 'nikos@example.com', roleId: role(own, 'staff'), scopeType: 'shop', scopeId: own.s.shops.kifisia });
    const token = String(inv.body.devLink).split('/invite/')[1];
    expect((await call(own, 'POST', '/v1/invites/accept', 'nikos', { token })).status).toBe(200);
    const ctx = await call(own, 'GET', '/v1/me/context', 'nikos');
    const org = ctx.body.orgs.find((o: { orgId: string }) => o.orgId === own.s.orgId);
    expect(org.roleNames).toEqual(['staff']);
    expect(org.orgPerms).toEqual([]);
    // a second accept of the same token is refused
    expect((await call(own, 'POST', '/v1/invites/accept', 'nikos', { token })).status).toBe(410);
  });
  it('M12 a manager cannot revoke an invite of another shop', async () => {
    const inv = await call(w, 'POST', `/v1/orgs/${w.s.orgId}/invites`, 'eleni', { email: 'mar.staff@example.com', roleId: role(w, 'staff'), scopeType: 'shop', scopeId: w.s.shops.marousi });
    expect((await call(w, 'POST', `/v1/orgs/${w.s.orgId}/invites/${inv.body.id}/revoke`, 'giorgos')).status).toBe(403);
  });
});

describe('H4 double submits', () => {
  it('applying a count twice at once applies it once', async () => {
    const mastiha = w.s.variants['p-mastiha']!;
    const count = (await call(w, 'POST', `/v1/orgs/${w.s.orgId}/shops/${w.s.shops.kifisia}/counts`, 'maria', { kind: 'partial' })).body;
    await call(w, 'PUT', `/v1/orgs/${w.s.orgId}/counts/${count.id}/lines/${mastiha}`, 'maria', { countedQty: 7 });
    const before = q(w, 'SELECT on_hand FROM stock_levels WHERE shop_id = ? AND variant_id = ?', w.s.shops.kifisia, mastiha).on_hand;
    const [a, b] = await Promise.all([
      call(w, 'POST', `/v1/orgs/${w.s.orgId}/counts/${count.id}/apply`, 'maria', {}),
      call(w, 'POST', `/v1/orgs/${w.s.orgId}/counts/${count.id}/apply`, 'maria', {}),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(q(w, 'SELECT count(*) n FROM stock_movements WHERE ref_id = ?', count.id).n).toBe(1);
    expect(q(w, 'SELECT on_hand FROM stock_levels WHERE shop_id = ? AND variant_id = ?', w.s.shops.kifisia, mastiha).on_hand).toBe(7);
    expect(before).not.toBe(7);
  });
  it('receiving a transfer twice at once receives it once', async () => {
    const tahini = w.s.variants['p-tahini']!;
    const tr = (await call(w, 'POST', `/v1/orgs/${w.s.orgId}/transfers`, 'nikos', { fromShopId: w.s.shops.marousi, toShopId: w.s.shops.kifisia, lines: [{ variantId: tahini, qty: 4 }] })).body;
    await call(w, 'POST', `/v1/orgs/${w.s.orgId}/transfers/${tr.id}/send`, 'nikos');
    const [a, b] = await Promise.all([
      call(w, 'POST', `/v1/orgs/${w.s.orgId}/transfers/${tr.id}/receive`, 'maria', { lines: [] }),
      call(w, 'POST', `/v1/orgs/${w.s.orgId}/transfers/${tr.id}/receive`, 'maria', { lines: [] }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(q(w, "SELECT count(*) n FROM stock_movements WHERE ref_id = ? AND kind = 'transfer_in'", tr.id).n).toBe(1);
  });
});

describe('H5 reversals', () => {
  it('a transfer cannot be undone by a reversal', async () => {
    const tahini = w.s.variants['p-tahini']!;
    const tr = (await call(w, 'POST', `/v1/orgs/${w.s.orgId}/transfers`, 'nikos', { fromShopId: w.s.shops.marousi, toShopId: w.s.shops.glyfada, lines: [{ variantId: tahini, qty: 2 }] })).body;
    await call(w, 'POST', `/v1/orgs/${w.s.orgId}/transfers/${tr.id}/send`, 'nikos');
    const out = q(w, "SELECT id FROM stock_movements WHERE ref_id = ? AND kind = 'transfer_out'", tr.id).id;
    const r = await call(w, 'POST', `/v1/orgs/${w.s.orgId}/movements`, 'nikos', { movements: [mv(w.s.shops.marousi, tahini, 2, 'reversal', { refId: out })] });
    expect(r.body.rejected[0].code).toBe('validation');
  });
});

describe('H6 H7 consent belongs to the customer', () => {
  it('one click unsubscribe stops the next email from the whole business', async () => {
    const c = q(w, "SELECT id FROM customers WHERE org_id = ? AND email_ok = 1 AND email != 'anna@example.com' LIMIT 1", w.s.orgId).id;
    const { unsubToken, unsubKey } = await import('../src/lib/unsub');
    const token = unsubToken({ customerId: c, scopeType: 'shop', scopeId: w.s.shops.kifisia }, unsubKey({ jwtSecret: SECRET }));
    expect((await call(w, 'POST', `/v1/public/subscription/${token}`, undefined, 'List-Unsubscribe=One-Click', { 'Content-Type': 'application/x-www-form-urlencoded' })).status).toBe(204);
    const post = await call(w, 'POST', `/v1/orgs/${w.s.orgId}/posts`, 'nikos', {
      kind: 'news', defaultLocale: 'el', translations: { el: { title: 'Όλοι', body: 'x' } }, channels: ['feed', 'email'],
      audience: { scopes: [{ scopeType: 'org', scopeId: w.s.orgId }] },
    });
    await call(w, 'POST', `/v1/orgs/${w.s.orgId}/posts/${post.body.id}/publish`, 'nikos');
    await runJobs({ cfg: { db: w.db, jwtSecret: SECRET, publicWebUrl: 'http://x' } }, clock);
    expect(q(w, "SELECT status FROM deliveries WHERE post_id = ? AND customer_id = ? AND channel = 'email'", post.body.id, c).status).toBe('skipped');
  });
  it('a stranger joining with someone else\'s email changes nothing until that person clicks', async () => {
    const victim = q(w, "SELECT id, email, push_ok, email_ok FROM customers WHERE org_id = ? AND email_ok = 1 AND push_ok = 0 AND email != 'anna@example.com' LIMIT 1", w.s.orgId);
    const subsBefore = w.db.prepare('SELECT scope_type, scope_id, status FROM customer_subscriptions WHERE customer_id = ? ORDER BY scope_id').all(victim.id);
    const r = await call(w, 'POST', '/v1/public/join/gl8w2p', undefined, { name: 'Fake', email: victim.email, locale: 'en', emailNews: false, push: true, over15: true });
    expect(r.status).toBe(200);
    const after = q(w, 'SELECT name, push_ok, email_ok FROM customers WHERE id = ?', victim.id);
    expect(after.push_ok).toBe(0);
    expect(after.email_ok).toBe(1);
    expect(after.name).not.toBe('Fake');
    const subsAfter = w.db.prepare("SELECT scope_type, scope_id, status FROM customer_subscriptions WHERE customer_id = ? AND status != 'pending' ORDER BY scope_id").all(victim.id);
    expect(subsAfter).toEqual((subsBefore as { status: string }[]).filter((x) => x.status !== 'pending'));
    // the click applies only that request: glyfada, no email withdrawal, push needs an app
    const token = String(r.body.devConfirmLink).split('/confirm/')[1];
    expect((await call(w, 'POST', '/v1/public/confirm', undefined, { token })).status).toBe(200);
    const done = q(w, 'SELECT push_ok, email_ok FROM customers WHERE id = ?', victim.id);
    expect(done.email_ok).toBe(1);
    expect(done.push_ok).toBe(0);
    expect(q(w, "SELECT status FROM customer_subscriptions WHERE customer_id = ? AND scope_type = 'shop' AND scope_id = ?", victim.id, w.s.shops.glyfada).status).toBe('subscribed');
  });
});

describe('M1 M2 M3 customer privacy', () => {
  it('masked contacts cannot be found by searching pieces of them', async () => {
    const target = q(w, "SELECT phone, email FROM customers WHERE org_id = ? AND phone LIKE '+3069%' AND email != 'anna@example.com' LIMIT 1", w.s.orgId);
    const digits = target.phone.replace(/\D/g, '');
    const staff = await call(w, 'GET', `/v1/orgs/${w.s.orgId}/customers?q=${digits.slice(4, 9)}&limit=200`, 'dimitris');
    expect(staff.body.items).toHaveLength(0);
    const staffFull = await call(w, 'GET', `/v1/orgs/${w.s.orgId}/customers?q=${encodeURIComponent(target.email)}&limit=200`, 'dimitris');
    expect(staffFull.body.items).toHaveLength(0);
    const owner = await call(w, 'GET', `/v1/orgs/${w.s.orgId}/customers?q=${encodeURIComponent(target.phone)}&limit=200`, 'eleni');
    expect(owner.body.items).toHaveLength(1);
    const partial = await call(w, 'GET', `/v1/orgs/${w.s.orgId}/customers?q=${encodeURIComponent('example.com')}&limit=200`, 'eleni');
    expect(partial.body.items).toHaveLength(0);
  });
  it('M2 adding a known email at another shop leaks nothing and grants no visibility', async () => {
    const glyOnly = q(w, `SELECT c.id, c.email FROM customers c WHERE c.org_id = ? AND NOT EXISTS (SELECT 1 FROM customer_subscriptions s WHERE s.customer_id = c.id AND NOT (s.scope_type = 'shop' AND s.scope_id = ?)) LIMIT 1`, w.s.orgId, w.s.shops.glyfada);
    const r = await call(w, 'POST', `/v1/orgs/${w.s.orgId}/customers`, 'maria', { name: 'X', email: glyOnly.email, shopId: w.s.shops.kifisia });
    expect(r.status).toBe(409);
    expect(JSON.stringify(r.body)).not.toContain(glyOnly.id);
    expect((await call(w, 'GET', `/v1/orgs/${w.s.orgId}/customers/${glyOnly.id}`, 'maria')).status).toBe(404);
  });
  it('M3 notes and tags only on customers you can see', async () => {
    const glyOnly = q(w, `SELECT c.id FROM customers c WHERE c.org_id = ? AND NOT EXISTS (SELECT 1 FROM customer_subscriptions s WHERE s.customer_id = c.id AND NOT (s.scope_type = 'shop' AND s.scope_id = ?)) LIMIT 1`, w.s.orgId, w.s.shops.glyfada).id;
    expect((await call(w, 'POST', `/v1/orgs/${w.s.orgId}/customers/${glyOnly}/notes`, 'maria', { body: 'x' })).status).toBe(404);
    expect((await call(w, 'PUT', `/v1/orgs/${w.s.orgId}/customers/${glyOnly}/tags`, 'maria', { tags: ['x'] })).status).toBe(404);
  });
});

describe('M4 M5 posts', () => {
  it('a manager cannot cancel or delete a post of another shop', async () => {
    const own = world();
    for (const who of ['giorgos', 'eleni']) await login(own, who);
    expect((await call(own, 'POST', `/v1/orgs/${own.s.orgId}/posts/${own.s.posts.event}/cancel`, 'giorgos')).status).toBe(403);
    expect(q(own, 'SELECT status FROM posts WHERE id = ?', own.s.posts.event).status).toBe('scheduled');
  });
  it('editing a scheduled post without publishing rights sends it back for approval', async () => {
    const own = world();
    await login(own, 'maria');
    const got = await call(own, 'GET', `/v1/orgs/${own.s.orgId}/posts/${own.s.posts.event}`, 'maria');
    const body = { kind: got.body.kind, defaultLocale: 'el', translations: got.body.translations, channels: got.body.channels, audience: got.body.audience, scheduledAt: got.body.scheduledAt };
    const r = await call(own, 'PATCH', `/v1/orgs/${own.s.orgId}/posts/${own.s.posts.event}`, 'maria', body);
    expect(r.body.status).toBe('pending_approval');
    expect(q(own, "SELECT count(*) n FROM jobs WHERE dedupe_key = ? AND done_at IS NULL", `send_post:${own.s.posts.event}`).n).toBe(0);
  });
});

describe('M6 refresh race', () => {
  it('the same refresh token twice at once: one wins, the family dies', async () => {
    const own = world();
    await login(own, 'eleni');
    const [a, b] = await Promise.all([
      call(own, 'POST', '/v1/auth/refresh', undefined, { refreshToken: own.refresh.eleni }),
      call(own, 'POST', '/v1/auth/refresh', undefined, { refreshToken: own.refresh.eleni }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 401]);
    const winner = a.status === 200 ? a : b;
    expect((await call(own, 'POST', '/v1/auth/refresh', undefined, { refreshToken: winner.body.refreshToken })).status).toBe(401);
  });
});

describe('M7 foreign ids', () => {
  it('ids from another business are refused', async () => {
    const other = world();
    const foreignVariant = other.s.variants['p-olive-oil']!;
    const foreignCategory = q(other, 'SELECT id FROM categories LIMIT 1').id;
    // the two worlds share nothing, so copy the foreign rows into ours under the other org
    const otherOrg = uuidv7();
    w.db.prepare("INSERT INTO organizations (id, name, slug, created_at) VALUES (?, 'Other', 'other-sec', ?)").run(otherOrg, clock);
    const op = uuidv7();
    w.db.prepare("INSERT INTO products (id, org_id, name, search_key, created_at, updated_at) VALUES (?, ?, 'X', 'x', ?, ?)").run(op, otherOrg, clock, clock);
    w.db.prepare('INSERT INTO product_variants (id, org_id, product_id, is_default, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)').run(foreignVariant, otherOrg, op, clock, clock);
    w.db.prepare("INSERT INTO categories (id, org_id, name) VALUES (?, ?, 'X')").run(foreignCategory, otherOrg);
    const shop = uuidv7();
    w.db.prepare("INSERT INTO shops (id, org_id, name, slug, created_at) VALUES (?, ?, 'S', 's', ?)").run(shop, otherOrg, clock);
    const unknown = q(w, 'SELECT id FROM unknown_scans WHERE org_id = ? AND resolved_at IS NULL LIMIT 1', w.s.orgId).id;
    expect((await call(w, 'POST', `/v1/orgs/${w.s.orgId}/unknown-scans/${unknown}/resolve`, 'eleni', { variantId: foreignVariant })).status).toBe(404);
    expect((await call(w, 'PATCH', `/v1/orgs/${w.s.orgId}/products/${w.s.products['p-candle']}`, 'eleni', { categoryId: foreignCategory })).status).toBe(400);
    expect((await call(w, 'POST', `/v1/orgs/${w.s.orgId}/join-links`, 'eleni', { scopeType: 'shop', scopeId: shop })).status).toBe(404);
    expect((await call(w, 'POST', `/v1/orgs/${w.s.orgId}/posts/audience-preview`, 'eleni', { audience: { scopes: [{ scopeType: 'shop', scopeId: shop }] }, channels: ['feed'] })).status).toBe(404);
  });
});

describe('M8 held messages', () => {
  it('a push held overnight is not sent if push was turned off before morning', async () => {
    const own = world();
    for (const who of ['nikos', 'anna']) await login(own, who);
    own.db.prepare('UPDATE organizations SET posts_need_approval = 0 WHERE id = ?').run(own.s.orgId);
    let t = clock - (clock % 60_000);
    while (localMinutes(t, 'Europe/Athens') !== 23 * 60) t += 60_000;
    const saved = clock;
    clock = t;
    await login(own, 'nikos');
    await login(own, 'anna');
    const p = await call(own, 'POST', `/v1/orgs/${own.s.orgId}/posts`, 'nikos', {
      kind: 'news', defaultLocale: 'el', translations: { el: { title: 'Νύχτα', body: 'x' } }, channels: ['feed', 'push'], audience: { scopes: [{ scopeType: 'org', scopeId: own.s.orgId }] },
    });
    await call(own, 'POST', `/v1/orgs/${own.s.orgId}/posts/${p.body.id}/publish`, 'nikos');
    await runJobs({ cfg: { db: own.db, jwtSecret: SECRET, publicWebUrl: 'http://x' } }, clock);
    const annaCustomer = q(own, 'SELECT id FROM customers WHERE user_id = ? AND org_id = ?', own.s.users.anna, own.s.orgId).id;
    expect(q(own, "SELECT status FROM deliveries WHERE post_id = ? AND customer_id = ? AND channel = 'push'", p.body.id, annaCustomer).status).toBe('held');
    expect((await call(own, 'PUT', '/v1/c/channels', 'anna', { orgId: own.s.orgId, channel: 'push', on: false })).status).toBe(204);
    clock = t + 11 * 3600_000;
    await runJobs({ cfg: { db: own.db, jwtSecret: SECRET, publicWebUrl: 'http://x' } }, clock);
    const d = q(own, "SELECT status, skip_reason FROM deliveries WHERE post_id = ? AND customer_id = ? AND channel = 'push'", p.body.id, annaCustomer);
    expect(d).toEqual({ status: 'skipped', skip_reason: 'no_consent' });
    clock = saved;
  });
});

describe('M10 M13 input limits', () => {
  it('an unknown timezone is refused, and a broken org does not stop the nightly rollup for others', async () => {
    expect((await call(w, 'PATCH', `/v1/orgs/${w.s.orgId}`, 'eleni', { timezone: 'Mars/Olympus_Mons' })).status).toBe(400);
    expect((await call(w, 'PATCH', `/v1/orgs/${w.s.orgId}`, 'eleni', { timezone: 'Europe/Nicosia' })).status).toBe(200);
    const own = world();
    const bad = uuidv7();
    own.db.prepare("INSERT INTO organizations (id, name, slug, timezone, created_at) VALUES (?, 'Bad', 'bad', 'Mars/Base', ?)").run(bad, clock);
    own.db.prepare('DELETE FROM daily_shop_stats').run();
    const lines: string[] = [];
    rollup(own.db, clock, (l) => lines.push(l));
    expect(lines.some((l) => l.includes(bad))).toBe(true);
    expect(q(own, 'SELECT count(*) n FROM daily_shop_stats').n).toBeGreaterThan(0);
  });
  it('oversized bodies and lists are refused', async () => {
    const big = 'x'.repeat(1_100_000);
    expect((await call(w, 'POST', `/v1/orgs/${w.s.orgId}/products`, 'eleni', { name: 'x', description: big })).status).toBe(413);
    const many = Array.from({ length: 21 }, (_, i) => `c${i}`);
    expect((await call(w, 'POST', '/v1/public/join/kif7q2', undefined, { name: 'A', email: 'many@example.com', locale: 'en', emailNews: false, push: false, over15: true, interests: many })).status).toBe(400);
    const post = await call(w, 'POST', `/v1/orgs/${w.s.orgId}/posts`, 'eleni', { kind: 'news', defaultLocale: 'el', translations: { el: { title: 't'.repeat(300), body: 'x' } }, channels: ['feed'], audience: { scopes: [{ scopeType: 'org', scopeId: w.s.orgId }] } });
    expect(post.status).toBe(400);
  });
});

describe('contract additions', () => {
  it('following carries the org slug, top sellers carry the unit', async () => {
    const me = await call(w, 'GET', '/v1/me/context', 'anna');
    expect(me.body.following[0].orgSlug).toBe('lemoni');
    const top = await call(w, 'GET', `/v1/orgs/${w.s.orgId}/reports/top-sellers?days=60`, 'eleni');
    expect(top.body[0]).toHaveProperty('uom');
  });
  it('a barcode can be detached and sync tells offline phones', async () => {
    const full = await call(w, 'GET', `/v1/orgs/${w.s.orgId}/shops/${w.s.shops.kifisia}/sync`, 'eleni');
    clock += 1000;
    for (const who of ['eleni']) await login(w, who);
    const product = await call(w, 'GET', `/v1/orgs/${w.s.orgId}/products/${w.s.products['p-greek-coffee']}`, 'eleni');
    const box = product.body.variants[0].barcodes.find((b: { packQty: number }) => b.packQty === 12);
    expect((await call(w, 'DELETE', `/v1/orgs/${w.s.orgId}/variants/${product.body.variants[0].id}/barcodes/${box.id}`, 'eleni')).status).toBe(204);
    const inc = await call(w, 'GET', `/v1/orgs/${w.s.orgId}/shops/${w.s.shops.kifisia}/sync?since=${full.body.cursor}`, 'eleni');
    expect(inc.body.tombstones.barcodes).toEqual([box.id]);
  });
  it('an account email change needs a code to the new address and tells the old one', async () => {
    const own = world();
    await login(own, 'anna');
    const req = await call(own, 'POST', '/v1/me/email', 'anna', { email: 'anna.new@example.com', password: 'custock' });
    expect(req.body.devCode).toMatch(/^\d{6}$/);
    expect((await call(own, 'POST', '/v1/me/email/verify', 'anna', { email: 'anna.new@example.com', code: '000000' === req.body.devCode ? '111111' : '000000' })).status).toBe(400);
    expect((await call(own, 'POST', '/v1/me/email/verify', 'anna', { email: 'anna.new@example.com', code: req.body.devCode })).status).toBe(204);
    expect(q(own, 'SELECT email FROM users WHERE id = ?', own.s.users.anna).email).toBe('anna.new@example.com');
    expect(q(own, 'SELECT email FROM customers WHERE user_id = ?', own.s.users.anna).email).toBe('anna.new@example.com');
    expect(q(own, "SELECT count(*) n FROM dev_outbox WHERE to_address = 'anna@example.com' AND json_extract(payload, '$.type') = 'email_changed'").n).toBe(1);
  });
});
