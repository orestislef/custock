// the customer side promises what the business really does: its own push cap and quiet hours on
// the join page and in the customer app, a shelf QR that always offers a way in, and an email
// change undo link that says up front when it no longer works. nothing is sent.

import { beforeAll, describe, expect, it } from 'vitest';
import { hashPassword, migrate, openDb, seed, sha256, type Db, type SeedResult } from '@custock/db';
import { createApp, type App } from '../src/app';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const SECRET = 'customer-side-test-secret-long-enough-1';
const clock = Date.now();
const WEB = 'https://custock.example.com';

describe('the customer side tells the truth', () => {
  let db: Db;
  let s: SeedResult;
  let app: App;
  let owner = '';

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

  beforeAll(async () => {
    db = openDb(':memory:');
    migrate(db);
    s = seed(db, { passwordHash: hashPassword('custock'), now: clock });
    app = createApp({ db, dev: true, jwtSecret: SECRET, publicWebUrl: WEB, corsOrigins: [], now: () => clock, rateLimit: false });
    owner = (await call('POST', '/v1/auth/login', undefined, { email: 'eleni@example.com', password: 'custock' })).body.accessToken;
  });

  it('the public business info carries its own push cap and quiet hours', async () => {
    db.prepare("UPDATE organizations SET push_daily_cap = 1, quiet_hours = '21:30-08:00' WHERE id = ?").run(s.orgId);
    const r = await call('GET', '/v1/public/orgs/lemoni');
    expect(r.status).toBe(200);
    expect(r.body.pushDailyCap).toBe(1);
    expect(r.body.quietHours).toBe('21:30-08:00');
  });

  it('the join page carries them too', async () => {
    const code = Object.keys(s.joinLinks)[0]!;
    const r = await call('GET', `/v1/public/join/${code}`);
    expect(r.status).toBe(200);
    expect(r.body.pushDailyCap).toBe(1);
    expect(r.body.quietHours).toBe('21:30-08:00');
  });

  it('an unknown business is not found, never made up from the address', async () => {
    const r = await call('GET', '/v1/public/orgs/nosuchshop');
    expect(r.status).toBe(404);
  });

  it('a shelf product names its business page, so a visitor can join from it', async () => {
    const row = db.prepare('SELECT code FROM barcodes WHERE org_id = ? LIMIT 1').get(s.orgId) as { code: string };
    const r = await call('GET', `/v1/public/p/${row.code}`);
    expect(r.status).toBe(200);
    expect(r.body.orgSlug).toBe('lemoni');
  });

  it('the email change undo link says whether it still works, without using it', async () => {
    const user = s.users['maria']!;
    const token = 'revert-token-for-the-test-1234567890';
    db.prepare(
      'INSERT INTO email_reverts (id, user_id, token_hash, old_email, new_email, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run('rv-1', user, sha256(`revert:${token}`), 'old-maria@example.com', 'maria@example.com', clock, clock + 86_400_000);
    const ok = await call('GET', `/v1/public/email-revert/${token}`);
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ valid: true });
    // asking does not use it
    const row = db.prepare('SELECT used_at FROM email_reverts WHERE id = ?').get('rv-1') as { used_at: number | null };
    expect(row.used_at).toBeNull();
    expect((await call('GET', '/v1/public/email-revert/not-a-real-token-at-all')).status).toBe(410);
    expect((await call('GET', '/v1/public/email-revert/short')).status).toBe(410);
    db.prepare('UPDATE email_reverts SET used_at = ? WHERE id = ?').run(clock, 'rv-1');
    expect((await call('GET', `/v1/public/email-revert/${token}`)).status).toBe(410);
  });

  it('owners still read the settings they changed', async () => {
    const r = await call('GET', `/v1/orgs/${s.orgId}`, owner);
    expect(r.status).toBe(200);
    expect(r.body.quietHours).toBe('21:30-08:00');
  });
});
