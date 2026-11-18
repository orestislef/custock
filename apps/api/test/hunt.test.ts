// the bug hunt before testers: reading limits stays inside what the team list shows, a category
// photo belongs to one category, the batched
// super admin context and platform numbers equal the one by one readers, and kept prepared
// statements keep working after the schema changes. nothing is ever sent.

import { beforeAll, describe, expect, it } from 'vitest';
import { hashPassword, migrate, openDb, seed, type Db, type SeedResult } from '@custock/db';
import { uuidv7 } from '@custock/core';
import { createApp, type App } from '../src/app';
import { runCli, type CliIo } from '../src/cli';
import { buildContextFor, preloadContexts } from '../src/lib/context';
import { prepared } from '../src/lib/tenant';
import { createBusiness } from '../src/services/bootstrap';
import { listBusinesses, overview } from '../src/services/platform';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const SECRET = 'hunt-test-secret-that-is-long-enough-12';
const clock = Date.now();

function io(): CliIo & { lines: string[] } {
  const lines: string[] = [];
  return { env: {}, readStdin: async () => '', out: (l) => lines.push(l), lines };
}

describe('bug hunt: security and speed', () => {
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
  const membership = (who: string) =>
    (db.prepare('SELECT id FROM memberships WHERE org_id = ? AND user_id = ?').get(s.orgId, s.users[who]) as { id: string }).id;

  beforeAll(async () => {
    db = openDb(':memory:');
    migrate(db);
    s = seed(db, { passwordHash: hashPassword('custock'), now: clock - 3_600_000 });
    app = createApp({ db, dev: true, jwtSecret: SECRET, publicWebUrl: 'http://localhost:3000', corsOrigins: [], now: () => clock, rateLimit: false });
    db.prepare("INSERT INTO users (id, email, display_name, password_hash, locale, created_at, updated_at) VALUES (?, 'root@example.com', 'Root', ?, 'en', ?, ?)")
      .run(uuidv7(clock), hashPassword('custock'), clock, clock);
    expect(await runCli(db, ['make-superadmin', '--email', 'root@example.com'], io())).toBe(0);
    const pw = hashPassword('custock');
    for (let i = 0; i < 6; i++) {
      createBusiness(db, { name: `Hunt ${i}`, slug: `hunt-${i}`, ownerEmail: `hunt${i}@example.com`, ownerName: `Hunt ${i}`, passwordHash: i % 2 ? pw : undefined, webUrl: 'http://localhost:3000', shopName: 'Main', now: clock - i * 1000 });
    }
    for (const who of ['eleni', 'maria', 'katerina', 'dimitris', 'root']) {
      const r = await app.request('/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `${who}@example.com`, password: 'custock' }) });
      tokens[who] = ((await r.json()) as { accessToken: string }).accessToken;
    }
  });

  it("a shop manager reads the limits of people in their shop, not of people elsewhere", async () => {
    const org = `/v1/orgs/${s.orgId}`;
    // maria runs Kifisia, dimitris works there, katerina works in Marousi
    expect((await call('GET', `${org}/members/${membership('dimitris')}/policies`, 'maria')).status).toBe(200);
    expect((await call('GET', `${org}/members/${membership('katerina')}/policies`, 'maria')).status).toBe(403);
    // the owner sees everyone, a person always sees their own
    expect((await call('GET', `${org}/members/${membership('katerina')}/policies`, 'eleni')).status).toBe(200);
    expect((await call('GET', `${org}/members/${membership('katerina')}/policies`, 'katerina')).status).toBe(200);
  });

  it("someone working in one shop cannot read another shop's limits", async () => {
    const org = `/v1/orgs/${s.orgId}`;
    expect((await call('GET', `${org}/shops/${s.shops.marousi}/policies`, 'katerina')).status).toBe(200);
    expect((await call('GET', `${org}/shops/${s.shops.kifisia}/policies`, 'katerina')).status).toBe(404);
    expect((await call('GET', `${org}/shops/${s.shops.kifisia}/policies`, 'eleni')).status).toBe(200);
    expect((await call('GET', `${org}/shops/${s.shops.kifisia}/policies`, 'root')).status).toBe(200);
  });

  it('one photo belongs to one category, so changing one never removes the picture of another', async () => {
    const base = `/v1/orgs/${s.orgId}/categories`;
    db.prepare("INSERT INTO files (id, org_id, storage_key, purpose, is_public, mime, bytes, created_at, confirmed_at) VALUES ('f-hunt', ?, ?, 'category', 1, 'image/webp', 10, ?, ?)")
      .run(s.orgId, `orgs/${s.orgId}/categories/f-hunt.webp`, clock, clock);
    const one = await call('POST', base, 'eleni', { name: 'Hunt one', imageFileId: 'f-hunt' });
    expect(one.status).toBe(201);
    const two = await call('POST', base, 'eleni', { name: 'Hunt two' });
    const taken = await call('PATCH', `${base}/${two.body.id}`, 'eleni', { imageFileId: 'f-hunt' });
    expect(taken.status).toBe(409);
    expect(taken.body.fields).toEqual({ imageFileId: 'in_use' });
    expect((await call('POST', base, 'eleni', { name: 'Hunt three', imageFileId: 'f-hunt' })).status).toBe(409);
    // the category that has it may set it again
    expect((await call('PATCH', `${base}/${one.body.id}`, 'eleni', { imageFileId: 'f-hunt' })).status).toBe(200);
  });

  it('builds the super admin context for many businesses the same way, batched', async () => {
    const root = (db.prepare("SELECT id FROM users WHERE email = 'root@example.com'").get() as { id: string }).id;
    const ids = (db.prepare('SELECT id FROM organizations WHERE archived_at IS NULL ORDER BY name').all() as { id: string }[]).map((r) => r.id);
    // a super admin who is also a member somewhere: member and platform access in one list
    db.prepare("UPDATE organizations SET max_shops = 1, disabled_features = '[\"posts\"]' WHERE slug = 'hunt-1'").run();
    const pre = preloadContexts(db, ids, root);
    for (const id of ids) {
      expect(JSON.stringify(buildContextFor(db, id, root, pre)?.access)).toBe(JSON.stringify(buildContextFor(db, id, root)?.access));
    }
    const eleni = s.users.eleni!;
    const own = preloadContexts(db, [s.orgId], eleni);
    expect(JSON.stringify(buildContextFor(db, s.orgId, eleni, own)?.access)).toBe(JSON.stringify(buildContextFor(db, s.orgId, eleni)?.access));
    const me = await call('GET', '/v1/me/context', 'root');
    expect(me.status).toBe(200);
    expect(me.body.orgs.length).toBe(ids.length);
    expect(me.body.orgs.find((o: Json) => o.slug === 'hunt-1').shopsFull).toBe(true);
  });

  it('counts the platform list and overview with grouped queries, same numbers', () => {
    const list = listBusinesses(db, clock);
    const lemoni = list.find((b) => b.orgId === s.orgId)!;
    const n = (sql: string, ...p: unknown[]) => (db.prepare(sql).get(...p) as { n: number }).n;
    expect(lemoni.counts.shops).toBe(n('SELECT count(*) AS n FROM shops WHERE org_id = ? AND archived_at IS NULL', s.orgId));
    expect(lemoni.counts.products).toBe(n('SELECT count(*) AS n FROM products WHERE org_id = ? AND archived_at IS NULL', s.orgId));
    expect(lemoni.owners.map((o) => o.email)).toEqual(['eleni@example.com']);
    // businesses made with an invite have one open owner invite, the others none
    for (const b of list.filter((x) => x.slug.startsWith('hunt-'))) {
      expect(b.pendingOwnerInvites.length).toBe(Number(b.slug.slice(5)) % 2 ? 0 : 1);
      expect(b.owners.length).toBe(Number(b.slug.slice(5)) % 2 ? 1 : 0);
    }
    const o = overview(db, clock);
    expect(o.businesses).toBe(list.length);
    expect(o.shops).toBe(list.reduce((a, b) => a + b.counts.shops, 0));
    expect(o.products).toBe(list.reduce((a, b) => a + b.counts.products, 0));
    expect(o.pendingInvites).toBe(3);
    // the sample business has sales in the last 14 days
    expect(o.sales14d.find((m) => m.currency === 'EUR')!.minor).toBeGreaterThan(0);
  });

  it('keeps prepared statements, and they still work after the schema changes', () => {
    const t = openDb(':memory:');
    t.exec('CREATE TABLE things (id INTEGER PRIMARY KEY, name TEXT)');
    const a = prepared(t, 'SELECT * FROM things');
    expect(prepared(t, 'SELECT * FROM things')).toBe(a);
    t.exec("INSERT INTO things (name) VALUES ('one')");
    t.exec('ALTER TABLE things ADD COLUMN size INTEGER DEFAULT 3');
    expect(prepared(t, 'SELECT * FROM things').all()).toEqual([{ id: 1, name: 'one', size: 3 }]);
    t.close();
  });
});
