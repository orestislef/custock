// what the live test on the real server found: stock per shop for products that never moved,
// categories, a quiet outbox after sending, super admin alerts, richer pushes, and the business
// logo on top of the emails customers get. nothing is ever sent.

import { beforeAll, describe, expect, it } from 'vitest';
import { hashPassword, migrate, openDb, seed, type Db, type SeedResult } from '@custock/db';
import { uuidv7 } from '@custock/core';
import { createApp, type App } from '../src/app';
import { runCli, type CliIo } from '../src/cli';
import { drainOutbox, tidyOutbox, OUTBOX_KEEP_MS, type LiveSender, type OutboxRow } from '../src/lib/live';
import { devOutboxTransport, emailMessage } from '../src/lib/transport';
import { buildWebPush, pushDecorations } from '../src/lib/webpush';
import { captureError } from '../src/lib/errors';
import { checkStorageAlert, PLATFORM_ALERT_TYPE } from '../src/lib/platform-notify';
import { joinConfirmEmail, otpEmail, postEmail } from '../src/email/messages';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const SECRET = 'live-fixes-test-secret-long-enough-1234';
const clock = Date.now();
const WEB = 'http://localhost:3000/custock';

describe('fixes from the live test', () => {
  let db: Db;
  let s: SeedResult;
  let app: App;
  const tokens: Record<string, string> = {};
  let rootId = '';

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
  const io = (): CliIo & { lines: string[] } => { const lines: string[] = []; return { env: { CUSTOCK_PUBLIC_WEB_URL: WEB }, readStdin: async () => '', out: (l) => lines.push(l), lines }; };

  beforeAll(async () => {
    db = openDb(':memory:');
    migrate(db);
    s = seed(db, { passwordHash: hashPassword('custock'), now: clock });
    app = createApp({ db, dev: true, jwtSecret: SECRET, publicWebUrl: WEB, corsOrigins: [], now: () => clock, rateLimit: false });
    for (const who of ['eleni', 'dimitris']) {
      const r = await call('POST', '/v1/auth/login', undefined, { email: `${who}@example.com`, password: 'custock' });
      tokens[who] = r.body.accessToken;
    }
    rootId = uuidv7(clock);
    db.prepare(`INSERT INTO users (id, email, display_name, password_hash, locale, created_at, updated_at) VALUES (?, 'root@example.com', 'Root', ?, 'en', ?, ?)`)
      .run(rootId, hashPassword('custock'), clock, clock);
    expect(await runCli(db, ['make-superadmin', '--email', 'root@example.com'], io())).toBe(0);
  });

  // ------------------------------------------------------------ stock per shop

  it('lists every shop with 0 for a product that never moved, and counts it as out', async () => {
    const created = await call('POST', `/v1/orgs/${s.orgId}/products`, tokens.eleni, { name: 'Never moved jam', uom: 'piece', variants: [{ priceMinor: 500 }] });
    expect(created.status).toBe(201);
    const p = (await call('GET', `/v1/orgs/${s.orgId}/products/${created.body.id}`, tokens.eleni)).body;
    const shops = new Set(p.levels.map((l: Json) => l.shopId));
    expect(shops).toEqual(new Set(Object.values(s.shops)));
    expect(p.levels.every((l: Json) => l.onHand === 0 && l.lastMovementAt === null)).toBe(true);
    // a staff member at one shop sees that shop only
    const mine = (await call('GET', `/v1/orgs/${s.orgId}/products/${created.body.id}`, tokens.dimitris)).body;
    expect(mine.levels.map((l: Json) => l.shopId)).toEqual([s.shops.kifisia]);
    const out = (await call('GET', `/v1/orgs/${s.orgId}/products?filter=out&limit=200`, tokens.eleni)).body;
    expect(out.items.some((x: Json) => x.id === created.body.id)).toBe(true);
    // received in one shop: that one has stock, the others still show 0
    const v = p.variants[0].id;
    const r = await call('POST', `/v1/orgs/${s.orgId}/movements`, tokens.eleni, { movements: [{ id: uuidv7(clock), shopId: s.shops.kifisia, variantId: v, kind: 'receive', qtyDelta: 12, occurredAt: clock }] });
    expect(r.status).toBe(200);
    const after = (await call('GET', `/v1/orgs/${s.orgId}/products/${created.body.id}`, tokens.eleni)).body;
    expect(after.levels.find((l: Json) => l.shopId === s.shops.kifisia).onHand).toBe(12);
    expect(after.levels.filter((l: Json) => l.onHand === 0)).toHaveLength(2);
  });

  // ------------------------------------------------------------ categories

  it('creates, renames and deletes categories, in three languages, for owners only', async () => {
    const base = `/v1/orgs/${s.orgId}/categories`;
    expect((await call('POST', base, tokens.dimitris, { name: 'Jams' })).status).toBe(403);
    const c = await call('POST', base, tokens.eleni, { name: 'Μαρμελάδες', translations: { en: 'Jams', ru: 'Варенье' } });
    expect(c.status).toBe(201);
    expect(c.body.names).toMatchObject({ el: 'Μαρμελάδες', en: 'Jams', ru: 'Варенье' });
    expect((await call('POST', base, tokens.eleni, { name: 'jams' })).status).toBe(409);

    const list = (await call('GET', base, tokens.eleni)).body as Json[];
    expect(list.find((x) => x.id === c.body.id).names.en).toBe('Jams');
    // people who cannot manage categories get the names in their language only
    const plain = (await call('GET', base, tokens.dimitris)).body as Json[];
    expect(plain.find((x) => x.id === c.body.id).names).toBeUndefined();

    const r = await call('PATCH', `${base}/${c.body.id}`, tokens.eleni, { name: 'Μαρμελάδες και γλυκά', translations: { ru: null } });
    expect(r.status).toBe(200);
    expect(r.body.names.ru).toBeUndefined();

    const p = await call('POST', `/v1/orgs/${s.orgId}/products`, tokens.eleni, { name: 'Fig jam', uom: 'piece', categoryId: c.body.id, variants: [{ priceMinor: 600 }] });
    expect(p.status).toBe(201);
    expect((await call('DELETE', `${base}/${c.body.id}`, tokens.dimitris)).status).toBe(403);
    expect((await call('DELETE', `${base}/${c.body.id}`, tokens.eleni)).status).toBe(204);
    expect(q('SELECT category_id FROM products WHERE id = ?', p.body.id).category_id).toBeNull();
    expect((await call('GET', base, tokens.eleni)).body.some((x: Json) => x.id === c.body.id)).toBe(false);
    expect(q("SELECT count(*) n FROM audit_log WHERE action LIKE 'category.%' AND org_id = ?", s.orgId).n).toBe(3);
  });

  // ------------------------------------------------------------ the outbox after sending

  it('keeps no links or text of a sent message, masks the address, drops it after 30 days', async () => {
    db.prepare('DELETE FROM dev_outbox').run();
    devOutboxTransport(db, () => {}).send(emailMessage(otpEmail('en', { code: '482913' }), { to: 'someone@example.com', locale: 'en', payload: { type: 'otp' } }));
    const seen: OutboxRow[] = [];
    const sender: LiveSender = { email: async (row) => void seen.push({ ...row }) };
    await drainOutbox(db, sender, clock);
    expect(seen[0]!.body).toContain('482913');
    const row = q('SELECT body, html, to_address, title, sent_at, payload FROM dev_outbox');
    expect(row.body).toBeNull();
    expect(row.html).toBeNull();
    expect(row.to_address).toBe('s***@example.com');
    expect(row.title).toBeTruthy();
    expect(JSON.parse(row.payload).type).toBe('otp');
    // a message given up loses its text too, and old sent rows go
    devOutboxTransport(db, () => {}).send(emailMessage(otpEmail('en', { code: '111111' }), { to: 'other@example.com', locale: 'en' }));
    db.prepare("UPDATE dev_outbox SET attempts = 5 WHERE sent_at IS NULL").run();
    db.prepare('UPDATE dev_outbox SET sent_at = ? WHERE sent_at IS NOT NULL').run(clock - OUTBOX_KEEP_MS - 1000);
    const r = tidyOutbox(db, clock);
    expect(r.deleted).toBe(1);
    expect(r.redacted).toBe(1);
    expect(q('SELECT count(*) n FROM dev_outbox WHERE body IS NOT NULL OR html IS NOT NULL').n).toBe(0);
  });

  // ------------------------------------------------------------ super admin alerts

  it('pushes super admins once per new error, also during a push pause', async () => {
    db.prepare('DELETE FROM dev_outbox').run();
    db.prepare('DELETE FROM error_events').run();
    db.prepare(`INSERT INTO push_subscriptions (id, user_id, org_id, endpoint, p256dh, auth, created_at, updated_at) VALUES (?, ?, NULL, 'https://fcm.googleapis.com/fcm/send/root', 'k', 'a', ?, ?)`)
      .run(uuidv7(clock), rootId, clock, clock);
    captureError(db, { kind: 'api', message: 'boom in a test', route: 'GET /v1/x', status: 500 }, { now: clock });
    captureError(db, { kind: 'api', message: 'boom in a test', route: 'GET /v1/x', status: 500 }, { now: clock + 1 });
    const pushes = db.prepare("SELECT user_id, org_id, title, payload FROM dev_outbox WHERE channel = 'push'").all() as Json[];
    expect(pushes).toHaveLength(1);
    expect(pushes[0].user_id).toBe(rootId);
    expect(pushes[0].org_id).toBeNull();
    const payload = JSON.parse(pushes[0].payload);
    expect(payload.type).toBe(PLATFORM_ALERT_TYPE);
    expect(payload.url).toMatch(/\/custock\/admin\/platform\/errors\//);
    expect(payload.icon).toBe(`${WEB}/icons/icon-192.png`);

    db.prepare("INSERT INTO platform_settings (key, value, updated_at) VALUES ('pause_push', '1', ?) ON CONFLICT (key) DO UPDATE SET value = '1'").run(clock);
    const sent: string[] = [];
    await drainOutbox(db, { webpush: async (row) => { sent.push(String(row.title)); return { ok: true }; } }, clock);
    expect(sent).toHaveLength(1);
    db.prepare("DELETE FROM platform_settings WHERE key = 'pause_push'").run();
  });

  it('pushes super admins when storage crosses 70% and 90%, once per line', () => {
    db.prepare('DELETE FROM dev_outbox').run();
    const free = 10 * 1024 ** 3;
    const add = (bytes: number) => db.prepare(`INSERT INTO files (id, org_id, storage_key, purpose, is_public, mime, bytes, created_by, created_at, confirmed_at) VALUES (?, ?, ?, 'product', 1, 'image/webp', ?, NULL, ?, ?)`)
      .run(uuidv7(clock), s.orgId, `orgs/x/${Math.random()}.webp`, bytes, clock, clock);
    const used = (q("SELECT coalesce(sum(bytes), 0) b FROM files WHERE deleted_at IS NULL AND confirmed_at IS NOT NULL AND storage_key NOT LIKE 'http%'").b as number);
    add(Math.ceil(free * 0.71) - used);
    expect(checkStorageAlert(db, clock)).toBe(70);
    expect(checkStorageAlert(db, clock)).toBeNull();
    add(Math.ceil(free * 0.2));
    expect(checkStorageAlert(db, clock)).toBe(90);
    const titles = (db.prepare("SELECT title FROM dev_outbox WHERE channel = 'push'").all() as Json[]).map((r) => r.title);
    expect(titles).toHaveLength(2);
    expect(titles[1]).toMatch(/9\d%/);
    db.prepare("DELETE FROM files WHERE storage_key LIKE 'orgs/x/%'").run();
    // back under: the line resets, nobody is told about going down
    expect(checkStorageAlert(db, clock)).toBeNull();
  });

  it('pushes super admins when the first owner of a new business joins', async () => {
    db.prepare('DELETE FROM dev_outbox').run();
    const out = io();
    expect(await runCli(db, ['create-business', '--name', 'Owner Test', '--slug', 'owner-test', '--owner-email', 'new.owner@example.com', '--invite'], out)).toBe(0);
    const link = out.lines.join(' ').match(/invite\/([\w-]+)/)![1]!;
    const r = await call('POST', '/v1/invites/register', undefined, { token: link, displayName: 'New Owner', password: 'a-good-password-1' });
    expect(r.status).toBe(201);
    const push = q("SELECT title, payload FROM dev_outbox WHERE channel = 'push' AND user_id = ?", rootId);
    expect(push.title).toContain('Owner Test');
    expect(JSON.parse(push.payload).url).toMatch(/\/admin\/platform\//);
  });

  // ------------------------------------------------------------ pushes

  it('gives business pushes the business icon with its version and buttons, under 3 kB', () => {
    const customerDeco = pushDecorations(db, s.orgId, true, 'en', { type: 'post', postId: 'p1' });
    expect(customerDeco.icon).toMatch(new RegExp(`^${WEB}/s/lemoni/icon/192\\?v=\\w+$`));
    expect(customerDeco.actions.map((a) => a.action)).toEqual(['view', 'offers']);
    expect(customerDeco.actions[1]!.url).toBe(`${WEB}/s/lemoni/offers`);
    const staffDeco = pushDecorations(db, s.orgId, false, 'el', { type: 'lowStock' });
    expect(staffDeco.actions.map((a) => a.action)).toEqual(['open']);
    expect(pushDecorations(db, null, false, 'en', { type: 'test' }).icon).toBe(`${WEB}/icons/icon-192.png`);

    const long = 'x'.repeat(5000);
    const m = buildWebPush({
      org_id: s.orgId, customer_id: 'c', title: 'Lemoni', body: long,
      payload: JSON.stringify({ type: 'post', postId: 'p1', url: `${WEB}/s/lemoni`, icon: customerDeco.icon, actions: customerDeco.actions, image: `https://pub.example.r2.dev/${'y'.repeat(400)}.webp` }),
    })!;
    expect(Buffer.byteLength(m.payload)).toBeLessThanOrEqual(3000);
    const data = JSON.parse(m.payload);
    expect(data.icon).toBe(customerDeco.icon);
    expect(data.actions).toHaveLength(2);
    // a too long body is cut, the picture goes before the buttons do
    expect(data.body.length).toBeLessThan(500);
    // a business icon changes its url with the logo
    db.prepare(`INSERT INTO files (id, org_id, storage_key, purpose, is_public, mime, bytes, created_at) VALUES ('logo-file', ?, 'orgs/lemoni/logo/new.png', 'logo', 1, 'image/png', 100, ?)`).run(s.orgId, clock);
    db.prepare("UPDATE organizations SET logo_file_id = 'logo-file' WHERE id = ?").run(s.orgId);
    expect(pushDecorations(db, s.orgId, true, 'en', { type: 'post' }).icon).not.toBe(customerDeco.icon);
    db.prepare('UPDATE organizations SET logo_file_id = NULL WHERE id = ?').run(s.orgId);
  });

  it('prefixes staff alerts with the business for people in several businesses', async () => {
    db.prepare('DELETE FROM dev_outbox').run();
    const { notifyMembers } = await import('../src/lib/notify');
    // dimitris also works for the business made above
    const other = q("SELECT id FROM organizations WHERE slug = 'owner-test'").id;
    db.prepare(`INSERT INTO memberships (id, org_id, user_id, status, joined_at) VALUES (?, ?, ?, 'active', ?)`).run(uuidv7(clock), other, s.users.dimitris, clock);
    notifyMembers(db, s.orgId, { perm: 'stock.view', shopId: s.shops.kifisia, key: 'lowStock', params: () => ({ shop: 'Kifisia', product: 'Honey', count: 1 }) });
    const mine = q("SELECT title FROM dev_outbox WHERE channel = 'push' AND user_id = ?", s.users.dimitris);
    expect(mine.title.startsWith('Lemoni · ')).toBe(true);
    const owner = q("SELECT title FROM dev_outbox WHERE channel = 'push' AND user_id = ?", s.users.eleni);
    expect(owner.title.startsWith('Lemoni')).toBe(false);
  });

  // ------------------------------------------------------------ emails

  it('puts the business logo or name on top of customer emails, the Custock mark on account emails', () => {
    const withLogo = joinConfirmEmail('en', { name: 'Anna', scope: 'Lemoni Kifisia', org: 'Lemoni', url: `${WEB}/confirm/x`, logoUrl: 'https://pub.example.r2.dev/orgs/l/logo/a.png' });
    expect(withLogo.html).toContain('src="https://pub.example.r2.dev/orgs/l/logo/a.png" width="48" height="48" alt="Lemoni"');
    expect(withLogo.html).not.toContain('/email/mark.png');
    expect(withLogo.text).toContain('Sent with Custock');
    const noLogo = postEmail('en', { sender: 'Lemoni Kifisia', org: 'Lemoni', kind: 'news', title: 'Hi', body: 'Body', coverUrl: null, url: `${WEB}/s/lemoni`, products: [], currency: 'EUR', timezone: 'Europe/Athens', validUntil: null, unsubscribeUrl: `${WEB}/unsubscribe/x` });
    expect(noLogo.html).not.toContain('/email/mark.png');
    expect(noLogo.html).toMatch(/font-size:22px[^>]*>Lemoni<\/p>/);
    const account = otpEmail('en', { code: '123456' });
    expect(account.html).toContain('/email/mark.png');
  });
});
