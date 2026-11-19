// forgot password: the same answer for every email, one time links that expire, every session
// signed out on reset, limits, the notice email, and safety mail passing a platform email pause.
// nothing is ever sent: the outbox is read directly and delivery runs through a fake sender.

import { beforeAll, describe, expect, it } from 'vitest';
import { hashPassword, migrate, openDb, seed, type Db } from '@custock/db';
import { createApp, type App } from '../src/app';
import { drainOutbox, type OutboxRow } from '../src/lib/live';
import { devOutboxTransport } from '../src/lib/transport';
import { RESET_TTL } from '../src/routes/password-reset';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const SECRET = 'password-reset-test-secret-long-enough-42';
const WEB = 'https://shop.example/custock';
let clock = Date.UTC(2026, 10, 18, 9, 0, 0);
let ipCounter = 0;
const freshIp = () => `203.0.113.${++ipCounter}`;

let db: Db;
let app: App;

async function call(method: string, path: string, opts: { token?: string; body?: unknown; ip?: string } = {}) {
  const res = await app.request(path, {
    method,
    headers: {
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      'X-Forwarded-For': opts.ip ?? freshIp(),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  let body: Json = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // not json
  }
  return { status: res.status, body };
}

const resetMails = (to: string, type = 'password_reset') =>
  db.prepare("SELECT * FROM dev_outbox WHERE to_address = ? AND json_extract(payload, '$.type') = ? ORDER BY created_at, rowid").all(to, type) as Json[];

function tokenFrom(mail: Json): string {
  const m = /\/admin\/reset\/([A-Za-z0-9_-]{20,})/.exec(mail.body);
  if (!m) throw new Error('no reset link in the email');
  return m[1]!;
}

async function login(email: string, password: string) {
  return call('POST', '/v1/auth/login', { body: { email, password } });
}

beforeAll(() => {
  db = openDb(':memory:');
  migrate(db);
  seed(db, { passwordHash: hashPassword('custock'), now: clock });
  app = createApp({ db, dev: false, jwtSecret: SECRET, publicWebUrl: WEB, corsOrigins: [], now: () => clock, rateLimit: false, trustedProxy: true });
});

describe('forgot password', () => {
  it('answers the same for an account, an unknown email and a customer without a password', async () => {
    const customer = db.prepare('SELECT email FROM users WHERE password_hash IS NULL AND email IS NOT NULL LIMIT 1').get() as Json;
    expect(customer?.email).toBeTruthy();
    const answers = [];
    for (const email of ['nikos@example.com', 'nobody.here@example.com', customer.email]) {
      answers.push(await call('POST', '/v1/auth/password/forgot', { body: { email, locale: 'en' } }));
    }
    for (const a of answers) {
      expect(a.status).toBe(202);
      expect(a.body).toEqual({ sent: true });
    }
    expect(resetMails('nikos@example.com')).toHaveLength(1);
    expect(resetMails('nobody.here@example.com')).toHaveLength(0);
    expect(resetMails(customer.email)).toHaveLength(0);
    // the customer hears how to sign in instead, with a link to the shop they follow
    const howTo = resetMails(customer.email, 'code_sign_in');
    expect(howTo).toHaveLength(1);
    expect(howTo[0].body).toMatch(/\/s\/[a-z0-9-]+\/me/);
    expect(howTo[0].body).not.toMatch(/\/admin\/reset\//);
    // only a hash of the token is kept
    const token = tokenFrom(resetMails('nikos@example.com')[0]);
    const stored = db.prepare('SELECT token_hash FROM password_resets').all() as Json[];
    expect(stored.some((r) => r.token_hash.includes(token))).toBe(false);
  });

  it('the email is in the account language, in the app look, with a link to the reset page', async () => {
    db.prepare("UPDATE users SET locale = 'el' WHERE email = 'giorgos@example.com'").run();
    await call('POST', '/v1/auth/password/forgot', { body: { email: 'Giorgos@Example.com', locale: 'en' } });
    const [mail] = resetMails('giorgos@example.com');
    expect(mail.locale).toBe('el');
    expect(mail.title).toBe('Επαναφορά κωδικού πρόσβασης Custock');
    expect(mail.html).toContain(`${WEB}/admin/reset/`);
    expect(mail.html).toContain('max-width:600px');
    expect(mail.org_id).toBeNull();
  });

  it('a reset signs out every session, signs this one in, and the link works once', async () => {
    const before = await login('maria@example.com', 'custock');
    const other = await login('maria@example.com', 'custock');
    expect(before.status).toBe(200);
    expect((await call('GET', '/v1/me/context', { token: before.body.accessToken })).status).toBe(200);

    await call('POST', '/v1/auth/password/forgot', { body: { email: 'maria@example.com' } });
    const token = tokenFrom(resetMails('maria@example.com').at(-1));

    const preview = await call('GET', `/v1/auth/password/reset/${token}`);
    expect(preview.status).toBe(200);
    expect(preview.body).toEqual({ valid: true, expiresAt: clock + RESET_TTL });

    expect((await call('POST', '/v1/auth/password/reset', { body: { token, password: 'short' } })).status).toBe(400);

    const done = await call('POST', '/v1/auth/password/reset', { body: { token, password: 'a.new.long.password' } });
    expect(done.status).toBe(200);
    expect(done.body.accessToken).toBeTruthy();
    expect(done.body.refreshToken).toBeTruthy();

    // every older session is gone, access and refresh alike
    expect((await call('GET', '/v1/me/context', { token: before.body.accessToken })).status).toBe(401);
    expect((await call('GET', '/v1/me/context', { token: other.body.accessToken })).status).toBe(401);
    expect((await call('POST', '/v1/auth/refresh', { body: { refreshToken: before.body.refreshToken } })).status).toBe(401);
    // the new one works, the old password does not
    expect((await call('GET', '/v1/me/context', { token: done.body.accessToken })).status).toBe(200);
    expect((await login('maria@example.com', 'custock')).status).toBe(401);
    expect((await login('maria@example.com', 'a.new.long.password')).status).toBe(200);

    // used: the link never works again
    const again = await call('POST', '/v1/auth/password/reset', { body: { token, password: 'yet.another.password' } });
    expect(again.status).toBe(410);
    expect(again.body.code).toBe('reset_expired');
    expect((await call('GET', `/v1/auth/password/reset/${token}`)).status).toBe(410);

    // and the person hears about it, with a way back if it was not them
    const notice = resetMails('maria@example.com', 'password_changed');
    expect(notice).toHaveLength(1);
    expect(notice[0].html).toContain(`${WEB}/admin/forgot`);
  });

  it('links expire after 30 minutes', async () => {
    await call('POST', '/v1/auth/password/forgot', { body: { email: 'dimitris@example.com' } });
    const token = tokenFrom(resetMails('dimitris@example.com').at(-1));
    const start = clock;
    try {
      clock = start + RESET_TTL + 1000;
      expect((await call('GET', `/v1/auth/password/reset/${token}`)).status).toBe(410);
      const late = await call('POST', '/v1/auth/password/reset', { body: { token, password: 'too.late.for.this' } });
      expect(late.status).toBe(410);
      expect((await login('dimitris@example.com', 'custock')).status).toBe(200);
    } finally {
      clock = start;
    }
  });

  it('a newer link ends the older one, and unknown links get the same answer as used ones', async () => {
    await call('POST', '/v1/auth/password/forgot', { body: { email: 'katerina@example.com' } });
    await call('POST', '/v1/auth/password/forgot', { body: { email: 'katerina@example.com' } });
    const [first, second] = resetMails('katerina@example.com').map(tokenFrom);
    expect((await call('GET', `/v1/auth/password/reset/${first}`)).status).toBe(410);
    expect((await call('GET', `/v1/auth/password/reset/${second}`)).status).toBe(200);
    const unknown = await call('GET', '/v1/auth/password/reset/not-a-real-token-at-all');
    expect(unknown.status).toBe(410);
    expect(unknown.body.code).toBe('reset_expired');
  });

  it('limits: three links an hour per email without changing the answer, ten requests an hour per address', async () => {
    for (let i = 0; i < 5; i++) {
      const r = await call('POST', '/v1/auth/password/forgot', { body: { email: 'sofia@example.com' } });
      expect(r.status).toBe(202);
      expect(r.body).toEqual({ sent: true });
    }
    expect(resetMails('sofia@example.com')).toHaveLength(3);

    const ip = freshIp();
    const statuses = [];
    for (let i = 0; i < 11; i++) {
      statuses.push((await call('POST', '/v1/auth/password/forgot', { ip, body: { email: `someone${i}@example.com` } })).status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 202)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it('safety mail goes out during a platform email pause, other mail waits', async () => {
    db.prepare("INSERT INTO platform_settings (key, value, updated_at) VALUES ('pause_email', '1', ?) ON CONFLICT (key) DO UPDATE SET value = '1'").run(clock);
    try {
      db.prepare('UPDATE dev_outbox SET sent_at = ? WHERE sent_at IS NULL').run(clock);
      await call('POST', '/v1/auth/password/forgot', { body: { email: 'eleni@example.com' } });
      devOutboxTransport(db).send({ channel: 'email', to: 'eleni@example.com', title: 'An ordinary email', body: 'Waits for the pause to end.', payload: { type: 'otp' } });
      const sent: OutboxRow[] = [];
      await drainOutbox(db, { email: async (row) => void sent.push(row) }, clock);
      expect(sent.map((r) => JSON.parse(r.payload ?? '{}').type)).toEqual(['password_reset']);
      const waiting = db.prepare("SELECT count(*) AS n FROM dev_outbox WHERE sent_at IS NULL AND json_extract(payload, '$.type') = 'otp'").get() as Json;
      expect(waiting.n).toBe(1);
    } finally {
      db.prepare("DELETE FROM platform_settings WHERE key = 'pause_email'").run();
    }
  });
});
