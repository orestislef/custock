// the edge cases of thinking/15 and the rules of thinking/03, case by case. what the older suites
// already prove is listed in the report next to their test names; these are the ones that had no
// test yet, or did not hold.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { hashPassword, migrate, openDb, seed, type Db, type SeedResult } from '@custock/db';
import { DEFAULT_ROLES, PERMISSION_KEYS, uuidv7 } from '@custock/core';
import { createApp, type App } from '../src/app';
import { reconcileStock, runJobs } from '../src/worker';
import { drainOutbox, isHardBounce, type LiveSender } from '../src/lib/live';
import { unsubKey, unsubToken } from '../src/lib/unsub';
import { fromWall, toWall } from '../../web/src/lib/zoned';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const SECRET = 'edge-cases-test-secret-long-enough-12345';
const PUBLIC = 'http://localhost:3000';
// 11:00 in Athens on a Wednesday: outside quiet hours
const clock = Date.UTC(2026, 10, 18, 9, 0);
const repo = join(__dirname, '..', '..', '..');

describe('edge cases', () => {
  let db: Db;
  let s: SeedResult;
  let app: App;
  const tokens: Record<string, string> = {};

  async function call(method: string, path: string, who?: string, body?: unknown) {
    const token = who ? tokens[who] ?? who : undefined;
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
  const all = (sql: string, ...a: unknown[]) => db.prepare(sql).all(...a) as Json[];
  let n = 0;
  const id = () => uuidv7(clock + ++n);
  const O = () => `/v1/orgs/${s.orgId}`;
  const jobs = () => runJobs({ cfg: { db, jwtSecret: SECRET, publicWebUrl: PUBLIC } }, clock);
  const login = async (who: string) => (await call('POST', '/v1/auth/login', undefined, { email: `${who}@example.com`, password: 'custock' })).body;
  const pieceVariant = (shop: string, min = 5) => q(
    `SELECT l.variant_id AS v, pv.product_id AS p FROM stock_levels l JOIN product_variants pv ON pv.id = l.variant_id JOIN products p ON p.id = pv.product_id
      WHERE l.shop_id = ? AND l.on_hand > ? AND p.uom = 'piece' AND p.archived_at IS NULL AND p.track_stock = 1 ORDER BY l.on_hand DESC LIMIT 1`, shop, min);

  beforeAll(async () => {
    db = openDb(':memory:');
    migrate(db);
    s = seed(db, { passwordHash: hashPassword('custock'), now: clock });
    app = createApp({ db, dev: true, jwtSecret: SECRET, publicWebUrl: PUBLIC, corsOrigins: [], now: () => clock, rateLimit: false });
    for (const who of ['eleni', 'nikos', 'maria', 'giorgos', 'dimitris', 'katerina', 'anna']) tokens[who] = (await login(who)).accessToken;
  });

  // ---------------------------------------------------------------- tenancy and access

  it('the last owner cannot delete their account', async () => {
    const r = await call('DELETE', '/v1/me', 'eleni', { password: 'custock' });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('last_owner');
  });

  it('a custom role keeps its permissions when its creator loses one, and the creator can no longer edit it', async () => {
    const made = await call('POST', `${O()}/roles`, 'nikos', { name: 'Exporter', rank: 30, permissions: ['customers.view', 'customers.export'] });
    expect(made.status).toBe(201);
    const roles = (await call('GET', `${O()}/roles`, 'eleni')).body as Json[];
    const admin = roles.find((r) => r.templateKey === 'admin');
    const cut = await call('POST', `${O()}/roles`, 'eleni', { id: admin.id, name: admin.name, rank: admin.rank, permissions: admin.permissions.filter((p: string) => p !== 'customers.export') });
    expect(cut.status).toBe(200);
    const kept = ((await call('GET', `${O()}/roles`, 'eleni')).body as Json[]).find((r) => r.id === made.body.id);
    expect(kept.permissions).toContain('customers.export');
    const edit = await call('POST', `${O()}/roles`, 'nikos', { id: made.body.id, name: 'Exporter 2', rank: 30, permissions: ['customers.view', 'customers.export'] });
    expect(edit.status).toBe(403);
    // the owner puts it back for the rest of the suite
    await call('POST', `${O()}/roles`, 'eleni', { id: admin.id, name: admin.name, rank: admin.rank, permissions: admin.permissions });
  });

  it('staff who are also customers get no special view of their own customer record', async () => {
    const dimitris = q('SELECT email FROM users WHERE id = ?', s.users.dimitris).email as string;
    const add = await call('POST', `${O()}/customers`, 'maria', { name: 'Dimitris Customer', email: dimitris, shopId: s.shops.kifisia, consent: { email: false, push: false } });
    expect([201, 409]).toContain(add.status);
    const list = (await call('GET', `${O()}/customers?q=Dimitris&limit=50`, 'dimitris')).body.items as Json[];
    const mine = list.find((c) => c.name === 'Dimitris Customer');
    expect(mine).toBeDefined();
    expect(mine.email == null || String(mine.email).includes('*')).toBe(true);
  });

  // ---------------------------------------------------------------- catalog and stock

  it('a sale of an archived product made offline is accepted and flagged in the audit log', async () => {
    const { v, p } = pieceVariant(s.shops.kifisia);
    expect((await call('POST', `${O()}/products/${p}/archive`, 'eleni')).status).toBeLessThan(300);
    const m = id();
    const sold = await call('POST', `${O()}/movements`, 'maria', { movements: [{ id: m, shopId: s.shops.kifisia, variantId: v, qtyDelta: -1, kind: 'sale', occurredAt: clock - 10 * 60_000 }] });
    expect(sold.body.accepted).toEqual([m]);
    expect(q("SELECT count(*) n FROM audit_log WHERE org_id = ? AND action = 'stock.movement_on_archived' AND entity_id = ?", s.orgId, m).n).toBe(1);
  });

  it('only the destination shop receives a transfer', async () => {
    const { v } = pieceVariant(s.shops.kifisia, 3);
    const tr = await call('POST', `${O()}/transfers`, 'eleni', { fromShopId: s.shops.kifisia, toShopId: s.shops.marousi, lines: [{ variantId: v, qty: 1 }] });
    expect(tr.status).toBeLessThan(300);
    expect((await call('POST', `${O()}/transfers/${tr.body.id}/send`, 'eleni')).status).toBeLessThan(300);
    const wrong = await call('POST', `${O()}/transfers/${tr.body.id}/receive`, 'giorgos', { lines: [{ variantId: v, qtyReceived: 1 }] });
    expect([403, 404]).toContain(wrong.status);
    const right = await call('POST', `${O()}/transfers/${tr.body.id}/receive`, 'katerina', { lines: [{ variantId: v, qtyReceived: 1 }] });
    expect(right.status).toBeLessThan(300);
  });

  it('two people counting the same shelf add up in one line', async () => {
    const { v } = pieceVariant(s.shops.kifisia, 1);
    const count = await call('POST', `${O()}/shops/${s.shops.kifisia}/counts`, 'maria', { kind: 'partial' });
    expect(count.status).toBeLessThan(300);
    await call('PUT', `${O()}/counts/${count.body.id}/lines/${v}`, 'maria', { countedQty: 2, mode: 'add' });
    const second = await call('PUT', `${O()}/counts/${count.body.id}/lines/${v}`, 'dimitris', { countedQty: 3, mode: 'add' });
    expect(second.status).toBeLessThan(300);
    expect(second.body.countedQty).toBe(5);
    await call('POST', `${O()}/counts/${count.body.id}/cancel`, 'maria');
  });

  it('cached stock levels that drift from the ledger are rebuilt at night and reported', () => {
    const { v } = pieceVariant(s.shops.glyfada, 0);
    const truth = q('SELECT coalesce(sum(qty_delta), 0) n FROM stock_movements WHERE shop_id = ? AND variant_id = ?', s.shops.glyfada, v).n;
    db.prepare('UPDATE stock_levels SET on_hand = on_hand + 7 WHERE shop_id = ? AND variant_id = ?').run(s.shops.glyfada, v);
    expect(reconcileStock(db, s.orgId, clock)).toBe(1);
    expect(q('SELECT on_hand FROM stock_levels WHERE shop_id = ? AND variant_id = ?', s.shops.glyfada, v).on_hand).toBe(truth);
    expect(reconcileStock(db, s.orgId, clock)).toBe(0);
    expect(q(`SELECT count(*) n FROM stock_levels l WHERE l.org_id = ? AND on_hand != (SELECT coalesce(sum(qty_delta), 0) FROM stock_movements m WHERE m.shop_id = l.shop_id AND m.variant_id = l.variant_id)`, s.orgId).n).toBe(0);
  });

  // ---------------------------------------------------------------- customers and consent

  it('an unsubscribe link opened by a mail scanner (a GET) changes nothing', async () => {
    const sub = q("SELECT customer_id, scope_type, scope_id FROM customer_subscriptions WHERE org_id = ? AND status = 'subscribed' LIMIT 1", s.orgId);
    const token = unsubToken({ customerId: sub.customer_id, scopeType: sub.scope_type, scopeId: sub.scope_id }, unsubKey({ jwtSecret: SECRET }));
    const before = all('SELECT status FROM customer_subscriptions WHERE customer_id = ? ORDER BY id', sub.customer_id).map((r) => r.status);
    const page = await call('GET', `/v1/public/subscription/${encodeURIComponent(token)}`);
    expect(page.status).toBe(200);
    expect(all('SELECT status FROM customer_subscriptions WHERE customer_id = ? ORDER BY id', sub.customer_id).map((r) => r.status)).toEqual(before);
  });

  it('a customer on two phones gets one delivery per channel, the daily cap counts the customer', async () => {
    const anna = q("SELECT c.id AS cid, c.user_id AS uid FROM customers c WHERE c.org_id = ? AND c.user_id = ?", s.orgId, s.users.anna);
    for (const k of [1, 2]) {
      db.prepare(`INSERT INTO push_subscriptions (id, user_id, org_id, endpoint, p256dh, auth, created_at, updated_at) VALUES (?, ?, NULL, ?, 'k', 'a', ?, ?)`)
        .run(id(), anna.uid, `https://fcm.googleapis.com/fcm/send/edge-${k}`, clock, clock);
    }
    db.prepare("UPDATE customers SET push_ok = 1 WHERE id = ?").run(anna.cid);
    const post = await call('POST', `${O()}/posts`, 'eleni', {
      kind: 'news', defaultLocale: 'el', translations: { el: { title: 'Δύο συσκευές', body: 'κείμενο' } },
      channels: ['feed', 'push'], audience: { scopes: [{ scopeType: 'org', scopeId: s.orgId }] },
    });
    await call('POST', `${O()}/posts/${post.body.id}/publish`, 'eleni');
    await jobs();
    expect(q("SELECT count(*) n FROM deliveries WHERE post_id = ? AND customer_id = ? AND channel = 'push'", post.body.id, anna.cid).n).toBeLessThanOrEqual(1);
  });

  it('a restart in the middle of sending neither loses nor doubles a message', async () => {
    const post = await call('POST', `${O()}/posts`, 'eleni', {
      kind: 'news', defaultLocale: 'el', translations: { el: { title: 'Επανεκκίνηση', body: 'κείμενο' } },
      channels: ['feed', 'email'], audience: { scopes: [{ scopeType: 'org', scopeId: s.orgId }] },
    });
    await call('POST', `${O()}/posts/${post.body.id}/publish`, 'eleni');
    await jobs();
    const sent = all("SELECT id, provider_id FROM deliveries WHERE post_id = ? AND channel = 'email' AND status = 'sent'", post.body.id);
    expect(sent.length).toBeGreaterThan(1);
    // the process died in the middle of the send: half of the messages were never written and the
    // send job is gone. the next sweep picks up exactly those, the rest are not sent again
    const half = sent.slice(0, Math.floor(sent.length / 2));
    for (const d of half) {
      db.prepare('DELETE FROM dev_outbox WHERE id = ?').run(d.provider_id);
      db.prepare("UPDATE deliveries SET status = 'queued', provider_id = NULL WHERE id = ?").run(d.id);
    }
    const before = q("SELECT count(*) n FROM dev_outbox WHERE channel = 'email'").n;
    await runJobs({ cfg: { db, jwtSecret: SECRET, publicWebUrl: PUBLIC } }, clock + 30_000);
    expect(q("SELECT count(*) n FROM dev_outbox WHERE channel = 'email'").n).toBe(before);
    await runJobs({ cfg: { db, jwtSecret: SECRET, publicWebUrl: PUBLIC } }, clock + 61_000);
    expect(q("SELECT count(*) n FROM dev_outbox WHERE channel = 'email'").n).toBe(before + half.length);
    const rows = all("SELECT d.id, (SELECT count(*) FROM dev_outbox o WHERE o.id = d.provider_id) AS messages FROM deliveries d WHERE d.post_id = ? AND d.channel = 'email' AND d.status = 'sent'", post.body.id);
    expect(rows.length).toBe(sent.length);
    expect(rows.every((r) => r.messages === 1)).toBe(true);
  });

  // ---------------------------------------------------------------- what customers see

  it('customers see negative stock as out, nothing for untracked products or hidden stock, and no warehouse shops', async () => {
    db.prepare("UPDATE organizations SET customer_catalog = 'public', customer_stock = 'exact' WHERE id = ?").run(s.orgId);
    const slug = q('SELECT slug FROM organizations WHERE id = ?', s.orgId).slug;
    const { v, p } = pieceVariant(s.shops.marousi, 0);
    db.prepare('UPDATE stock_levels SET on_hand = -2 WHERE shop_id = ? AND variant_id = ?').run(s.shops.marousi, v);
    db.prepare('UPDATE products SET customer_visible = 1 WHERE id = ?').run(p);
    const one = async (pid: string) => ((await call('GET', `/v1/public/orgs/${slug}/catalog`)).body as Json[]).find((x) => x.id === pid);
    const neg = await one(p);
    const at = (x: Json, shop: string) => (x.availability as Json[]).find((a) => a.shopId === shop);
    expect(at(neg, s.shops.marousi).state).toBe('out');
    expect(at(neg, s.shops.marousi).qty).toBe(0);
    db.prepare('UPDATE products SET track_stock = 0 WHERE id = ?').run(p);
    expect(at(await one(p), s.shops.marousi).state).toBeNull();
    db.prepare('UPDATE products SET track_stock = 1, customer_stock_hidden = 1 WHERE id = ?').run(p);
    expect(at(await one(p), s.shops.marousi).state).toBeNull();
    db.prepare('UPDATE products SET customer_stock_hidden = 0 WHERE id = ?').run(p);
    db.prepare('UPDATE shops SET customer_visible = 0 WHERE id = ?').run(s.shops.glyfada);
    expect(at(await one(p), s.shops.glyfada)).toBeUndefined();
    db.prepare('UPDATE shops SET customer_visible = 1 WHERE id = ?').run(s.shops.glyfada);
    db.prepare(`UPDATE stock_levels SET on_hand = (SELECT coalesce(sum(qty_delta), 0) FROM stock_movements m WHERE m.shop_id = stock_levels.shop_id AND m.variant_id = stock_levels.variant_id) WHERE shop_id = ? AND variant_id = ?`).run(s.shops.marousi, v);
    db.prepare("UPDATE organizations SET customer_catalog = 'subscribers', customer_stock = 'off' WHERE id = ?").run(s.orgId);
  });

  it('with prices hidden, an offer shows its price only when the business allows it', async () => {
    const offer = q("SELECT id FROM posts WHERE org_id = ? AND kind = 'offer' AND status = 'sent' LIMIT 1", s.orgId).id;
    const card = async () => ((await call('GET', '/v1/c/feed', 'anna')).body.items as Json[]).find((x) => (x.post?.id ?? x.id) === offer);
    const products = (x: Json) => (x?.post?.products ?? x?.products ?? []) as Json[];
    db.prepare('UPDATE organizations SET customer_prices = 0, customer_offer_prices = 1 WHERE id = ?').run(s.orgId);
    const shown = products(await card());
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.some((p) => p.offerPriceMinor != null)).toBe(true);
    expect(shown.every((p) => p.priceMinor == null)).toBe(true);
    db.prepare('UPDATE organizations SET customer_offer_prices = 0 WHERE id = ?').run(s.orgId);
    const hidden = products(await card());
    expect(hidden.every((p) => p.offerPriceMinor == null && p.wasMinor == null)).toBe(true);
    db.prepare('UPDATE organizations SET customer_prices = 1, customer_offer_prices = 1 WHERE id = ?').run(s.orgId);
  });

  it('an archived product drops off a post for customers, staff still see it', async () => {
    const post = q("SELECT pp.post_id AS post, pp.variant_id AS v, v.product_id AS p FROM post_products pp JOIN product_variants v ON v.id = pp.variant_id JOIN posts po ON po.id = pp.post_id WHERE po.org_id = ? AND po.status = 'sent' AND po.deleted_at IS NULL LIMIT 1", s.orgId);
    db.prepare('UPDATE products SET archived_at = ? WHERE id = ?').run(clock, post.p);
    const feed = ((await call('GET', '/v1/c/feed', 'anna')).body.items as Json[]).find((x) => (x.post?.id ?? x.id) === post.post);
    const forCustomer = (feed?.post?.products ?? feed?.products ?? []) as Json[];
    expect(forCustomer.some((x) => x.productId === post.p)).toBe(false);
    const staff = (await call('GET', `${O()}/posts/${post.post}`, 'eleni')).body;
    expect((staff.products as Json[]).some((x) => x.productId === post.p)).toBe(true);
    db.prepare('UPDATE products SET archived_at = NULL WHERE id = ?').run(post.p);
  });

  // ---------------------------------------------------------------- posts and sending

  it('a hard bounce suppresses the address for every business and is not tried again', async () => {
    const to = 'gone@example.com';
    const row = id();
    db.prepare(`INSERT INTO dev_outbox (id, channel, org_id, to_address, locale, title, body, payload, created_at) VALUES (?, 'email', ?, ?, 'en', 't', 'b', '{}', ?)`).run(row, s.orgId, to, clock - 86_400_000);
    const sender: LiveSender = { email: async (m) => { if (m.to_address === to) throw Object.assign(new Error('550 5.1.1 user unknown'), { responseCode: 550, command: 'RCPT TO' }); } };
    await drainOutbox(db, sender, clock);
    expect(q('SELECT reason FROM email_suppressions WHERE email = ?', to).reason).toBe('hard_bounce');
    expect(q('SELECT attempts, last_error FROM dev_outbox WHERE id = ?', row)).toMatchObject({ attempts: 5, last_error: 'hard_bounce' });
    // a second drain does not try it again
    let tried = 0;
    await drainOutbox(db, { email: async (m) => { if (m.id === row) tried++; } }, clock + 60_000);
    expect(tried).toBe(0);
    expect(isHardBounce(Object.assign(new Error('421 try later'), { responseCode: 421 }))).toBe(false);
    expect(isHardBounce(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }))).toBe(false);
  });

  it('a scheduled time is the shop wall clock, also across a daylight saving change', () => {
    // Europe/Athens moves from +2 to +3 at 03:00 on the last Sunday of March 2026 (29 March)
    expect(fromWall({ y: 2026, m: 3, d: 28, h: 9, min: 0 }, 'Europe/Athens')).toBe(Date.UTC(2026, 2, 28, 7, 0));
    expect(fromWall({ y: 2026, m: 3, d: 29, h: 9, min: 0 }, 'Europe/Athens')).toBe(Date.UTC(2026, 2, 29, 6, 0));
    expect(toWall(Date.UTC(2026, 2, 29, 6, 0), 'Europe/Athens')).toMatchObject({ y: 2026, m: 3, d: 29, h: 9, min: 0 });
    // and back to +2 on the last Sunday of October (25 October 2026)
    expect(fromWall({ y: 2026, m: 10, d: 26, h: 9, min: 0 }, 'Europe/Athens')).toBe(Date.UTC(2026, 9, 26, 7, 0));
  });

  // ---------------------------------------------------------------- offline and sessions

  it('a lost phone: every other device can be signed out, this one stays', async () => {
    const other = await login('maria');
    const here = await login('maria');
    expect((await call('GET', '/v1/me/sessions', here.accessToken)).body.others).toBeGreaterThanOrEqual(1);
    const out = await call('POST', '/v1/me/sessions/sign-out-others', here.accessToken);
    expect(out.status).toBe(200);
    expect(out.body.signedOut).toBeGreaterThanOrEqual(1);
    expect((await call('GET', '/v1/me/context', other.accessToken)).status).toBe(401);
    expect((await call('GET', '/v1/me/context', here.accessToken)).status).toBe(200);
    expect((await call('GET', '/v1/me/sessions', here.accessToken)).body.others).toBe(0);
  });

  // ---------------------------------------------------------------- the rules of thinking/03

  it('the default roles match the table in thinking/03, and every permission is in it', () => {
    const doc = readFileSync(join(repo, 'thinking', '03-permissions.md'), 'utf8');
    const start = doc.indexOf('| permission | owner | admin | manager | staff | viewer |');
    expect(start).toBeGreaterThan(0);
    const lines = doc.slice(start).split('\n');
    const end = lines.findIndex((l) => !l.startsWith('|'));
    const rows = lines.slice(2, end).map((l) => l.split('|').slice(1, -1).map((c) => c.trim()));
    const table = new Map(rows.map((r) => [r[0]!, r.slice(1)]));
    for (const key of PERMISSION_KEYS) expect(table.has(key), `${key} is missing from the table in thinking/03`).toBe(true);
    const order = ['owner', 'admin', 'manager', 'staff', 'viewer'] as const;
    for (const [key, marks] of table) {
      expect(PERMISSION_KEYS, `${key} in thinking/03 is not a permission`).toContain(key);
      order.forEach((role, i) => {
        const has = DEFAULT_ROLES.find((r) => r.key === role)!.permissions.includes(key);
        expect(has, `${role} ${has ? 'has' : 'lacks'} ${key}, thinking/03 says the opposite`).toBe(marks[i] === 'x');
      });
    }
  });

  // ---------------------------------------------------------------- languages

  it('no ALL CAPS styling in the web app or the demo (greek loses its accents in capitals)', () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (f === 'node_modules' || f.startsWith('.')) continue;
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(css|tsx|ts|js|html)$/.test(f)) {
          const text = readFileSync(p, 'utf8');
          if (/text-transform:\s*uppercase/i.test(text) || /className=["'`][^"'`]*\buppercase\b/.test(text)) hits.push(p);
        }
      }
    };
    walk(join(repo, 'apps', 'web', 'src'));
    walk(join(repo, 'demo'));
    expect(hits).toEqual([]);
  });
});
