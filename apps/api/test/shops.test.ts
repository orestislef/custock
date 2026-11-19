// shops from the app: an owner adds a shop and edits its details, the rules hold (who may add,
// who may edit which shop, the super admin's limit), and a shop of another business is not found.

import { beforeAll, describe, expect, it } from 'vitest';
import { hashPassword, migrate, openDb, seed, type Db, type SeedResult } from '@custock/db';
import { uuidv7 } from '@custock/core';
import { createApp, type App } from '../src/app';
import { runCli, type CliIo } from '../src/cli';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const SECRET = 'shops-test-secret-that-is-long-enough-1';
const clock = Date.now();

describe('shops from the app', () => {
  let db: Db;
  let s: SeedResult;
  let app: App;
  const tokens: Record<string, string> = {};

  async function call(method: string, path: string, who: string, body?: unknown) {
    const res = await app.request(path, {
      method,
      headers: { Authorization: `Bearer ${tokens[who]}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json().catch(() => null)) as Json };
  }
  const O = () => `/v1/orgs/${s.orgId}`;

  beforeAll(async () => {
    db = openDb(':memory:');
    migrate(db);
    s = seed(db, { passwordHash: hashPassword('custock'), now: clock - 3_600_000 });
    app = createApp({ db, dev: true, jwtSecret: SECRET, publicWebUrl: 'http://localhost:3000', corsOrigins: [], now: () => clock, rateLimit: false });
    db.prepare("INSERT INTO users (id, email, display_name, password_hash, locale, created_at, updated_at) VALUES (?, 'root@example.com', 'Root', ?, 'en', ?, ?)")
      .run(uuidv7(clock), hashPassword('custock'), clock, clock);
    const io: CliIo = { env: {}, readStdin: async () => '', out: () => {} };
    expect(await runCli(db, ['make-superadmin', '--email', 'root@example.com'], io)).toBe(0);
    for (const who of ['eleni', 'maria', 'root']) {
      const r = await app.request('/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `${who}@example.com`, password: 'custock' }) });
      tokens[who] = ((await r.json()) as { accessToken: string }).accessToken;
    }
  });

  it('the owner adds a shop with its details, and it is one of the shops at once', async () => {
    const r = await call('POST', `${O()}/shops`, 'eleni', { name: '  Kallithea  ', city: 'Athens', address: 'Thiseos 12', phone: '210 123 4567' });
    expect(r.status).toBe(201);
    expect(r.body.name).toBe('Kallithea');
    expect(r.body.phone).toBe('+302101234567');
    const all = await call('GET', `${O()}/shops`, 'eleni');
    expect((all.body as Json[]).some((x) => x.id === r.body.id)).toBe(true);
    const ctx = await call('GET', '/v1/me/context', 'eleni');
    expect(ctx.body.orgs.find((o: Json) => o.orgId === s.orgId).shops.some((x: Json) => x.shopId === r.body.id)).toBe(true);
  });

  it('the owner changes a shop\'s details, an empty phone clears it', async () => {
    const r = await call('PATCH', `${O()}/shops/${s.shops.marousi}`, 'eleni', { name: 'Marousi Centre', city: 'Marousi', address: null, phone: null });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ name: 'Marousi Centre', city: 'Marousi', address: null, phone: null });
  });

  it('a shop that is not in the business is refused, and nothing is audited', async () => {
    const before = (db.prepare("SELECT count(*) AS n FROM audit_log WHERE action = 'shop.updated'").get() as { n: number }).n;
    const r = await call('PATCH', `${O()}/shops/${uuidv7(clock)}`, 'eleni', { name: 'Nowhere' });
    expect([403, 404]).toContain(r.status);
    expect((db.prepare("SELECT count(*) AS n FROM audit_log WHERE action = 'shop.updated'").get() as { n: number }).n).toBe(before);
  });

  it('a manager of one shop cannot add shops or change another shop', async () => {
    expect((await call('POST', `${O()}/shops`, 'maria', { name: 'Hers' })).status).toBe(403);
    expect((await call('PATCH', `${O()}/shops/${s.shops.glyfada}`, 'maria', { name: 'Not hers' })).status).toBe(403);
  });

  it('bad details come back as field errors', async () => {
    const r = await call('POST', `${O()}/shops`, 'eleni', { name: '', phone: 'call me' });
    expect(r.status).toBe(400);
  });

  it('at the super admin\'s limit a new shop is refused', async () => {
    const shops = (db.prepare('SELECT count(*) AS n FROM shops WHERE org_id = ?').get(s.orgId) as { n: number }).n;
    const set = await call('PATCH', `/v1/platform/businesses/${s.orgId}/controls`, 'root', { maxShops: shops });
    expect(set.status).toBeLessThan(300);
    const r = await call('POST', `${O()}/shops`, 'eleni', { name: 'One too many' });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('limit_reached');
    const ctx = await call('GET', '/v1/me/context', 'eleni');
    expect(ctx.body.orgs.find((o: Json) => o.orgId === s.orgId).shopsFull).toBe(true);
  });
});
