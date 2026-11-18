// regression tests for the pre launch security review

import { beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { migrate, openDb, seed, hashPassword, verifyPasswordAsync, hashPasswordAsync, type Db, type SeedResult } from '@custock/db';
import { JoinInput } from '@custock/core';
import { createApp, type App } from '../src/app';
import type { AppEnv, Config } from '../src/types';
import { secretProblems } from '../src/lib/secrets';
import { rateLimit } from '../src/lib/ratelimit';
import { purgeUnconfirmedFiles, PRESIGN_PER_HOUR } from '../src/lib/files';
import { storageBytes } from '../src/lib/platform-access';
import { expireTokenMessages } from '../src/lib/outbox-expiry';
import { drainOutbox, type LiveSender } from '../src/lib/live';
import { devOutboxTransport } from '../src/lib/transport';
import { SESSION_FAMILY_MAX_MS } from '../src/lib/auth';
import type { PhotoStore } from '../src/lib/storage';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const SECRET = 'prelaunch-test-secret-that-is-long-enough';
const pw = hashPassword('custock');
let clock = Date.UTC(2026, 10, 18, 10, 0, 0);

interface World { db: Db; s: SeedResult; app: App; tokens: Record<string, string>; refresh: Record<string, string> }

function world(extra: Partial<Config> = {}): World {
  const db = openDb(':memory:');
  migrate(db);
  const s = seed(db, { passwordHash: pw, now: clock });
  const app = createApp({ db, dev: true, jwtSecret: SECRET, publicWebUrl: 'https://custock.example.com', corsOrigins: [], now: () => clock, rateLimit: false, ...extra });
  return { db, s, app, tokens: {}, refresh: {} };
}

async function call(w: World, method: string, path: string, who?: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await w.app.request(path, {
    method,
    headers: { ...(who ? { Authorization: `Bearer ${w.tokens[who]}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed: Json = text;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* not json */ }
  return { status: res.status, body: parsed };
}

async function login(w: World, who: string, as = who, headers: Record<string, string> = {}) {
  const r = await call(w, 'POST', '/v1/auth/login', undefined, { email: `${who}@example.com`, password: 'custock' }, headers);
  expect(r.status).toBe(200);
  w.tokens[as] = r.body.accessToken;
  w.refresh[as] = r.body.refreshToken;
}

const outbox = (w: World, type: string) => w.db.prepare("SELECT * FROM dev_outbox WHERE json_extract(payload, '$.type') = ? ORDER BY rowid DESC").all(type) as Json[];

describe('C2 signing secrets', () => {
  it('a placeholder or short secret is refused outside dev, dev is left alone', () => {
    expect(secretProblems({ CUSTOCK_JWT_SECRET: 'change-me-to-64-random-characters-please-now' }, false)[0]).toContain('placeholder');
    expect(secretProblems({ CUSTOCK_JWT_SECRET: 'short' }, false)[0]).toContain('32');
    expect(secretProblems({}, false)[0]).toContain('must be set');
    expect(secretProblems({ CUSTOCK_JWT_SECRET: 'a'.repeat(64), CUSTOCK_UNSUB_SECRET: 'change-me-to-another-64-random-characters' }, false)).toHaveLength(1);
    expect(secretProblems({ CUSTOCK_JWT_SECRET: 'f'.repeat(64) }, false)).toEqual([]);
    expect(secretProblems({}, true)).toEqual([]);
  });
});

describe('H1 upload slots', () => {
  const removed: string[] = [];
  const store: PhotoStore = {
    kind: 's3',
    presign: (i) => ({ storageKey: `orgs/${i.orgId}/products/${i.fileId}.${i.ext}`, uploadUrl: `https://bucket.example.com/${i.fileId}`, headers: { 'Content-Type': i.mime }, publicUrl: `https://img.example.com/orgs/${i.orgId}/products/${i.fileId}.${i.ext}` }),
    remove: async (k) => { removed.push(k); },
  };
  let w: World;
  beforeEach(async () => {
    w = world({ photoStore: store, storage: { kind: 's3', s3: { bucket: 'b', region: 'auto', endpoint: 'https://x.r2.cloudflarestorage.com', accessKeyId: 'k', secretAccessKey: 's', publicUrl: 'https://img.example.com' } } });
    await login(w, 'maria');
  });

  it('a person gets a limited number of slots an hour', async () => {
    const statuses: number[] = [];
    for (let i = 0; i <= PRESIGN_PER_HOUR; i++) statuses.push((await call(w, 'POST', `/v1/orgs/${w.s.orgId}/uploads/presign`, 'maria', { purpose: 'product', mime: 'image/webp', bytes: 1000 })).status);
    expect(statuses.slice(0, PRESIGN_PER_HOUR).every((x) => x === 201)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });

  it('a slot counts toward storage only once a photo uses it, unused ones are purged after an hour', async () => {
    const before = storageBytes(w.db);
    const a = (await call(w, 'POST', `/v1/orgs/${w.s.orgId}/uploads/presign`, 'maria', { purpose: 'product', mime: 'image/webp', bytes: 4_000_000 })).body;
    const b = (await call(w, 'POST', `/v1/orgs/${w.s.orgId}/uploads/presign`, 'maria', { purpose: 'product', mime: 'image/webp', bytes: 3_000_000 })).body;
    expect(storageBytes(w.db)).toBe(before);
    // a goes on a product, b is never used
    const productId = w.s.products[Object.keys(w.s.products)[0]!]!;
    await login(w, 'eleni');
    const put = await call(w, 'PATCH', `/v1/orgs/${w.s.orgId}/products/${productId}`, 'eleni', { imageUrls: [a.publicUrl] });
    expect(put.status).toBe(200);
    expect(storageBytes(w.db)).toBe(before + 4_000_000);
    clock += 61 * 60_000;
    removed.length = 0;
    expect(purgeUnconfirmedFiles(w.db, clock, (k) => store.remove(k))).toBe(1);
    expect(removed).toEqual([`orgs/${w.s.orgId}/products/${b.fileId}.webp`]);
    const rows = w.db.prepare('SELECT id, deleted_at FROM files WHERE id IN (?, ?)').all(a.fileId, b.fileId) as Json[];
    expect(rows.find((r: Json) => r.id === a.fileId).deleted_at).toBeNull();
    expect(rows.find((r: Json) => r.id === b.fileId).deleted_at).not.toBeNull();
  });

  it('a photo in use that missed its confirmation is confirmed, never purged', () => {
    const fileId = 'f0000000-0000-7000-8000-000000000001';
    w.db.prepare("INSERT INTO files (id, org_id, storage_key, purpose, is_public, mime, bytes, created_at) VALUES (?, ?, ?, 'logo', 1, 'image/png', 10, ?)").run(fileId, w.s.orgId, `orgs/${w.s.orgId}/logo/${fileId}.png`, clock - 7200_000);
    w.db.prepare('UPDATE organizations SET logo_file_id = ? WHERE id = ?').run(fileId, w.s.orgId);
    expect(purgeUnconfirmedFiles(w.db, clock)).toBe(0);
    expect((w.db.prepare('SELECT confirmed_at FROM files WHERE id = ?').get(fileId) as Json).confirmed_at).not.toBeNull();
  });
});

describe('H2 login email and account deletion', () => {
  let w: World;
  beforeEach(async () => {
    w = world();
    await login(w, 'maria', 'maria');
    await login(w, 'maria', 'mariaPhone');
  });

  it('changing the login email needs the current password', async () => {
    expect((await call(w, 'POST', '/v1/me/email', 'maria', { email: 'maria.new@example.com' })).body.fields).toEqual({ password: 'required' });
    expect((await call(w, 'POST', '/v1/me/email', 'maria', { email: 'maria.new@example.com', password: 'nope' })).body.fields).toEqual({ password: 'wrong' });
    expect((await call(w, 'POST', '/v1/me/email', 'maria', { email: 'maria.new@example.com', password: 'custock' })).status).toBe(200);
  });

  it('after the change only this device stays signed in, the old address can undo it', async () => {
    const req = await call(w, 'POST', '/v1/me/email', 'maria', { email: 'maria.new@example.com', password: 'custock' });
    expect((await call(w, 'POST', '/v1/me/email/verify', 'maria', { email: 'maria.new@example.com', code: req.body.devCode })).status).toBe(204);
    expect((await call(w, 'GET', '/v1/me/context', 'maria')).status).toBe(200);
    expect((await call(w, 'GET', '/v1/me/context', 'mariaPhone')).status).toBe(401);
    expect((await call(w, 'POST', '/v1/auth/refresh', undefined, { refreshToken: w.refresh.mariaPhone })).status).toBe(401);
    const notice = outbox(w, 'email_changed')[0];
    expect(notice.to_address).toBe('maria@example.com');
    const token = /email-revert\/([A-Za-z0-9_-]+)/.exec(notice.body)![1]!;
    const back = await call(w, 'POST', '/v1/public/email-revert', undefined, { token });
    expect(back.status).toBe(200);
    expect((w.db.prepare("SELECT email FROM users WHERE id = ?").get(w.s.users.maria) as Json).email).toBe('maria@example.com');
    // everyone is signed out, the link works once
    expect((await call(w, 'GET', '/v1/me/context', 'maria')).status).toBe(401);
    expect((await call(w, 'POST', '/v1/public/email-revert', undefined, { token })).status).toBe(410);
  });

  it('the revert link stops after 7 days', async () => {
    const req = await call(w, 'POST', '/v1/me/email', 'maria', { email: 'maria.new@example.com', password: 'custock' });
    await call(w, 'POST', '/v1/me/email/verify', 'maria', { email: 'maria.new@example.com', code: req.body.devCode });
    const token = /email-revert\/([A-Za-z0-9_-]+)/.exec(outbox(w, 'email_changed')[0].body)![1]!;
    clock += 8 * 86_400_000;
    expect((await call(w, 'POST', '/v1/public/email-revert', undefined, { token })).status).toBe(410);
    clock -= 8 * 86_400_000;
  });

  it('deleting an account with a password needs the password', async () => {
    await login(w, 'sofia');
    expect((await call(w, 'POST', '/v1/me/delete/start', 'sofia')).body).toEqual({ method: 'password' });
    expect((await call(w, 'DELETE', '/v1/me', 'sofia')).body.fields).toEqual({ password: 'required' });
    expect((await call(w, 'DELETE', '/v1/me', 'sofia', { password: 'wrong' })).body.fields).toEqual({ password: 'wrong' });
    expect((await call(w, 'DELETE', '/v1/me', 'sofia', { password: 'custock' })).status).toBe(204);
  });

  it('deleting an account without a password needs a fresh code from the email', async () => {
    const email = 'walkin.delete@example.com';
    const code = (await call(w, 'POST', '/v1/auth/otp/request', undefined, { email })).body.devCode;
    w.tokens.walkin = (await call(w, 'POST', '/v1/auth/otp/verify', undefined, { email, code })).body.accessToken;
    expect((await call(w, 'DELETE', '/v1/me', 'walkin')).body.fields).toEqual({ code: 'required' });
    const start = await call(w, 'POST', '/v1/me/delete/start', 'walkin');
    expect(start.body.method).toBe('code');
    expect(outbox(w, 'delete_code')[0].to_address).toBe(email);
    expect((await call(w, 'DELETE', '/v1/me', 'walkin', { code: start.body.devCode === '000000' ? '111111' : '000000' })).body.fields).toEqual({ code: 'wrong' });
    expect((await call(w, 'DELETE', '/v1/me', 'walkin', { code: start.body.devCode })).status).toBe(204);
  });
});

describe('H3 join page abuse', () => {
  it('names are letters only, 40 at most, and never in the confirmation email', async () => {
    expect(JoinInput.safeParse({ name: 'Μαρία Π.', email: 'a@b.co', locale: 'el', emailNews: true, push: false, over15: true }).success).toBe(true);
    expect(JoinInput.safeParse({ name: 'http://evil.example', email: 'a@b.co', locale: 'el', emailNews: true, push: false, over15: true }).success).toBe(false);
    expect(JoinInput.safeParse({ name: 'Ann 2', email: 'a@b.co', locale: 'el', emailNews: true, push: false, over15: true }).success).toBe(false);
    expect(JoinInput.safeParse({ name: 'A'.repeat(41), email: 'a@b.co', locale: 'el', emailNews: true, push: false, over15: true }).success).toBe(false);
    const w = world();
    const r = await call(w, 'POST', '/v1/public/join/kif7q2', undefined, { name: 'Zoe Visit', email: 'zoe.join@example.com', locale: 'en', emailNews: true, push: false, over15: true });
    expect(r.status).toBe(200);
    const mail = outbox(w, 'join_confirm')[0];
    expect(mail.body).not.toContain('Zoe');
    expect(mail.html).not.toContain('Zoe');
  });

  it('one ip gets a few signups an hour', async () => {
    const w = world({ rateLimit: true, trustedProxy: true });
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      statuses.push((await call(w, 'POST', '/v1/public/join/kif7q2', undefined, { name: 'Test Person', email: `ip${i}@example.com`, locale: 'en', emailNews: true, push: false, over15: true }, { 'X-Forwarded-For': '203.0.113.7' })).status);
    }
    expect(statuses.slice(0, 10).every((x) => x === 200)).toBe(true);
    expect(statuses[10]).toBe(429);
    expect((await call(w, 'POST', '/v1/public/join/kif7q2', undefined, { name: 'Other Person', email: 'other@example.com', locale: 'en', emailNews: true, push: false, over15: true }, { 'X-Forwarded-For': '203.0.113.8' })).status).toBe(200);
  });

  it('the hourly email budget holds normal mail, sign in codes still go, the super admins hear once', async () => {
    const w = world();
    w.db.prepare("UPDATE users SET platform_role = 'superadmin' WHERE id = ?").run(w.s.users.eleni);
    const prev = process.env.CUSTOCK_EMAIL_BUDGET_PER_HOUR;
    process.env.CUSTOCK_EMAIL_BUDGET_PER_HOUR = '2';
    try {
      w.db.prepare('DELETE FROM dev_outbox').run();
      const t = devOutboxTransport(w.db, () => {});
      for (let i = 0; i < 4; i++) t.send({ channel: 'email', to: `n${i}@example.com`, title: 'News', body: 'x', payload: { type: 'join_confirm' } });
      t.send({ channel: 'email', to: 'code@example.com', title: 'Code', body: 'x', payload: { type: 'otp' } });
      const sent: string[] = [];
      const sender: LiveSender = { email: async (row) => { sent.push(String(row.to_address)); } };
      await drainOutbox(w.db, sender, clock);
      expect(sent).toEqual(['n0@example.com', 'n1@example.com', 'code@example.com']);
      await drainOutbox(w.db, sender, clock + 1000);
      const alerts = w.db.prepare("SELECT * FROM dev_outbox WHERE channel = 'push' AND json_extract(payload, '$.alert') = 'budget'").all();
      expect(alerts).toHaveLength(1);
    } finally {
      if (prev === undefined) delete process.env.CUSTOCK_EMAIL_BUDGET_PER_HOUR;
      else process.env.CUSTOCK_EMAIL_BUDGET_PER_HOUR = prev;
    }
  });
});

describe('M3 rate limits per route, shelf lookup', () => {
  it('different codes on one route share one limit', async () => {
    const app = new Hono<AppEnv>();
    app.use('*', async (c, next) => { c.set('cfg', { trustedProxy: false } as Config); await next(); });
    app.onError((e, c) => c.json({ e: String(e) }, (e as { status?: number }).status === 429 ? 429 : 500));
    app.get('/x/:code', rateLimit({ windowMs: 60_000, max: 2, prefix: 't' }), (c) => c.text('ok'));
    const s = [await app.request('/x/a'), await app.request('/x/b'), await app.request('/x/c')].map((r) => r.status);
    expect(s).toEqual([200, 200, 429]);
  });

  it('the shelf page follows the catalog setting', async () => {
    const w = world();
    const code = (w.db.prepare('SELECT code FROM barcodes WHERE org_id = ? LIMIT 1').get(w.s.orgId) as Json).code;
    w.db.prepare("UPDATE organizations SET customer_catalog = 'off' WHERE id = ?").run(w.s.orgId);
    expect((await call(w, 'GET', `/v1/public/p/${code}`)).status).toBe(404);
    w.db.prepare("UPDATE organizations SET customer_catalog = 'subscribers', customer_prices = 1, customer_stock = 'exact' WHERE id = ?").run(w.s.orgId);
    const teaser = await call(w, 'GET', `/v1/public/p/${code}`);
    expect(teaser.status).toBe(200);
    expect(teaser.body.priceMinor).toBeNull();
    expect(teaser.body.availability).toEqual([]);
    w.db.prepare("UPDATE organizations SET customer_catalog = 'public' WHERE id = ?").run(w.s.orgId);
    expect((await call(w, 'GET', `/v1/public/p/${code}`)).body.priceMinor).not.toBeNull();
  });

  it('a broken escape in a public path is not found, not a server error', async () => {
    const w = world();
    expect((await call(w, 'GET', '/v1/public/join/%E0%A4%A')).status).toBe(404);
  });
});

describe('M4 lockouts by email and ip', () => {
  it('wrong passwords lock that address from that ip only', async () => {
    const w = world({ trustedProxy: true });
    const from = (ip: string) => ({ 'X-Forwarded-For': ip });
    for (let i = 0; i < 5; i++) expect((await call(w, 'POST', '/v1/auth/login', undefined, { email: 'sofia@example.com', password: 'wrong' }, from('198.51.100.1'))).status).toBe(401);
    expect((await call(w, 'POST', '/v1/auth/login', undefined, { email: 'sofia@example.com', password: 'custock' }, from('198.51.100.1'))).status).toBe(429);
    // the real person somewhere else still gets in
    expect((await call(w, 'POST', '/v1/auth/login', undefined, { email: 'sofia@example.com', password: 'custock' }, from('198.51.100.2'))).status).toBe(200);
  });

  it('a password reset clears every lock of the address', async () => {
    const w = world({ trustedProxy: true });
    for (let i = 0; i < 6; i++) await call(w, 'POST', '/v1/auth/login', undefined, { email: 'sofia@example.com', password: 'wrong' }, { 'X-Forwarded-For': '198.51.100.9' });
    await call(w, 'POST', '/v1/auth/password/forgot', undefined, { email: 'sofia@example.com' });
    const link = /\/admin\/reset\/([A-Za-z0-9_-]+)/.exec(outbox(w, 'password_reset')[0].body)![1]!;
    expect((await call(w, 'POST', '/v1/auth/password/reset', undefined, { token: link, password: 'a-new-long-password-1' })).status).toBe(200);
    expect((await call(w, 'POST', '/v1/auth/login', undefined, { email: 'sofia@example.com', password: 'a-new-long-password-1' }, { 'X-Forwarded-For': '198.51.100.9' })).status).toBe(200);
  });
});

describe('lows', () => {
  const post = (w: World, extra: Json = {}) => ({
    kind: 'news', defaultLocale: 'el', translations: { el: { title: 'Τίτλος', body: 'κείμενο' } },
    channels: ['feed'], audience: { scopes: [{ scopeType: 'shop', scopeId: w.s.shops.kifisia }] }, ...extra,
  });

  it('a post cover is one of the business own uploads or an https picture', async () => {
    const w = world();
    await login(w, 'eleni');
    const org = `/v1/orgs/${w.s.orgId}`;
    expect((await call(w, 'POST', `${org}/posts`, 'eleni', post(w, { coverUrl: 'orgs/someone-else/products/x.webp' }))).status).toBe(400);
    expect((await call(w, 'POST', `${org}/posts`, 'eleni', post(w, { coverUrl: 'http://example.com/a.jpg' }))).status).toBe(400);
    expect((await call(w, 'POST', `${org}/posts`, 'eleni', post(w, { coverUrl: 'https://example.com/a.jpg' }))).status).toBe(201);
  });

  it('a sent post needs publish rights to change, an approved one waits again after an edit', async () => {
    const w = world();
    await login(w, 'eleni');
    await login(w, 'maria');
    const org = `/v1/orgs/${w.s.orgId}`;
    const created = (await call(w, 'POST', `${org}/posts`, 'maria', post(w, { scheduledAt: clock + 86_400_000 }))).body;
    expect((await call(w, 'POST', `${org}/posts/${created.id}/publish`, 'maria')).body.status).toBe('pending_approval');
    expect((await call(w, 'POST', `${org}/posts/${created.id}/approve`, 'eleni')).body.status).toBe('scheduled');
    const edited = await call(w, 'PATCH', `${org}/posts/${created.id}`, 'maria', post(w, { scheduledAt: clock + 86_400_000, translations: { el: { title: 'Άλλο', body: 'άλλο' } } }));
    expect(edited.status).toBe(200);
    expect(edited.body.status).toBe('pending_approval');
    // once sent, the author without publish rights cannot change it
    w.db.prepare("UPDATE posts SET status = 'sent' WHERE id = ?").run(created.id);
    expect((await call(w, 'PATCH', `${org}/posts/${created.id}`, 'maria', post(w))).status).toBe(403);
  });

  it('token links do not outlive their tokens in the outbox, in every mode', () => {
    const w = world();
    const t = devOutboxTransport(w.db, () => {});
    t.send({ channel: 'email', to: 'x@example.com', title: 'code', body: 'code 123456', payload: { type: 'otp' } });
    t.send({ channel: 'email', to: 'y@example.com', title: 'news', body: 'news', payload: { type: 'post' } });
    w.db.prepare('UPDATE dev_outbox SET created_at = ?').run(clock - 2 * 3600_000);
    expect(expireTokenMessages(w.db, clock)).toBe(1);
    const rows = w.db.prepare('SELECT body, payload FROM dev_outbox ORDER BY rowid DESC LIMIT 2').all() as Json[];
    expect(rows.find((r: Json) => r.payload.includes('otp')).body).toBeNull();
    expect(rows.find((r: Json) => r.payload.includes('post')).body).toBe('news');
  });

  it('a refresh session family ends 90 days after the first sign in', async () => {
    const w = world();
    await login(w, 'sofia');
    let refreshToken = w.refresh.sofia!;
    const start = clock;
    for (let day = 25; day <= 75; day += 25) {
      clock = start + day * 86_400_000;
      const r = await call(w, 'POST', '/v1/auth/refresh', undefined, { refreshToken });
      expect(r.status).toBe(200);
      refreshToken = r.body.refreshToken;
    }
    clock = start + SESSION_FAMILY_MAX_MS + 86_400_000;
    expect((await call(w, 'POST', '/v1/auth/refresh', undefined, { refreshToken })).status).toBe(401);
    clock = start;
  });

  it('password hashing has async versions that agree with the sync ones', async () => {
    expect(await verifyPasswordAsync('custock', pw)).toBe(true);
    expect(await verifyPasswordAsync('nope', pw)).toBe(false);
    expect(await verifyPasswordAsync('again', await hashPasswordAsync('again'))).toBe(true);
  });

  it('logs mask the recipient and leave out the subject', () => {
    const w = world();
    const lines: string[] = [];
    devOutboxTransport(w.db, (l) => lines.push(l)).send({ channel: 'email', to: 'someone@example.com', title: 'Your code: 123456', body: 'x', payload: { type: 'otp' } });
    expect(lines[0]).toBe('[outbox] email to so***@example.com: otp');
  });
});
