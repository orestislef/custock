// one browser, one session: a new sign in from the same browser ends the one it had, the account
// lists its devices in plain words, one device can be signed out, and nobody can sign out a device
// of someone else. the super admin's own sign outs land in the platform audit.

import { beforeAll, describe, expect, it } from 'vitest';
import { hashPassword, migrate, openDb, seed, type Db } from '@custock/db';
import { deviceOf, uuidv7 } from '@custock/core';
import { createApp, type App } from '../src/app';
import { runCli, type CliIo } from '../src/cli';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const SECRET = 'devices-test-secret-that-is-long-enough-1';
const clock = Date.now();
const CHROME_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36';
const SAFARI_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.2 Mobile/15E148 Safari/604.1';
const HOME_SCREEN = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';

describe('signed in devices', () => {
  let db: Db;
  let app: App;

  async function login(email: string, ua: string, deviceId?: string) {
    const res = await app.request('/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': ua },
      body: JSON.stringify({ email, password: 'custock', ...(deviceId === undefined ? {} : { deviceId }) }),
    });
    expect(res.status).toBe(200);
    return (await res.json()) as { accessToken: string; refreshToken: string };
  }
  async function call(method: string, path: string, token: string, body?: unknown) {
    const res = await app.request(path, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json().catch(() => null)) as Json };
  }
  const live = (email: string) => (db.prepare(
    `SELECT count(DISTINCT s.family_id) n FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE u.email = ? AND s.revoked_at IS NULL AND s.replaced_by IS NULL`,
  ).get(email) as { n: number }).n;

  beforeAll(async () => {
    db = openDb(':memory:');
    migrate(db);
    seed(db, { passwordHash: hashPassword('custock'), now: clock - 3_600_000 });
    app = createApp({ db, dev: true, jwtSecret: SECRET, publicWebUrl: 'http://localhost:3000', corsOrigins: [], now: () => clock, rateLimit: false });
    db.prepare("INSERT INTO users (id, email, display_name, password_hash, locale, created_at, updated_at) VALUES (?, 'root@example.com', 'Root', ?, 'en', ?, ?)")
      .run(uuidv7(clock), hashPassword('custock'), clock, clock);
    const io: CliIo = { env: {}, readStdin: async () => '', out: () => {} };
    expect(await runCli(db, ['make-superadmin', '--email', 'root@example.com'], io)).toBe(0);
  });

  it('reads the browser and the system from the user agent', () => {
    expect(deviceOf(CHROME_WIN)).toEqual({ browser: 'chrome', os: 'windows' });
    expect(deviceOf(SAFARI_IPHONE)).toEqual({ browser: 'safari', os: 'iphone' });
    expect(deviceOf(HOME_SCREEN)).toEqual({ browser: 'app', os: 'iphone' });
    expect(deviceOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36')).toEqual({ browser: 'chrome', os: 'mac' });
    expect(deviceOf('Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Mobile Safari/537.36 EdgA/157.0')).toEqual({ browser: 'edge', os: 'android' });
    expect(deviceOf(null)).toEqual({ browser: 'other', os: 'other' });
  });

  it('a new sign in from the same browser ends the session it had, other browsers stay', async () => {
    const email = 'maria@example.com';
    const first = await login(email, CHROME_WIN, 'browser-aaaa-1111');
    const phone = await login(email, SAFARI_IPHONE, 'phone-bbbb-2222');
    expect(live(email)).toBe(2);
    // the browser lost its token and signs in again
    const again = await login(email, CHROME_WIN, 'browser-aaaa-1111');
    expect(live(email)).toBe(2);
    expect((await call('GET', '/v1/me/context', first.accessToken)).status).toBe(401);
    expect((await call('GET', '/v1/me/context', phone.accessToken)).status).toBe(200);
    expect((await call('GET', '/v1/me/context', again.accessToken)).status).toBe(200);
    // a refresh keeps the device: signing in once more still leaves one session for it
    const r = await app.request('/v1/auth/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': CHROME_WIN }, body: JSON.stringify({ refreshToken: again.refreshToken }) });
    expect(r.status).toBe(200);
    await login(email, CHROME_WIN, 'browser-aaaa-1111');
    expect(live(email)).toBe(2);
    // without a device id (an old app, a script) nothing is replaced, and a bad one never blocks
    await login(email, CHROME_WIN);
    await login(email, CHROME_WIN, 'no spaces allowed!');
    expect(live(email)).toBe(4);
  });

  it('the device id of one person never touches the sessions of another', async () => {
    const a = await login('eleni@example.com', CHROME_WIN, 'shared-cccc-3333');
    await login('nikos@example.com', CHROME_WIN, 'shared-cccc-3333');
    expect((await call('GET', '/v1/me/context', a.accessToken)).status).toBe(200);
  });

  it('lists every device in plain words, this one first, and signs out one of them', async () => {
    const email = 'giorgos@example.com';
    const pc = await login(email, CHROME_WIN, 'gio-pc-00000001');
    const phone = await login(email, HOME_SCREEN, 'gio-phone-00000002');
    const here = await login(email, SAFARI_IPHONE, 'gio-safari-00000003');
    const list = await call('GET', '/v1/me/sessions', here.accessToken);
    expect(list.status).toBe(200);
    expect(list.body.others).toBe(2);
    expect(list.body.devices).toHaveLength(3);
    expect(list.body.devices[0]).toMatchObject({ current: true, browser: 'safari', os: 'iphone' });
    expect(list.body.devices.map((d: Json) => d.browser).sort()).toEqual(['app', 'chrome', 'safari']);
    for (const d of list.body.devices) {
      expect(Object.keys(d).sort()).toEqual(['browser', 'current', 'id', 'lastUsedAt', 'os', 'signedInAt']);
      expect(d.lastUsedAt).toBeGreaterThanOrEqual(d.signedInAt);
    }
    const pcId = list.body.devices.find((d: Json) => d.browser === 'chrome').id;
    // this device signs out from its own menu, not from the list
    expect((await call('DELETE', `/v1/me/sessions/${list.body.devices[0].id}`, here.accessToken)).status).toBe(409);
    expect((await call('DELETE', `/v1/me/sessions/${pcId}`, here.accessToken)).status).toBe(204);
    expect((await call('GET', '/v1/me/context', pc.accessToken)).status).toBe(401);
    expect((await call('GET', '/v1/me/context', phone.accessToken)).status).toBe(200);
    expect((await call('GET', '/v1/me/context', here.accessToken)).status).toBe(200);
    const after = await call('GET', '/v1/me/sessions', here.accessToken);
    expect(after.body.others).toBe(1);
    // gone already, or never there
    expect((await call('DELETE', `/v1/me/sessions/${pcId}`, here.accessToken)).status).toBe(404);
    expect((await call('DELETE', '/v1/me/sessions/not-a-device', here.accessToken)).status).toBe(404);
  });

  it('nobody signs out a device of someone else', async () => {
    const victim = await login('dimitris@example.com', CHROME_WIN, 'dim-pc-00000001');
    const other = await login('sofia@example.com', CHROME_WIN, 'sof-pc-00000001');
    const theirs = (await call('GET', '/v1/me/sessions', victim.accessToken)).body.devices[0].id;
    expect((await call('DELETE', `/v1/me/sessions/${theirs}`, other.accessToken)).status).toBe(404);
    expect((await call('GET', '/v1/me/context', victim.accessToken)).status).toBe(200);
    // the list shows only the person's own devices
    const mine = (await call('GET', '/v1/me/sessions', other.accessToken)).body.devices.map((d: Json) => d.id);
    expect(mine).not.toContain(theirs);
  });

  it('sign out others counts devices, not refreshes, and the super admin\'s sign outs are audited', async () => {
    const email = 'root@example.com';
    const away = await login(email, SAFARI_IPHONE, 'root-phone-00000001');
    // the phone refreshed a few times: still one device
    let rt = away.refreshToken;
    for (let i = 0; i < 3; i++) {
      const r = await app.request('/v1/auth/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': SAFARI_IPHONE }, body: JSON.stringify({ refreshToken: rt }) });
      rt = ((await r.json()) as { refreshToken: string }).refreshToken;
    }
    const mac = await login(email, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36', 'root-mac-00000002');
    const here = await login(email, CHROME_WIN, 'root-pc-00000003');
    const list = (await call('GET', '/v1/me/sessions', here.accessToken)).body;
    expect(list.others).toBe(2);
    const macId = list.devices.find((d: Json) => d.os === 'mac').id;
    expect((await call('DELETE', `/v1/me/sessions/${macId}`, here.accessToken)).status).toBe(204);
    expect((await call('GET', '/v1/me/context', mac.accessToken)).status).toBe(401);
    const out = await call('POST', '/v1/me/sessions/sign-out-others', here.accessToken);
    expect(out.body.signedOut).toBe(1);
    const audit = db.prepare("SELECT action FROM platform_audit WHERE action LIKE 'superadmin.%signed_out' ORDER BY created_at").all() as { action: string }[];
    expect(audit.map((a) => a.action)).toEqual(['superadmin.device_signed_out', 'superadmin.others_signed_out']);
    // nobody else's sign outs go to the platform audit
    expect(db.prepare("SELECT count(*) n FROM platform_audit WHERE actor_id != (SELECT id FROM users WHERE email = 'root@example.com') AND action LIKE 'superadmin.%signed_out'").get()).toEqual({ n: 0 });
  });
});
