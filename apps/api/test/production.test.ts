// production setup and web push: the cli on an empty database, invites without email, the bot
// check switch, the forwarded client address, push subscriptions and their delivery. nothing is
// ever sent: delivery runs through fake senders, web push requests are only built.

import { beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createECDH, randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isPushServiceEndpoint } from '@custock/core';
import { hashPassword, migrate, openDb, seed, type Db, type SeedResult } from '@custock/db';
import { createApp, type App } from '../src/app';
import { runCli, type CliIo } from '../src/cli';
import { drainOutbox, liveChannels, smtpProblems, webPushRequest, type LiveSender, type OutboxRow } from '../src/lib/live';
import { devOutboxTransport } from '../src/lib/transport';
import { buildWebPush, newVapidKeys, vapidProblems } from '../src/lib/webpush';
import { runJobs } from '../src/worker';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const SECRET = 'production-test-secret-long-enough-123';
const clock = Date.now();

function caller(app: () => App) {
  return async (method: string, path: string, token?: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await app().request(path, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: Json = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // not json
    }
    return { status: res.status, body: parsed };
  };
}

function fakeSubscription(n: string, host = 'fcm.googleapis.com') {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return { endpoint: `https://${host}/fcm/send/${n}`, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') } };
}

function io(env: Record<string, string | undefined> = {}, stdin = ''): CliIo & { lines: string[] } {
  const lines: string[] = [];
  return { env, readStdin: async () => stdin, out: (l) => lines.push(l), lines };
}

// ---------------------------------------------------------------- web push on the demo data

describe('web push', () => {
  let db: Db;
  let s: SeedResult;
  let app: App;
  const call = caller(() => app);
  const tokens: Record<string, string> = {};
  let customerId = '';
  const vapid = { ...newVapidKeys(), subject: 'mailto:ops@example.com' };
  const sub = fakeSubscription('person-1');

  beforeAll(async () => {
    db = openDb(':memory:');
    migrate(db);
    s = seed(db, { passwordHash: hashPassword('custock'), now: clock });
    app = createApp({ db, dev: true, jwtSecret: SECRET, publicWebUrl: 'http://localhost:3000/custock', corsOrigins: [], now: () => clock, rateLimit: false, vapidPublicKey: vapid.publicKey });
    for (const who of ['eleni', 'maria', 'sofia', 'anna']) {
      tokens[who] = (await call('POST', '/v1/auth/login', undefined, { email: `${who}@example.com`, password: 'custock' })).body.accessToken;
    }
    const code = (await call('POST', '/v1/auth/otp/request', undefined, { email: 'web.person@example.com', locale: 'en' })).body.devCode;
    tokens.web = (await call('POST', '/v1/auth/otp/verify', undefined, { email: 'web.person@example.com', code })).body.accessToken;
    expect((await call('POST', '/v1/c/join/kif7q2', tokens.web, { push: true })).status).toBe(200);
    customerId = (db.prepare('SELECT id FROM customers WHERE org_id = ? AND email = ?').get(s.orgId, 'web.person@example.com') as Json).id;
  });

  const pushOk = () => (db.prepare('SELECT push_ok FROM customers WHERE id = ?').get(customerId) as Json).push_ok;

  it('only push service hosts are accepted as endpoints', () => {
    expect(isPushServiceEndpoint('https://fcm.googleapis.com/fcm/send/abc')).toBe(true);
    expect(isPushServiceEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x')).toBe(true);
    expect(isPushServiceEndpoint('https://web.push.apple.com/QGx')).toBe(true);
    expect(isPushServiceEndpoint('https://db5p.notify.windows.com/w/?token=x')).toBe(true);
    expect(isPushServiceEndpoint('http://fcm.googleapis.com/fcm/send/abc')).toBe(false);
    expect(isPushServiceEndpoint('https://fcm.googleapis.com.evil.example/x')).toBe(false);
    expect(isPushServiceEndpoint('https://evil.example/notify.windows.com')).toBe(false);
    expect(isPushServiceEndpoint('https://user:pw@fcm.googleapis.com/x')).toBe(false);
    expect(isPushServiceEndpoint('https://fcm.googleapis.com:8443/x')).toBe(false);
    expect(isPushServiceEndpoint('https://127.0.0.1/x')).toBe(false);
  });

  it('serves the public key, or 404 without one', async () => {
    expect((await call('GET', '/v1/push/key')).body).toEqual({ publicKey: vapid.publicKey });
    const bare = createApp({ db, dev: false, jwtSecret: SECRET, publicWebUrl: 'http://localhost:3000/custock', corsOrigins: [], rateLimit: false });
    expect((await bare.request('/v1/push/key')).status).toBe(404);
  });

  it('a subscription makes a customer who allowed push reachable, for that business only', async () => {
    const preview = async () => (await call('POST', `/v1/orgs/${s.orgId}/posts/audience-preview`, tokens.eleni, { audience: { scopes: [{ scopeType: 'shop', scopeId: s.shops.kifisia }] }, channels: ['push'] })).body.push.count;
    const before = await preview();
    expect(pushOk()).toBe(0);
    expect((await call('POST', '/v1/me/push-subscriptions', undefined, { ...sub, orgId: s.orgId })).status).toBe(401);
    expect((await call('POST', '/v1/me/push-subscriptions', tokens.web, { ...fakeSubscription('x', 'evil.example'), orgId: s.orgId })).status).toBe(400);
    expect((await call('POST', '/v1/me/push-subscriptions', tokens.web, { ...sub, orgId: 'not-my-business' })).status).toBe(404);
    expect((await call('POST', '/v1/me/push-subscriptions', tokens.web, { ...sub, orgId: s.orgId, locale: 'en' })).status).toBe(204);
    expect(pushOk()).toBe(1);
    // the audience preview now counts the person as reachable by push
    expect(await preview()).toBe(before + 1);
  });

  it('turning on notifications in the business app is the yes, unless the customer said no before', async () => {
    const join = async (email: string) => {
      const code = (await call('POST', '/v1/auth/otp/request', undefined, { email, locale: 'en' })).body.devCode;
      const token = (await call('POST', '/v1/auth/otp/verify', undefined, { email, code })).body.accessToken;
      // joined with email only, nothing said about push
      expect((await call('POST', '/v1/c/join/kif7q2', token, { push: false })).status).toBe(200);
      const id = (db.prepare('SELECT id FROM customers WHERE org_id = ? AND email = ?').get(s.orgId, email) as Json).id;
      return { token, ok: () => (db.prepare('SELECT push_ok FROM customers WHERE id = ?').get(id) as Json).push_ok };
    };
    const quiet = await join('push.later@example.com');
    expect(quiet.ok()).toBe(0);
    expect((await call('POST', '/v1/me/push-subscriptions', quiet.token, { ...fakeSubscription('later-1'), orgId: s.orgId })).status).toBe(204);
    expect(quiet.ok()).toBe(1);
    // a no stays a no when the app refreshes its subscription
    const said = await join('push.no@example.com');
    expect((await call('PUT', '/v1/c/channels', said.token, { orgId: s.orgId, channel: 'push', on: false })).status).toBe(204);
    expect((await call('POST', '/v1/me/push-subscriptions', said.token, { ...fakeSubscription('no-1'), orgId: s.orgId })).status).toBe(204);
    expect(said.ok()).toBe(0);
    // and the switch in the app says yes again
    expect((await call('PUT', '/v1/c/channels', said.token, { orgId: s.orgId, channel: 'push', on: true })).status).toBe(204);
    expect(said.ok()).toBe(1);
  });

  it('the same browser signed in as someone else moves the subscription', async () => {
    expect((await call('POST', '/v1/me/push-subscriptions', tokens.anna, { ...sub, orgId: null })).status).toBe(204);
    expect((db.prepare('SELECT user_id FROM push_subscriptions WHERE endpoint = ?').get(sub.endpoint) as Json).user_id).toBe(s.users.anna);
    expect(pushOk()).toBe(0);
    expect((await call('POST', '/v1/me/push-subscriptions', tokens.web, { ...sub, orgId: s.orgId })).status).toBe(204);
    expect(pushOk()).toBe(1);
  });

  it('keeps at most 20 per person, the oldest go', async () => {
    for (let i = 0; i < 22; i++) {
      await call('POST', '/v1/me/push-subscriptions', tokens.sofia, fakeSubscription(`sofia-${i}`, 'updates.push.services.mozilla.com'));
    }
    expect((db.prepare('SELECT count(*) n FROM push_subscriptions WHERE user_id = ?').get(s.users.sofia) as Json).n).toBe(20);
    expect(db.prepare('SELECT 1 FROM push_subscriptions WHERE endpoint LIKE ?').get('%/sofia-0')).toBeUndefined();
  });

  it('a test push goes only to the caller own devices, once a minute', async () => {
    const outbox = (userId: string) => db.prepare("SELECT payload, title FROM dev_outbox WHERE user_id = ? AND json_extract(payload, '$.type') = 'test'").all(userId) as Json[];
    // nothing to send to: no row, and the answer says so
    expect((await call('POST', '/v1/me/push/test', tokens.maria, {})).body).toEqual({ devices: 0 });
    expect(outbox(s.users.maria!)).toHaveLength(0);
    // a customer in a business's app: only that business, and the tap opens its page
    expect((await call('POST', '/v1/me/push/test', tokens.web, { orgId: 'not-my-business' })).status).toBe(404);
    const r = await call('POST', '/v1/me/push/test', tokens.web, { orgId: s.orgId });
    expect(r.body).toEqual({ devices: 1 });
    const webUser = (db.prepare('SELECT user_id FROM customers WHERE id = ?').get(customerId) as Json).user_id;
    const rows = outbox(webUser);
    expect(rows).toHaveLength(1);
    const slug = (db.prepare('SELECT slug FROM organizations WHERE id = ?').get(s.orgId) as Json).slug;
    expect(JSON.parse(rows[0].payload).url).toBe(`http://localhost:3000/custock/s/${slug}`);
    expect((await call('POST', '/v1/me/push/test', tokens.web, { orgId: s.orgId })).status).toBe(429);
    // staff app: every subscription without a business, the tap opens /admin
    const staff = await call('POST', '/v1/me/push/test', tokens.sofia);
    expect(staff.body).toEqual({ devices: 20 });
    expect(JSON.parse(outbox(s.users.sofia!)[0].payload).url).toBe('http://localhost:3000/custock/admin');
    expect((await call('POST', '/v1/me/push/test')).status).toBe(401);
  });

  it('a visible push carries the page to open, a silent one does not', () => {
    const tr = devOutboxTransport(db, () => {});
    const { id } = tr.send({ channel: 'push', orgId: s.orgId, userId: s.users.eleni, title: 'Count', body: 'ready', payload: { type: 'countReady', countId: 'c1' } });
    const row = db.prepare('SELECT payload FROM dev_outbox WHERE id = ?').get(id) as Json;
    expect(JSON.parse(row.payload).url).toBe(`http://localhost:3000/custock/admin/lemoni/stock/counts/c1`);
    const silent = tr.send({ channel: 'push', orgId: s.orgId, userId: s.users.eleni, title: '', body: '', payload: { type: 'perms_changed', silent: true } });
    expect(JSON.parse((db.prepare('SELECT payload FROM dev_outbox WHERE id = ?').get(silent.id) as Json).payload).url).toBeUndefined();
    const silentRow = db.prepare('SELECT * FROM dev_outbox WHERE id = ?').get(silent.id) as OutboxRow;
    expect(buildWebPush(silentRow)).toBeNull();
  });

  it('a post reaches the customer as a web push that opens the business page', async () => {
    db.prepare('UPDATE organizations SET posts_need_approval = 0 WHERE id = ?').run(s.orgId);
    const post = await call('POST', `/v1/orgs/${s.orgId}/posts`, tokens.eleni, {
      kind: 'news', defaultLocale: 'el', translations: { el: { title: 'Νέα', body: 'κείμενο' }, en: { title: 'News', body: 'text' } },
      channels: ['feed', 'push'], audience: { scopes: [{ scopeType: 'shop', scopeId: s.shops.kifisia }] },
    });
    expect((await call('POST', `/v1/orgs/${s.orgId}/posts/${post.body.id}/publish`, tokens.eleni)).status).toBe(200);
    let t = clock;
    const { localMinutes } = await import('../src/lib/time');
    while (localMinutes(t, 'Europe/Athens') !== 12 * 60) t += 60_000;
    await runJobs({ cfg: { db, jwtSecret: SECRET, publicWebUrl: 'http://localhost:3000/custock' } }, t);
    const row = db.prepare("SELECT * FROM dev_outbox WHERE customer_id = ? AND channel = 'push' AND json_extract(payload, '$.postId') = ?").get(customerId, post.body.id) as OutboxRow;
    expect(row).toBeTruthy();
    const msg = buildWebPush(row)!;
    const body = JSON.parse(msg.payload);
    expect(body).toMatchObject({ title: 'Lemoni Kifisia', body: 'Νέα', url: `http://localhost:3000/custock/s/lemoni/news?post=${post.body.id}`, type: 'post', orgId: s.orgId });
    expect(msg.options).toMatchObject({ TTL: 172800, urgency: 'normal' });
    expect(msg.options.topic).toMatch(/^[A-Za-z0-9_-]{32}$/);

    // the request web-push would make: encrypted body, VAPID auth, TTL, urgency and topic headers
    const req = webPushRequest(row, { id: 'x', endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth }, vapid)!;
    expect(req.endpoint).toBe(sub.endpoint);
    expect(req.method).toBe('POST');
    expect(req.headers).toMatchObject({ TTL: 172800, Urgency: 'normal', Topic: msg.options.topic, 'Content-Encoding': 'aes128gcm' });
    expect(String(req.headers.Authorization)).toMatch(/^vapid t=.+, k=/);
    expect((req.body as Buffer).length).toBeGreaterThan(body.title.length);
  });

  it('the drain sends push rows through web push only when that is the live channel, and drops dead subscriptions', async () => {
    const dead = fakeSubscription('dead-1');
    expect((await call('POST', '/v1/me/push-subscriptions', tokens.web, { ...dead, orgId: s.orgId })).status).toBe(204);
    const unsentEmail = () => (db.prepare("SELECT count(*) n FROM dev_outbox WHERE channel = 'email' AND sent_at IS NULL").get() as Json).n;
    const emailsBefore = unsentEmail();
    const reached: string[] = [];
    const fake: LiveSender = {
      async webpush(_row, target) {
        reached.push(target.endpoint);
        return target.endpoint === dead.endpoint ? { ok: false, unregistered: true, error: '410 gone' } : { ok: true };
      },
    };
    const r = await drainOutbox(db, fake, clock, 5000);
    expect(r.failed).toBe(0);
    expect(reached).toContain(sub.endpoint);
    expect(db.prepare('SELECT 1 FROM push_subscriptions WHERE endpoint = ?').get(dead.endpoint)).toBeUndefined();
    expect((db.prepare('SELECT last_ok_at FROM push_subscriptions WHERE endpoint = ?').get(sub.endpoint) as Json).last_ok_at).toBe(clock);
    // no email sender: emails wait in the outbox. no FCM sender: the phone tokens are untouched
    expect(unsentEmail()).toBe(emailsBefore);
    expect((db.prepare('SELECT fcm_token FROM devices WHERE user_id = ?').get(s.users.anna) as Json).fcm_token).toBe('dev-token-anna');
    expect((db.prepare("SELECT count(*) n FROM dev_outbox WHERE channel = 'push' AND sent_at IS NULL").get() as Json).n).toBe(0);
  });

  it('a push that reached nobody because of a passing error is retried', async () => {
    const { id } = devOutboxTransport(db, () => {}).send({ channel: 'push', orgId: s.orgId, customerId, userId: null, title: 'Back', body: 'in stock', payload: { type: 'back_in_stock', productId: 'p1' } });
    const r = await drainOutbox(db, { webpush: async () => ({ ok: false, unregistered: false, error: '503 busy' }) }, clock, 5000);
    expect(r.failed).toBe(1);
    expect(db.prepare('SELECT sent_at, attempts, last_error FROM dev_outbox WHERE id = ?').get(id)).toMatchObject({ sent_at: null, attempts: 1 });
    expect((db.prepare('SELECT failures FROM push_subscriptions WHERE endpoint = ?').get(sub.endpoint) as Json).failures).toBe(1);
  });

  it('removing a subscription, unsubscribing and deleting the account clean up', async () => {
    expect((await call('DELETE', '/v1/me/push-subscriptions', tokens.web, { endpoint: sub.endpoint })).status).toBe(204);
    expect(pushOk()).toBe(0);
    expect((await call('POST', '/v1/me/push-subscriptions', tokens.web, { ...sub, orgId: s.orgId })).status).toBe(204);
    const start = await call('POST', '/v1/me/delete/start', tokens.web);
    expect((await call('DELETE', '/v1/me', tokens.web, { code: start.body.devCode })).status).toBe(204);
    expect((db.prepare('SELECT count(*) n FROM push_subscriptions WHERE endpoint = ?').get(sub.endpoint) as Json).n).toBe(0);
  });

  it('lists every shop of the business for someone who sends transfers, and refuses others', async () => {
    const own = await call('GET', `/v1/orgs/${s.orgId}/shops`, tokens.maria);
    expect(own.body.map((x: Json) => x.id)).toEqual([s.shops.kifisia]);
    const all = await call('GET', `/v1/orgs/${s.orgId}/shops?all=1`, tokens.maria);
    expect(all.status).toBe(200);
    expect(all.body).toHaveLength(3);
    expect((await call('GET', `/v1/orgs/${s.orgId}/shops?all=1`, tokens.sofia)).status).toBe(403);
  });
});

// ---------------------------------------------------------------- live channels

describe('live channels', () => {
  const vapid = newVapidKeys();

  it('each channel is on only with its own settings', () => {
    const r = liveChannels({ CUSTOCK_ALLOW_SENDING: 'yes', CUSTOCK_VAPID_PUBLIC_KEY: vapid.publicKey, CUSTOCK_VAPID_PRIVATE_KEY: vapid.privateKey, CUSTOCK_VAPID_SUBJECT: 'mailto:ops@example.com' }, () => true);
    expect(r.problems).toEqual([]);
    expect(Object.keys(r.channels)).toEqual(['vapid']);
    expect(r.lines).toEqual([
      'web push: live (VAPID, subject mailto:ops@example.com)',
      'fcm: off, stays in the outbox (no CUSTOCK_FCM_SERVICE_ACCOUNT)',
      'email: off, stays in the outbox (no CUSTOCK_SMTP_URL)',
    ]);
  });

  it('a gmail address in the smtp url works when the @ is encoded', () => {
    const r = liveChannels({ CUSTOCK_ALLOW_SENDING: 'yes', CUSTOCK_SMTP_URL: 'smtps://custock.shop%40gmail.com:abcdefghijklmnop@smtp.gmail.com:465', CUSTOCK_MAIL_FROM: 'custock.shop@gmail.com' }, () => true);
    expect(r.problems).toEqual([]);
    expect(r.channels.smtp?.from).toBe('custock.shop@gmail.com');
    expect(r.lines).toContain('email: live via smtp.gmail.com:465 from custock.shop@gmail.com');
    expect(smtpProblems('smtps://user@gmail.com:pw@smtp.gmail.com:465', 'a@b')).toEqual([]);
    expect(smtpProblems('smtps://user%40gmail.com@smtp.gmail.com:465', 'a@b')).toEqual(['CUSTOCK_SMTP_URL has a user but no password']);
    expect(smtpProblems('https://smtp.gmail.com', 'a@b')).toHaveLength(1);
    expect(smtpProblems('smtps://a:b@smtp.gmail.com:465', undefined)).toEqual(['CUSTOCK_MAIL_FROM (the sender address) must be set']);
  });

  it('half set or broken settings refuse to start rather than half work', () => {
    expect(liveChannels({ CUSTOCK_ALLOW_SENDING: 'yes', CUSTOCK_SMTP_URL: 'smtps://a:b@smtp.example.com:465' }, () => true).problems).toEqual(['CUSTOCK_MAIL_FROM (the sender address) must be set']);
    expect(liveChannels({ CUSTOCK_ALLOW_SENDING: 'yes', CUSTOCK_VAPID_PUBLIC_KEY: vapid.publicKey }, () => true).problems).toHaveLength(2);
    expect(vapidProblems({ publicKey: 'abc', privateKey: vapid.privateKey, subject: 'mailto:a@b.c' })).toHaveLength(1);
    expect(vapidProblems({ ...vapid, subject: 'http://example.com' })).toHaveLength(1);
    expect(vapidProblems({ ...vapid, subject: 'https://custock.example.com/custock' })).toEqual([]);
  });

  it('the server refuses a half set mail channel at startup', () => {
    const dir = mkdtempSync(join(tmpdir(), 'custock-live-'));
    const env = { ...process.env, CUSTOCK_DEV: '1', CUSTOCK_TRANSPORT: 'live', CUSTOCK_ALLOW_SENDING: 'yes', CUSTOCK_SMTP_URL: 'smtps://a:b@smtp.example.com:465', CUSTOCK_MAIL_FROM: '', CUSTOCK_DB: join(dir, 'x.db'), CUSTOCK_WORKER: '0' };
    const r = spawnSync(process.execPath, ['--import', 'tsx', 'src/main.ts'], { env, encoding: 'utf8', timeout: 30_000 });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('CUSTOCK_MAIL_FROM');
  });
});

// ---------------------------------------------------------------- an empty production database

describe('production from nothing', () => {
  let db: Db;
  let app: App;
  const call = caller(() => app);
  let owner = '';
  let orgId = '';
  let centerId = '';
  let staffRoleId = '';
  let inviteLink = '';

  beforeAll(() => {
    db = openDb(':memory:');
    migrate(db);
    app = createApp({ db, dev: false, jwtSecret: SECRET, publicWebUrl: 'https://custock.example.com/custock', corsOrigins: [], now: () => clock, rateLimit: false });
  });

  it('the cli creates the business, its roles, the owner and the first shop', async () => {
    const out = io({ CUSTOCK_NEW_PASSWORD: 'kafeneio owner pass' });
    expect(await runCli(db, ['create-business', '--name', 'Kafeneio', '--slug', 'kafeneio', '--owner-email', 'Owner@Example.com', '--owner-name', 'Olga Owner', '--shop', 'Center'], out)).toBe(0);
    expect(out.lines[0]).toMatch(/^created Kafeneio \(kafeneio\)/);
    expect(out.lines.join('\n')).not.toContain('kafeneio owner pass');
    const login = await call('POST', '/v1/auth/login', undefined, { email: 'owner@example.com', password: 'kafeneio owner pass' });
    expect(login.status).toBe(200);
    owner = login.body.accessToken;
    const me = await call('GET', '/v1/me/context', owner);
    expect(me.body.orgs).toHaveLength(1);
    orgId = me.body.orgs[0].orgId;
    expect(me.body.orgs[0].slug).toBe('kafeneio');
    expect(me.body.orgs[0].orgPerms).toContain('shops.create');
    expect(me.body.orgs[0].shops).toHaveLength(1);
    centerId = me.body.orgs[0].shops[0].shopId;
    expect((db.prepare('SELECT count(*) n FROM roles WHERE org_id = ?').get(orgId) as Json).n).toBe(5);
  });

  it('refuses a taken email, a taken slug, a short password and unknown commands', async () => {
    await expect(runCli(db, ['create-business', '--name', 'B', '--slug', 'other', '--owner-email', 'owner@example.com', '--owner-name', 'X'], io({ CUSTOCK_NEW_PASSWORD: 'long enough pw' }))).rejects.toThrow('already has an account');
    await expect(runCli(db, ['create-business', '--name', 'B', '--slug', 'kafeneio', '--owner-email', 'b@example.com', '--owner-name', 'X'], io({ CUSTOCK_NEW_PASSWORD: 'long enough pw' }))).rejects.toThrow('slug kafeneio is taken');
    await expect(runCli(db, ['create-business', '--name', 'B', '--slug', 'bbb', '--owner-email', 'b@example.com', '--owner-name', 'X'], io({ CUSTOCK_NEW_PASSWORD: 'short' }))).rejects.toThrow('at least 10');
    await expect(runCli(db, ['create-business', '--name', 'B', '--slug', 'Bad Slug', '--owner-email', 'b@example.com', '--owner-name', 'X'], io({ CUSTOCK_NEW_PASSWORD: 'long enough pw' }))).rejects.toThrow('slug must be');
    expect(await runCli(db, ['nope'], io())).toBe(2);
    expect(db.prepare('SELECT 1 FROM users WHERE email = ?').get('b@example.com')).toBeUndefined();
  });

  it('add-shop makes a unique slug, set-password prints a one time password and signs everyone out', async () => {
    const out = io();
    expect(await runCli(db, ['add-shop', '--org', 'kafeneio', '--name', 'Center'], out)).toBe(0);
    expect(out.lines[0]).toMatch(/^added shop center-2 /);
    const pw = io({}, '');
    expect(await runCli(db, ['set-password', '--email', 'OWNER@example.com'], pw)).toBe(0);
    const generated = pw.lines.find((l) => l.startsWith('password (shown once): '))!.slice('password (shown once): '.length);
    expect(generated).toMatch(/^[A-Za-z0-9]{16}$/);
    expect((await call('GET', '/v1/me/context', owner)).status).toBe(401);
    const fromStdin = io({}, 'typed in password\n');
    expect(await runCli(db, ['set-password', '--email', 'owner@example.com', '--password-stdin'], fromStdin)).toBe(0);
    expect(fromStdin.lines.join('\n')).not.toContain('typed in password');
    owner = (await call('POST', '/v1/auth/login', undefined, { email: 'owner@example.com', password: 'typed in password' })).body.accessToken;
    expect(owner).toBeTruthy();
  });

  it('the owner adds a shop through the api', async () => {
    const r = await call('POST', `/v1/orgs/${orgId}/shops`, owner, { name: 'Λιμάνι' });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ name: 'Λιμάνι', slug: 'limani' });
    expect((await call('GET', `/v1/orgs/${orgId}/shops`, owner)).body).toHaveLength(3);
  });

  it('an invite comes back with its link, not emailed while sending is off', async () => {
    const roles = await call('GET', `/v1/orgs/${orgId}/roles`, owner);
    staffRoleId = roles.body.find((r: Json) => r.templateKey === 'staff' || r.name === 'Staff').id;
    const r = await call('POST', `/v1/orgs/${orgId}/invites`, owner, { email: 'Nina@Example.com', roleId: staffRoleId, scopeType: 'shop', scopeId: centerId, locale: 'en' });
    expect(r.status).toBe(201);
    expect(r.body.emailed).toBe(false);
    expect(r.body.devLink).toBeUndefined();
    expect(r.body.link).toMatch(/^https:\/\/custock.example.com\/custock\/invite\/[A-Za-z0-9_-]{20,}$/);
    inviteLink = r.body.link;
  });

  it('a brand new person opens the link, sets a name and password and lands in the shop as staff', async () => {
    const token = inviteLink.split('/').pop()!;
    const preview = await call('GET', `/v1/invites/${token}`, undefined, undefined, { 'Accept-Language': 'en' });
    expect(preview.body).toMatchObject({ orgName: 'Kafeneio', scopeName: 'Center', roleName: 'Staff', email: 'nina@example.com', accountExists: false });
    expect((await call('POST', '/v1/invites/register', undefined, { token, displayName: 'Nina', password: 'short' })).status).toBe(400);
    const reg = await call('POST', '/v1/invites/register', undefined, { token, displayName: 'Nina', password: 'nina.staff.password', locale: 'en' });
    expect(reg.status).toBe(201);
    expect(reg.body.orgId).toBe(orgId);
    const me = await call('GET', '/v1/me/context', reg.body.accessToken);
    expect(me.body.user).toMatchObject({ email: 'nina@example.com', displayName: 'Nina', locale: 'en' });
    expect(me.body.orgs[0].shops.map((x: Json) => x.shopId)).toEqual([centerId]);
    expect(me.body.orgs[0].shops[0].perms).toContain('stock.sell');
    // not emailed, so the address is not marked verified
    expect((db.prepare('SELECT email_verified_at FROM users WHERE email = ?').get('nina@example.com') as Json).email_verified_at).toBeNull();
    // the password works on the normal sign in, the link is used up
    expect((await call('POST', '/v1/auth/login', undefined, { email: 'nina@example.com', password: 'nina.staff.password' })).status).toBe(200);
    expect((await call('POST', '/v1/invites/register', undefined, { token, displayName: 'Nina', password: 'nina.staff.password' })).status).toBe(410);
    expect((await call('GET', `/v1/invites/${token}`)).status).toBe(410);
    // the inviter hears about it
    expect(db.prepare("SELECT 1 FROM dev_outbox WHERE channel = 'push' AND json_extract(payload, '$.type') = 'inviteAccepted'").get()).toBeTruthy();
  });

  it('an email that already has an account must sign in and accept, the link cannot take it over', async () => {
    const r = await call('POST', `/v1/orgs/${orgId}/invites`, owner, { email: 'nina@example.com', roleId: staffRoleId, scopeType: 'shop', scopeId: centerId, locale: 'en' });
    const token = r.body.link.split('/').pop();
    expect((await call('GET', `/v1/invites/${token}`)).body.accountExists).toBe(true);
    const reg = await call('POST', '/v1/invites/register', undefined, { token, displayName: 'Mallory', password: 'mallory.password' });
    expect(reg.status).toBe(409);
    expect(reg.body.code).toBe('account_exists');
    const nina = (await call('POST', '/v1/auth/login', undefined, { email: 'nina@example.com', password: 'nina.staff.password' })).body.accessToken;
    expect((await call('POST', '/v1/invites/accept', nina, { token })).status).toBe(200);
  });

  it('public signups: refused without a bot check, allowed with CUSTOCK_TURNSTILE=off', async () => {
    const link = await call('POST', `/v1/orgs/${orgId}/join-links`, owner, { scopeType: 'shop', scopeId: centerId, label: 'counter' });
    expect(link.status).toBe(201);
    const input = { name: 'Petros', email: 'petros@example.com', locale: 'el', emailNews: true, push: false, over15: true };
    expect((await call('POST', `/v1/public/join/${link.body.code}`, undefined, input)).status).toBe(403);
    const key = 'k'.repeat(40);
    app = createApp({ db, dev: false, jwtSecret: SECRET, publicWebUrl: 'https://custock.example.com/custock', corsOrigins: [], now: () => clock, rateLimit: false, turnstileOff: true, internalKey: key });
    const ok = await call('POST', `/v1/public/join/${link.body.code}`, undefined, input, { 'X-Custock-Internal': key, 'X-Custock-Client-Ip': '203.0.113.7' });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ pending: true });
    // the confirmation keeps the visitor's address the web server passed on
    expect((db.prepare('SELECT ip FROM join_confirmations ORDER BY created_at DESC LIMIT 1').get() as Json).ip).toBe('203.0.113.7');
    // without the right key the header is ignored
    await call('POST', `/v1/public/join/${link.body.code}`, undefined, { ...input, email: 'eve@example.com' }, { 'X-Custock-Internal': 'wrong'.repeat(8), 'X-Custock-Client-Ip': '198.51.100.9' });
    expect((db.prepare('SELECT ip FROM join_confirmations ORDER BY rowid DESC LIMIT 1').get() as Json).ip).not.toBe('198.51.100.9');
  });
});

// ---------------------------------------------------------------- small contract additions

describe('org slug on join pages, own shelf codes from the web address', () => {
  it('the join page and the confirmation name the business slug', async () => {
    const db = openDb(':memory:');
    migrate(db);
    seed(db, { passwordHash: hashPassword('custock'), now: clock });
    const app = createApp({ db, dev: true, jwtSecret: SECRET, publicWebUrl: 'https://custock.example.com/custock', corsOrigins: [], now: () => clock, rateLimit: false });
    const call = caller(() => app);
    expect((await call('GET', '/v1/public/join/kif7q2')).body.orgSlug).toBe('lemoni');
    const join = await call('POST', '/v1/public/join/kif7q2', undefined, { name: 'Lia', email: 'lia@example.com', locale: 'en', emailNews: true, push: false, over15: true });
    const token = join.body.devConfirmLink.split('/').pop();
    expect((await call('POST', '/v1/public/confirm', undefined, { token })).body).toMatchObject({ orgName: 'Lemoni', orgSlug: 'lemoni' });
    // a shelf qr printed with this server's address scans as the product inside
    const scan = await call('POST', `/v1/orgs/${(db.prepare("SELECT id FROM organizations WHERE slug = 'lemoni'").get() as Json).id}/scan`,
      (await call('POST', '/v1/auth/login', undefined, { email: 'maria@example.com', password: 'custock' })).body.accessToken,
      { code: 'https://custock.example.com/custock/p/5200044170102' });
    expect(scan.status).toBe(200);
    expect(scan.body).toMatchObject({ kind: 'gtin', codeNorm: '05200044170102' });
  });
});
