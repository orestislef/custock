// bugs found before testers: people, invites and settings. each test is a case that was wrong once.

import { beforeAll, describe, expect, it } from 'vitest';
import { hashPassword, migrate, openDb, seed, type Db, type SeedResult } from '@custock/db';
import { createApp, type App } from '../src/app';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const SECRET = 'people-bughunt-secret-long-enough-1234';
const clock = Date.now();

describe('people and settings, cases that were wrong once', () => {
  let db: Db;
  let s: SeedResult;
  let app: App;
  const tokens: Record<string, string> = {};

  async function call(method: string, path: string, who?: string, body?: unknown) {
    const res = await app.request(path, {
      method,
      headers: { ...(who ? { Authorization: `Bearer ${tokens[who]}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
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
  }
  const org = () => `/v1/orgs/${s.orgId}`;
  const role = (key: string) => (db.prepare('SELECT id FROM roles WHERE org_id = ? AND template_key = ?').get(s.orgId, key) as { id: string }).id;

  beforeAll(async () => {
    db = openDb(':memory:');
    migrate(db);
    s = seed(db, { passwordHash: hashPassword('custock'), now: clock });
    app = createApp({ db, dev: true, jwtSecret: SECRET, publicWebUrl: 'http://localhost:3000', corsOrigins: [], now: () => clock, rateLimit: false });
    for (const who of ['eleni', 'maria']) {
      const r = await call('POST', '/v1/auth/login', undefined, { email: `${who}@example.com`, password: 'custock' });
      expect(r.status).toBe(200);
      tokens[who] = r.body.accessToken;
    }
  });

  it('inviting the same person to the same role and shop again leaves one working link', async () => {
    const body = { email: 'Twice@Example.com', roleId: role('staff'), scopeType: 'shop', scopeId: s.shops.kifisia };
    const first = await call('POST', `${org()}/invites`, 'maria', body);
    const second = await call('POST', `${org()}/invites`, 'maria', body);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const open = db.prepare("SELECT id FROM invites WHERE org_id = ? AND email = 'twice@example.com' AND accepted_at IS NULL AND revoked_at IS NULL").all(s.orgId) as { id: string }[];
    expect(open.map((r) => r.id)).toEqual([second.body.id]);
    const oldToken = String(first.body.link).split('/').pop();
    const newToken = String(second.body.link).split('/').pop();
    expect((await call('GET', `/v1/invites/${oldToken}`)).status).toBe(410);
    expect((await call('GET', `/v1/invites/${newToken}`)).status).toBe(200);
    // the open list shows the person once
    const list = await call('GET', `${org()}/invites`, 'eleni');
    expect(list.body.filter((i: Json) => i.email === 'twice@example.com')).toHaveLength(1);
  });

  it('a different role or shop for the same person is a separate invite', async () => {
    const a = await call('POST', `${org()}/invites`, 'eleni', { email: 'both@example.com', roleId: role('staff'), scopeType: 'shop', scopeId: s.shops.kifisia });
    const b = await call('POST', `${org()}/invites`, 'eleni', { email: 'both@example.com', roleId: role('staff'), scopeType: 'shop', scopeId: s.shops.marousi });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    const open = db.prepare("SELECT COUNT(*) n FROM invites WHERE org_id = ? AND email = 'both@example.com' AND accepted_at IS NULL AND revoked_at IS NULL").get(s.orgId) as { n: number };
    expect(open.n).toBe(2);
  });
});
