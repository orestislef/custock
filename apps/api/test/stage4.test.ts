// transports (built, never sent), openapi, product variants and photos, uploads

import { beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import nodemailer from 'nodemailer';
import { migrate, openDb, seed, hashPassword, type Db, type SeedResult } from '@custock/db';
import { ean13 } from '@custock/core';
import { createApp, type App } from '../src/app';
import { runJobs } from '../src/worker';
import { buildEmail, buildFcmMessage, drainOutbox, liveProblems, type LiveSender, type OutboxRow } from '../src/lib/live';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const SECRET = 'stage-four-secret-that-is-long-enough-1';
let db: Db;
let s: SeedResult;
let app: App;
let uploadDir: string;
const clock = Date.now();
const tokens: Record<string, string> = {};

async function call(method: string, path: string, who?: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await app.request(path, {
    method,
    headers: { ...(who ? { Authorization: `Bearer ${tokens[who]}` } : {}), ...(body !== undefined && !(body instanceof Uint8Array) ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body === undefined ? undefined : body instanceof Uint8Array ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: Json = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // binary or empty
  }
  return { status: res.status, body: parsed, headers: res.headers };
}

beforeAll(async () => {
  db = openDb(':memory:');
  migrate(db);
  s = seed(db, { passwordHash: hashPassword('custock'), now: clock });
  uploadDir = mkdtempSync(join(tmpdir(), 'custock-uploads-'));
  app = createApp({ db, dev: true, jwtSecret: SECRET, publicWebUrl: 'http://localhost:3000', corsOrigins: [], now: () => clock, rateLimit: false, apiPublicUrl: 'http://localhost:8787', uploadDir });
  for (const who of ['eleni', 'maria', 'dimitris']) {
    const r = await call('POST', '/v1/auth/login', undefined, { email: `${who}@example.com`, password: 'custock' });
    tokens[who] = r.body.accessToken;
  }
});

const q = (sql: string, ...p: unknown[]) => db.prepare(sql).get(...p) as Json;

describe('transports: messages are built right and never sent', () => {
  it('a post push carries the org thread, the deep link, the image and the text in the reader language', async () => {
    db.prepare('UPDATE organizations SET posts_need_approval = 0 WHERE id = ?').run(s.orgId);
    const post = await call('POST', `/v1/orgs/${s.orgId}/posts`, 'eleni', {
      kind: 'news', defaultLocale: 'el', translations: { el: { title: 'Νέα', body: 'κείμενο' }, ru: { title: 'Новости', body: 'текст' } },
      channels: ['feed', 'push', 'email'], audience: { scopes: [{ scopeType: 'shop', scopeId: s.shops.kifisia }] }, coverUrl: 'https://example.com/cover.jpg',
    });
    await call('POST', `/v1/orgs/${s.orgId}/posts/${post.body.id}/publish`, 'eleni');
    // quiet hours would hold pushes: run the jobs at noon athens time
    let t = clock;
    const { localMinutes } = await import('../src/lib/time');
    while (localMinutes(t, 'Europe/Athens') !== 12 * 60) t += 60_000;
    await runJobs({ cfg: { db, jwtSecret: SECRET, publicWebUrl: 'http://localhost:3000' } }, t);
    const annaCustomer = q('SELECT id FROM customers WHERE user_id = ? AND org_id = ?', s.users.anna, s.orgId).id;
    const row = q("SELECT * FROM dev_outbox WHERE customer_id = ? AND channel = 'push' AND json_extract(payload, '$.postId') = ?", annaCustomer, post.body.id) as OutboxRow;
    expect(row.body).toBe('Новости');
    const msg = buildFcmMessage(row, 'device-token-1') as Json;
    expect(msg.message.token).toBe('device-token-1');
    expect(msg.message.notification).toEqual({ title: 'Lemoni Kifisia', body: 'Новости', image: 'https://example.com/cover.jpg' });
    expect(msg.message.apns.payload.aps['thread-id']).toBe(s.orgId);
    expect(msg.message.apns.fcm_options.image).toBe('https://example.com/cover.jpg');
    expect(msg.message.data.link).toBe(`custock://post/${post.body.id}`);
    expect(Object.values(msg.message.data).every((v) => typeof v === 'string')).toBe(true);
    expect(q('SELECT count(*) n FROM dev_outbox WHERE sent_at IS NOT NULL').n).toBe(0);

    // and the email: shop name as sender, replies to the shop, one click unsubscribe headers
    const mailRow = q("SELECT * FROM dev_outbox WHERE channel = 'email' AND json_extract(payload, '$.postId') = ? LIMIT 1", post.body.id) as OutboxRow;
    const mail = buildEmail(mailRow, 'news@custock.app');
    expect(mail.from).toEqual({ name: 'Lemoni Kifisia via Custock', address: 'news@custock.app' });
    expect(mail.replyTo).toBe('kifisia@lemoni.example.com');
    const raw = (await nodemailer.createTransport({ streamTransport: true, buffer: true }).sendMail(mail)).message.toString().replace(/\r\n[ \t]+/g, ' ').replace(/\r\n/g, '\n');
    expect(raw).toMatch(/^List-Unsubscribe: <http:\/\/localhost:3000\/unsubscribe\/[^>]+>$/m);
    expect(raw).toMatch(/^List-Unsubscribe-Post: List-Unsubscribe=One-Click$/m);
    expect(raw).toMatch(/^Reply-To: kifisia@lemoni\.example\.com$/m);
    expect(raw).toMatch(/^From: "?Lemoni Kifisia via Custock"? <news@custock\.app>$/m);
  });
  it('a silent push is data only', () => {
    const row: OutboxRow = { id: 'x', channel: 'push', org_id: 'o', user_id: 'u', customer_id: null, to_address: null, locale: 'el', title: '', body: '', payload: JSON.stringify({ type: 'perms_changed', silent: true }), created_at: 1 };
    const msg = buildFcmMessage(row, 't') as Json;
    expect(msg.message.notification).toBeUndefined();
    expect(msg.message.apns.payload.aps['content-available']).toBe(1);
    expect(msg.message.data.type).toBe('perms_changed');
  });
  it('the drain marks rows sent and drops dead device tokens, through a fake sender', async () => {
    const sent: string[] = [];
    const fake: LiveSender = {
      async push(_row, token) {
        sent.push(token);
        return token === 'dev-token-anna' ? { ok: false, unregistered: true, error: 'UNREGISTERED' } : { ok: true };
      },
      async email(row) {
        sent.push(`mail:${row.to_address}`);
      },
    };
    const r = await drainOutbox(db, fake, clock, 1000);
    expect(r.sent).toBeGreaterThan(0);
    expect(sent).toContain('dev-token-anna');
    expect(q('SELECT fcm_token, revoked_at FROM devices WHERE user_id = ?', s.users.anna)).toEqual({ fcm_token: null, revoked_at: clock });
    expect(q('SELECT count(*) n FROM dev_outbox WHERE sent_at IS NULL').n).toBe(0);
  });
  it('live mode refuses to start without credentials and an explicit yes', () => {
    expect(liveProblems({}, () => true)).toHaveLength(4);
    expect(liveProblems({ CUSTOCK_ALLOW_SENDING: 'yes', CUSTOCK_FCM_SERVICE_ACCOUNT: '/x.json', CUSTOCK_SMTP_URL: 'smtps://a:b@c', CUSTOCK_MAIL_FROM: 'a@b' }, () => false)).toEqual([
      'CUSTOCK_FCM_SERVICE_ACCOUNT points to a missing file',
    ]);
    const dir = mkdtempSync(join(tmpdir(), 'custock-live-'));
    const env = { ...process.env, CUSTOCK_DEV: '1', CUSTOCK_TRANSPORT: 'live', CUSTOCK_ALLOW_SENDING: '', CUSTOCK_DB: join(dir, 'x.db'), CUSTOCK_WORKER: '0' };
    const r = spawnSync(process.execPath, ['--import', 'tsx', 'src/main.ts'], { env, encoding: 'utf8', timeout: 30_000 });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('CUSTOCK_ALLOW_SENDING=yes is not set');
  });
});

describe('openapi', () => {
  it('lists every route with schemas from the contract', async () => {
    const r = await call('GET', '/v1/openapi.json');
    expect(r.status).toBe(200);
    expect(r.body.openapi).toBe('3.1.0');
    expect(Object.keys(r.body.paths).length).toBeGreaterThan(80);
    expect(r.body.paths['/v1/orgs/{org}/products'].post.requestBody.content['application/json'].schema.$ref).toBe('#/components/schemas/ProductInput');
    expect(r.body.paths['/v1/public/join/{code}'].get.security).toEqual([]);
    expect(r.body.components.schemas.Product.properties.variants).toBeTruthy();
    expect(r.body.components.schemas.ProductInput.properties.variants.maxItems).toBe(50);
  });
});

describe('product variants and photos', () => {
  const org = () => `/v1/orgs/${s.orgId}`;
  it('creates a product with variants, barcodes and photos, cost only with the right permission', async () => {
    const body = {
      name: 'Μπλουζάκι', uom: 'piece', taxRateBp: 2400, trackStock: true,
      variants: [
        { sku: 'TEE-S', options: { el: 'Μικρό', en: 'Small' }, priceMinor: 1500, costMinor: 600, barcodes: [{ code: ean13('520777000001'), packQty: 1 }] },
        { sku: 'TEE-M', options: { el: 'Μεσαίο', en: 'Medium' }, priceMinor: 1500, costMinor: 600, barcodes: [{ code: ean13('520777000002'), packQty: 1 }] },
      ],
      imageUrls: ['https://example.com/tee-front.jpg', 'https://example.com/tee-back.jpg'],
    };
    const r = await call('POST', `${org()}/products`, 'maria', body);
    expect(r.status).toBe(201);
    expect(r.body.variants.map((v: { sku: string }) => v.sku)).toEqual(['TEE-S', 'TEE-M']);
    expect(r.body.variants[0].isDefault).toBe(true);
    expect(r.body.images.map((i: { url: string }) => i.url)).toEqual(body.imageUrls);
    expect(q('SELECT cost_minor c FROM product_variants WHERE id = ?', r.body.variants[0].id).c).toBeNull();
    const owner = await call('POST', `${org()}/products`, 'eleni', { ...body, name: 'Άλλο', variants: [{ ...body.variants[0], sku: 'TEE-L', barcodes: [] }], imageUrls: [] });
    expect(q('SELECT cost_minor c FROM product_variants WHERE id = ?', owner.body.variants[0].id).c).toBe(600);
    const dup = await call('POST', `${org()}/products`, 'eleni', { ...body, name: 'Dup', variants: [{ sku: 'X1', barcodes: [{ code: ean13('520777000001') }] }], imageUrls: [] });
    expect(dup.body.code).toBe('barcode_taken');
    expect((await call('POST', `${org()}/products`, 'eleni', { name: 'Bad', variants: [{ barcodes: [{ code: 'A' }, { code: 'A' }] }] })).status).toBe(400);
    expect((await call('POST', `${org()}/products`, 'eleni', { name: 'Bad', imageUrls: ['http://insecure.example.com/x.jpg'] })).status).toBe(400);
    expect((await call('POST', `${org()}/products`, 'eleni', { name: 'Big', variants: Array.from({ length: 51 }, () => ({})) })).status).toBe(400);
  });
  it('updates the variant list: price needs its permission, removed variants with history are archived, without are deleted', async () => {
    const created = await call('POST', `${org()}/products`, 'eleni', {
      name: 'Κερί αρωματικό', variants: [{ sku: 'C-1', priceMinor: 900 }, { sku: 'C-2', priceMinor: 1100 }, { sku: 'C-3', priceMinor: 1300 }],
    });
    const [v1, v2, v3] = created.body.variants as { id: string }[];
    // a sale on the second one gives it history
    await call('POST', `${org()}/movements`, 'eleni', { movements: [{ id: crypto.randomUUID(), shopId: s.shops.kifisia, variantId: v2!.id, qtyDelta: 5, kind: 'receive', occurredAt: clock }] });
    const got = await call('GET', `${org()}/products/${created.body.id}`, 'maria');
    const etag = got.headers.get('ETag')!;
    const priced = await call('PATCH', `${org()}/products/${created.body.id}`, 'maria', { variants: [{ id: v1!.id, priceMinor: 999 }] }, { 'If-Match': etag });
    expect(priced.status).toBe(403);
    const r = await call('PATCH', `${org()}/products/${created.body.id}`, 'maria', { variants: [{ id: v1!.id, sku: 'C-1B' }, { sku: 'C-4', priceMinor: 1500 }] }, { 'If-Match': etag });
    expect(r.status).toBe(200);
    expect(r.body.variants.map((v: { sku: string }) => v.sku)).toEqual(['C-1B', 'C-4']);
    expect(q('SELECT archived_at IS NOT NULL a FROM product_variants WHERE id = ?', v2!.id).a).toBe(1);
    expect(q('SELECT count(*) n FROM product_variants WHERE id = ?', v3!.id).n).toBe(0);
    // the etag moved, an old one is refused
    expect((await call('PATCH', `${org()}/products/${created.body.id}`, 'maria', { variants: [{ id: v1!.id }] }, { 'If-Match': etag })).status).toBe(412);
  });
  it('a barcode can move between two variants in one save', async () => {
    const code = ean13('520777000099');
    const p = await call('POST', `${org()}/products`, 'eleni', { name: 'Κούπα νέα', variants: [{ sku: 'K-A', barcodes: [{ code }] }, { sku: 'K-B', barcodes: [] }] });
    const [a, b] = p.body.variants as { id: string }[];
    const r = await call('PATCH', `${org()}/products/${p.body.id}`, 'eleni', { variants: [{ id: a!.id, barcodes: [] }, { id: b!.id, barcodes: [{ code }] }] });
    expect(r.status).toBe(200);
    expect(r.body.variants[1].barcodes.map((x: { code: string }) => x.code)).toEqual([code]);
  });
});

describe('uploads', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  it('presign, upload, serve, and use as a product photo', async () => {
    const slot = await call('POST', `/v1/orgs/${s.orgId}/uploads/presign`, 'maria', { purpose: 'product', mime: 'image/png', bytes: png.length });
    expect(slot.status).toBe(201);
    expect(slot.body.method).toBe('PUT');
    const path = new URL(slot.body.uploadUrl).pathname;
    const put = await call('PUT', path, undefined, png, { 'Content-Type': 'image/png' });
    expect(put.status).toBe(204);
    const pub = new URL(slot.body.publicUrl).pathname;
    const res = await app.request(pub);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(png);
    expect(existsSync(join(uploadDir, s.orgId))).toBe(true);
    const p = await call('POST', `/v1/orgs/${s.orgId}/products`, 'maria', { name: 'Με φωτό', imageUrls: [slot.body.publicUrl] });
    expect(p.status).toBe(201);
    expect(p.body.images[0].url).toBe(slot.body.publicUrl);
    // the same slot twice is refused
    expect((await call('PUT', path, undefined, png, { 'Content-Type': 'image/png' })).status).toBe(409);
  });
  it('checks permission, size, type and the bytes themselves', async () => {
    expect((await call('POST', `/v1/orgs/${s.orgId}/uploads/presign`, 'dimitris', { purpose: 'product', mime: 'image/png', bytes: 10 })).status).toBe(403);
    expect((await call('POST', `/v1/orgs/${s.orgId}/uploads/presign`, 'maria', { purpose: 'product', mime: 'image/gif', bytes: 10 })).status).toBe(400);
    expect((await call('POST', `/v1/orgs/${s.orgId}/uploads/presign`, 'maria', { purpose: 'product', mime: 'image/png', bytes: 6_000_000 })).status).toBe(400);
    const slot = await call('POST', `/v1/orgs/${s.orgId}/uploads/presign`, 'maria', { purpose: 'product', mime: 'image/png', bytes: 20 });
    const path = new URL(slot.body.uploadUrl).pathname;
    expect((await call('PUT', path, undefined, new TextEncoder().encode('<svg onload=x>'), { 'Content-Type': 'image/png' })).status).toBe(415);
    expect((await call('PUT', path, undefined, png, { 'Content-Type': 'image/jpeg' })).status).toBe(415);
    expect((await call('PUT', path, undefined, new Uint8Array(40).fill(0x89), { 'Content-Type': 'image/png' })).status).toBe(413);
    expect((await call('PUT', path.replace(/.$/, 'x'), undefined, png, { 'Content-Type': 'image/png' })).status).toBe(403);
    expect((await app.request('/files/uploads/../../etc/passwd')).status).toBe(404);
    // someone else's upload url cannot be attached
    expect((await call('POST', `/v1/orgs/${s.orgId}/products`, 'maria', { name: 'x', imageUrls: [`http://localhost:8787/files/uploads/${s.orgId}/00000000-0000-7000-8000-000000000000.png`] })).status).toBe(400);
  });
});
