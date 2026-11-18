// the platform level: super admins above every business, the businesses they create, owner and
// super admin invites, per business controls (features, limits, paused), platform wide pauses,
// the storage free tier, the platform audit and the command line. nothing is ever sent.

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword, migrate, openDb, seed, type Db, type SeedResult } from '@custock/db';
import { uuidv7 } from '@custock/core';
import { createApp, type App } from '../src/app';
import { runCli, type CliIo } from '../src/cli';
import { drainOutbox, type LiveSender } from '../src/lib/live';
import { devOutboxTransport } from '../src/lib/transport';
import { sendGate } from '../src/lib/platform-access';
import { createBusiness } from '../src/services/bootstrap';
import { deleteBusinessEverything } from '../src/services/platform';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const SECRET = 'platform-test-secret-long-enough-1234';
const clock = Date.now();
const WEB = 'http://localhost:3000/custock';

function caller(app: () => App) {
  return async (method: string, path: string, token?: string, body?: unknown) => {
    const res = await app().request(path, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
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

function io(env: Record<string, string | undefined> = {}): CliIo & { lines: string[] } {
  const lines: string[] = [];
  return { env, readStdin: async () => '', out: (l) => lines.push(l), lines };
}

const tokenOf = (link: string) => link.split('/').pop()!;

describe('platform', () => {
  let db: Db;
  let s: SeedResult;
  let app: App;
  const call = caller(() => app);
  const tokens: Record<string, string> = {};
  let rootId = '';

  async function login(email: string, password = 'custock') {
    const r = await call('POST', '/v1/auth/login', undefined, { email, password });
    expect(r.status).toBe(200);
    return r.body.accessToken as string;
  }

  beforeAll(async () => {
    db = openDb(':memory:');
    migrate(db);
    s = seed(db, { passwordHash: hashPassword('custock'), now: clock });
    app = createApp({ db, dev: true, jwtSecret: SECRET, publicWebUrl: WEB, corsOrigins: [], now: () => clock, rateLimit: false });
    for (const who of ['eleni', 'maria', 'sofia', 'anna']) tokens[who] = await login(`${who}@example.com`);
    // the platform owner: an account that works in no business, made super admin from the command line
    rootId = uuidv7(clock);
    db.prepare(`INSERT INTO users (id, email, display_name, password_hash, locale, created_at, updated_at) VALUES (?, ?, ?, ?, 'en', ?, ?)`)
      .run(rootId, 'root@example.com', 'Root', hashPassword('custock'), clock, clock);
    const out = io();
    expect(await runCli(db, ['make-superadmin', '--email', 'root@example.com'], out)).toBe(0);
    expect(out.lines.join(' ')).toMatch(/now a super admin/);
    tokens.root = await login('root@example.com');
  });

  afterEach(() => {
    db.prepare('DELETE FROM platform_settings').run();
    db.prepare("UPDATE organizations SET status = 'active', disabled_features = '[]', max_shops = NULL, max_staff = NULL").run();
  });

  // ------------------------------------------------------------ access

  it('answers 403 to staff, owners and customers on every platform route', async () => {
    for (const who of ['eleni', 'maria', 'sofia', 'anna']) {
      expect((await call('GET', '/v1/platform/overview', tokens[who])).status).toBe(403);
      expect((await call('GET', '/v1/platform/businesses', tokens[who])).status).toBe(403);
      expect((await call('PATCH', '/v1/platform/settings', tokens[who], { pause_email: true })).status).toBe(403);
      expect((await call('PATCH', `/v1/platform/businesses/${s.orgId}/controls`, tokens[who], { status: 'suspended' })).status).toBe(403);
      expect((await call('POST', '/v1/platform/superadmin-invites', tokens[who], { email: 'x@example.com' })).status).toBe(403);
    }
    expect((await call('GET', '/v1/platform/overview')).status).toBe(401);
    expect((await call('GET', '/v1/platform/overview', tokens.root)).status).toBe(200);
  });

  it('gives a super admin every business without being a member, and never counts him', async () => {
    const me = (await call('GET', '/v1/me/context', tokens.root)).body;
    expect(me.platformRole).toBe('superadmin');
    const lemoni = me.orgs.find((o: Json) => o.orgId === s.orgId);
    expect(lemoni.platformAccess).toBe(true);
    expect(lemoni.orgPerms).toContain('org.settings.manage');
    expect(lemoni.shops).toHaveLength(3);
    expect((await call('GET', '/v1/me/context', tokens.eleni)).body.platformRole).toBeNull();

    expect((await call('GET', `/v1/orgs/${s.orgId}/customers`, tokens.root)).status).toBe(200);
    const members = (await call('GET', `/v1/orgs/${s.orgId}/members`, tokens.root)).body;
    expect(JSON.stringify(members)).not.toContain('root@example.com');

    // what he does inside a business is marked in its audit log and copied to the platform audit
    expect((await call('PATCH', `/v1/orgs/${s.orgId}`, tokens.root, { postsNeedApproval: false })).status).toBe(200);
    const row = db.prepare("SELECT actor_kind FROM audit_log WHERE org_id = ? AND actor_id = ? ORDER BY created_at DESC LIMIT 1").get(s.orgId, rootId) as Json;
    expect(row.actor_kind).toBe('platform_admin');
    const p = db.prepare('SELECT action FROM platform_audit WHERE org_id = ? AND actor_id = ?').all(s.orgId, rootId) as Json[];
    expect(p.length).toBeGreaterThan(0);
  });

  it('lets a super admin hand out the owner role, which owners cannot', async () => {
    const roles = (await call('GET', `/v1/orgs/${s.orgId}/roles`, tokens.root)).body as Json[];
    const owner = roles.find((r) => r.templateKey === 'owner' || r.name === 'Owner');
    const r = await call('POST', `/v1/orgs/${s.orgId}/invites`, tokens.root, { email: 'co.owner@example.com', roleId: owner.id, scopeType: 'org', scopeId: s.orgId, locale: 'en' });
    expect(r.status).toBe(201);
    const e = await call('POST', `/v1/orgs/${s.orgId}/invites`, tokens.eleni, { email: 'co.owner2@example.com', roleId: owner.id, scopeType: 'org', scopeId: s.orgId, locale: 'en' });
    expect(e.status).toBe(403);
  });

  // ------------------------------------------------------------ businesses

  it('creates a business with a suggested slug and an owner invite the owner can use', async () => {
    expect((await call('GET', '/v1/platform/slug?name=' + encodeURIComponent('Φούρνος Κηφισιάς'), tokens.root)).body.slug).toBe('furnos-kifisias');
    expect((await call('GET', '/v1/platform/slug?name=' + encodeURIComponent('Лемони'), tokens.root)).body.slug).toBe('lemoni-2');
    const r = await call('POST', '/v1/platform/businesses', tokens.root, { name: 'Φούρνος Κηφισιάς', ownerEmail: 'baker@example.com', shopName: 'Κηφισιά', locale: 'el' });
    expect(r.status).toBe(201);
    expect(r.body.slug).toBe('furnos-kifisias');
    expect(r.body.emailed).toBe(false);
    expect(r.body.link).toContain('/invite/');
    const list = (await call('GET', '/v1/platform/businesses', tokens.root)).body as Json[];
    const b = list.find((x) => x.orgId === r.body.orgId);
    expect(b.pendingOwnerInvites).toHaveLength(1);
    expect(b.counts.shops).toBe(1);
    // the owner sets name and password from the link, the business gets its join link then
    const reg = await call('POST', '/v1/invites/register', undefined, { token: tokenOf(r.body.link), displayName: 'Baker', password: 'a-long-password' });
    expect(reg.status).toBe(201);
    const detail = (await call('GET', `/v1/platform/businesses/${r.body.orgId}`, tokens.root)).body;
    expect(detail.owners.map((o: Json) => o.email)).toEqual(['baker@example.com']);
    expect(detail.pendingOwnerInvites).toHaveLength(0);
    expect((db.prepare("SELECT count(*) AS n FROM join_links WHERE org_id = ? AND scope_type = 'org'").get(r.body.orgId) as Json).n).toBe(1);
    expect((db.prepare("SELECT count(*) AS n FROM platform_audit WHERE action = 'business.created' AND org_id = ?").get(r.body.orgId) as Json).n).toBe(1);
    expect((await call('POST', '/v1/platform/businesses', tokens.root, { name: 'Again', slug: 'furnos-kifisias', ownerEmail: 'x@example.com' })).status).toBe(409);
  });

  it('invites, resends and revokes owners of an existing business', async () => {
    const inv = await call('POST', `/v1/platform/businesses/${s.orgId}/owner-invites`, tokens.root, { email: 'second.owner@example.com', locale: 'en' });
    expect(inv.status).toBe(201);
    const again = await call('POST', `/v1/platform/businesses/${s.orgId}/owner-invites/${inv.body.id}/resend`, tokens.root);
    expect(again.status).toBe(201);
    expect((await call('GET', `/v1/invites/${tokenOf(inv.body.link)}`)).status).toBe(410);
    expect((await call('GET', `/v1/invites/${tokenOf(again.body.link)}`)).status).toBe(200);
    expect((await call('DELETE', `/v1/platform/businesses/${s.orgId}/owner-invites/${again.body.id}`, tokens.root)).status).toBe(204);
    expect((await call('GET', `/v1/invites/${tokenOf(again.body.link)}`)).status).toBe(410);
    const actions = (db.prepare('SELECT action FROM platform_audit WHERE org_id = ?').all(s.orgId) as Json[]).map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['owner.invited', 'owner.invite_resent', 'owner.invite_revoked']));
  });

  it('sums every business in the overview', async () => {
    const o = (await call('GET', '/v1/platform/overview', tokens.root)).body;
    expect(o.businesses).toBeGreaterThanOrEqual(2);
    expect(o.shops).toBeGreaterThanOrEqual(4);
    expect(o.products).toBeGreaterThan(0);
    expect(o.customers).toBeGreaterThan(0);
    expect(o.sales14d[0].currency).toBe('EUR');
    expect(o.sales14d[0].minor).toBeGreaterThan(0);
    expect(o.storage.bytesFree).toBe(10_000_000_000);
    expect(o.storage.writesFree).toBe(1_000_000);
  });

  // ------------------------------------------------------------ controls

  it('lets owners read the controls but never change them', async () => {
    expect((await call('GET', `/v1/orgs/${s.orgId}/controls`, tokens.eleni)).body.status).toBe('active');
    expect((await call('PATCH', `/v1/platform/businesses/${s.orgId}/controls`, tokens.eleni, { disabledFeatures: [] })).status).toBe(403);
    expect((await call('PATCH', '/v1/platform/settings', tokens.eleni, { pause_push: false })).status).toBe(403);
  });

  it('enforces switched off features in the api', async () => {
    const r = await call('PATCH', `/v1/platform/businesses/${s.orgId}/controls`, tokens.root, { disabledFeatures: ['posts', 'reports', 'transfers', 'counts', 'uploads', 'customer_pages'] });
    expect(r.status).toBe(200);
    for (const path of ['posts', 'reports/sales', 'transfers', 'counts']) {
      const res = await call('GET', `/v1/orgs/${s.orgId}/${path}`, tokens.eleni);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('feature_off');
    }
    expect((await call('GET', `/v1/orgs/${s.orgId}/reports/dashboard`, tokens.eleni)).status).toBe(200);
    expect((await call('POST', `/v1/orgs/${s.orgId}/uploads/presign`, tokens.eleni, { purpose: 'product', mime: 'image/webp', bytes: 1000 })).body.code).toBe('feature_off');
    expect((await call('GET', '/v1/public/orgs/lemoni', undefined)).body.code).toBe('feature_off');
    expect((await call('GET', '/v1/public/join/kif7q2', undefined)).body.code).toBe('feature_off');
    const me = (await call('GET', '/v1/me/context', tokens.eleni)).body;
    expect(me.orgs[0].disabledFeatures).toEqual(expect.arrayContaining(['posts', 'reports']));
    const audit = db.prepare("SELECT details_json FROM platform_audit WHERE action = 'business.controls_changed' ORDER BY created_at DESC LIMIT 1").get() as Json;
    expect(JSON.parse(audit.details_json).after.disabledFeatures).toContain('posts');
  });

  it('pauses a business for its staff and its public pages, not for the super admin', async () => {
    await call('PATCH', `/v1/platform/businesses/${s.orgId}/controls`, tokens.root, { status: 'suspended' });
    const res = await call('GET', `/v1/orgs/${s.orgId}/products`, tokens.maria);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('org_suspended');
    expect((await call('GET', '/v1/me/context', tokens.maria)).body.orgs[0].suspended).toBe(true);
    expect((await call('GET', `/v1/orgs/${s.orgId}/products`, tokens.root)).status).toBe(200);
    expect((await call('GET', '/v1/public/orgs/lemoni', undefined)).body.code).toBe('org_suspended');
    expect(sendGate(db, 'email', s.orgId)).toBe('org_suspended');
  });

  it('applies the shop and staff limits', async () => {
    await call('PATCH', `/v1/platform/businesses/${s.orgId}/controls`, tokens.root, { maxShops: 3, maxStaff: 7 });
    const shop = await call('POST', `/v1/orgs/${s.orgId}/shops`, tokens.eleni, { name: 'Vouliagmeni' });
    expect(shop.status).toBe(403);
    expect(shop.body.code).toBe('limit_reached');
    const roles = (await call('GET', `/v1/orgs/${s.orgId}/roles`, tokens.eleni)).body as Json[];
    const staff = roles.find((r) => r.templateKey === 'staff' || r.name === 'Staff');
    const inv = await call('POST', `/v1/orgs/${s.orgId}/invites`, tokens.eleni, { email: 'one.more@example.com', roleId: staff.id, scopeType: 'shop', scopeId: s.shops.kifisia, locale: 'en' });
    expect(inv.status).toBe(403);
    expect(inv.body.code).toBe('limit_reached');
    // the apps get told, so the add buttons are not offered at all
    const org = (await call('GET', '/v1/me/context', tokens.eleni)).body.orgs[0];
    expect(org.shopsFull).toBe(true);
    expect(org.staffFull).toBe(true);
    await call('PATCH', `/v1/platform/businesses/${s.orgId}/controls`, tokens.root, { maxShops: null, maxStaff: null });
    const after = (await call('GET', '/v1/me/context', tokens.eleni)).body.orgs[0];
    expect(after.shopsFull).toBeUndefined();
    expect(after.staffFull).toBeUndefined();
    expect((await call('GET', `/v1/orgs/${s.orgId}/controls`, tokens.eleni)).body.maxShops).toBeNull();
  });

  // ------------------------------------------------------------ platform switches and sending

  it('pauses signups and staff invites platform wide', async () => {
    expect((await call('PATCH', '/v1/platform/settings', tokens.root, { pause_signups: true, pause_invites: true })).body.pause_signups).toBe(true);
    const join = await call('POST', '/v1/public/join/kif7q2', undefined, { email: 'paused@example.com', name: 'P', channels: { email: true } });
    expect(join.body.code).toBe('platform_paused');
    const roles = (await call('GET', `/v1/orgs/${s.orgId}/roles`, tokens.eleni)).body as Json[];
    const staff = roles.find((r) => r.templateKey === 'staff' || r.name === 'Staff');
    const inv = await call('POST', `/v1/orgs/${s.orgId}/invites`, tokens.eleni, { email: 'paused.staff@example.com', roleId: staff.id, scopeType: 'shop', scopeId: s.shops.kifisia, locale: 'en' });
    expect(inv.body.code).toBe('platform_paused');
    expect((await call('GET', '/v1/me/context', tokens.root)).body.platformPaused).toEqual(expect.arrayContaining(['pause_signups', 'pause_invites']));
    const audit = db.prepare("SELECT details_json FROM platform_audit WHERE action = 'platform.settings_changed' ORDER BY created_at DESC LIMIT 1").get() as Json;
    const d = JSON.parse(audit.details_json);
    expect(d.before.pause_signups).toBe(false);
    expect(d.after.pause_signups).toBe(true);
  });

  it('holds mail during a platform pause and drops it for a switched off channel', async () => {
    db.prepare('DELETE FROM dev_outbox').run();
    const t = devOutboxTransport(db, () => {});
    t.send({ channel: 'email', orgId: s.orgId, to: 'held@example.com', locale: 'en', title: 'Held', body: 'b' });
    const sent: string[] = [];
    const sender: LiveSender = { email: async (row) => void sent.push(row.to_address!) } as LiveSender;
    await call('PATCH', '/v1/platform/settings', tokens.root, { pause_email: true });
    await drainOutbox(db, sender, clock);
    expect(sent).toEqual([]);
    expect((db.prepare('SELECT sent_at, attempts FROM dev_outbox').get() as Json).attempts).toBe(0);
    await call('PATCH', '/v1/platform/settings', tokens.root, { pause_email: false });
    await call('PATCH', `/v1/platform/businesses/${s.orgId}/controls`, tokens.root, { disabledFeatures: ['email'] });
    await drainOutbox(db, sender, clock);
    expect(sent).toEqual([]);
    expect((db.prepare('SELECT last_error FROM dev_outbox').get() as Json).last_error).toBe('feature_off');
    await call('PATCH', `/v1/platform/businesses/${s.orgId}/controls`, tokens.root, { disabledFeatures: [] });
    t.send({ channel: 'email', orgId: s.orgId, to: 'goes@example.com', locale: 'en', title: 'Goes', body: 'b' });
    await drainOutbox(db, sender, clock);
    expect(sent).toEqual(['goes@example.com']);
  });

  // ------------------------------------------------------------ storage free tier

  it('stops uploads at 95% of the free tier unless switched off', async () => {
    const before = process.env.CUSTOCK_STORAGE_FREE_BYTES;
    process.env.CUSTOCK_STORAGE_FREE_BYTES = '10000';
    try {
      db.prepare(`INSERT INTO files (id, org_id, storage_key, purpose, is_public, mime, bytes, created_at) VALUES (?, ?, ?, 'product', 1, 'image/webp', 9000, ?)`)
        .run(uuidv7(clock), s.orgId, `orgs/${s.orgId}/products/meter.webp`, clock);
      const o = (await call('GET', '/v1/platform/overview', tokens.root)).body;
      expect(o.storage.bytesUsed).toBe(9000);
      expect(o.storage.percent).toBe(90);
      expect((await call('GET', '/v1/me/context', tokens.root)).body.storagePercent).toBe(90);
      const list = (await call('GET', '/v1/platform/businesses', tokens.root)).body as Json[];
      expect(list.find((b) => b.orgId === s.orgId).storageBytes).toBe(9000);
      const refused = await call('POST', `/v1/orgs/${s.orgId}/uploads/presign`, tokens.eleni, { purpose: 'product', mime: 'image/webp', bytes: 1000 });
      expect(refused.status).toBe(403);
      expect(refused.body.code).toBe('storage_full');
      await call('PATCH', '/v1/platform/settings', tokens.root, { uploads_stop_at_free: false });
      expect((await call('POST', `/v1/orgs/${s.orgId}/uploads/presign`, tokens.eleni, { purpose: 'product', mime: 'image/webp', bytes: 1000 })).status).toBe(201);
    } finally {
      if (before === undefined) delete process.env.CUSTOCK_STORAGE_FREE_BYTES;
      else process.env.CUSTOCK_STORAGE_FREE_BYTES = before;
      db.prepare("DELETE FROM files WHERE storage_key LIKE '%meter.webp'").run();
    }
  });

  // ------------------------------------------------------------ super admins

  it('invites super admins from the app, for new and existing accounts', async () => {
    const r = await call('POST', '/v1/platform/superadmin-invites', tokens.root, { email: 'second.root@example.com', locale: 'en' });
    expect(r.status).toBe(201);
    expect(r.body.link).toContain('/platform-invite/');
    const preview = (await call('GET', `/v1/platform-invites/${tokenOf(r.body.link)}`)).body;
    expect(preview.accountExists).toBe(false);
    expect(preview.invitedBy).toBe('Root');
    const reg = await call('POST', '/v1/platform-invites/register', undefined, { token: tokenOf(r.body.link), displayName: 'Second', password: 'a-long-password' });
    expect(reg.status).toBe(201);
    expect((await call('GET', '/v1/me/context', reg.body.accessToken)).body.platformRole).toBe('superadmin');
    expect((await call('GET', `/v1/platform-invites/${tokenOf(r.body.link)}`)).status).toBe(410);

    // an existing account: register refuses, the person signs in and accepts with the same email
    const ex = await call('POST', '/v1/platform/superadmin-invites', tokens.root, { email: 'sofia@example.com' });
    expect((await call('POST', '/v1/platform-invites/register', undefined, { token: tokenOf(ex.body.link), displayName: 'X', password: 'a-long-password' })).status).toBe(409);
    expect((await call('POST', '/v1/platform-invites/accept', tokens.maria, { token: tokenOf(ex.body.link) })).body.code).toBe('invite_email_mismatch');
    expect((await call('POST', '/v1/platform-invites/accept', tokens.sofia, { token: tokenOf(ex.body.link) })).status).toBe(204);
    expect((await call('GET', '/v1/me/context', tokens.sofia)).body.platformRole).toBe('superadmin');

    const list = (await call('GET', '/v1/platform/superadmins', tokens.root)).body;
    expect(list.admins.map((a: Json) => a.email)).toEqual(expect.arrayContaining(['root@example.com', 'second.root@example.com', 'sofia@example.com']));
    expect(list.admins.find((a: Json) => a.email === 'root@example.com').you).toBe(true);
    expect((await call('POST', '/v1/platform/superadmin-invites', tokens.root, { email: 'sofia@example.com' })).status).toBe(409);
  });

  it('resends, revokes and removes, never himself and never the last one', async () => {
    const r = await call('POST', '/v1/platform/superadmin-invites', tokens.root, { email: 'later@example.com' });
    const again = await call('POST', `/v1/platform/superadmin-invites/${r.body.id}/resend`, tokens.root);
    expect((await call('GET', `/v1/platform-invites/${tokenOf(r.body.link)}`)).status).toBe(410);
    expect((await call('DELETE', `/v1/platform/superadmin-invites/${again.body.id}`, tokens.root)).status).toBe(204);
    expect((await call('GET', `/v1/platform-invites/${tokenOf(again.body.link)}`)).status).toBe(410);

    expect((await call('DELETE', `/v1/platform/superadmins/${rootId}`, tokens.root)).body.code).toBe('self');
    const list = (await call('GET', '/v1/platform/superadmins', tokens.root)).body;
    for (const a of list.admins.filter((x: Json) => !x.you)) {
      expect((await call('DELETE', `/v1/platform/superadmins/${a.userId}`, tokens.root)).status).toBe(204);
    }
    expect((await call('GET', '/v1/me/context', tokens.sofia)).body.platformRole).toBeNull();
    // only root is left: the command line refuses to remove the last one too
    const out = io();
    await expect(runCli(db, ['remove-superadmin', '--email', 'root@example.com'], out)).rejects.toThrow(/last super admin/);
    const actions = (db.prepare("SELECT action FROM platform_audit WHERE action LIKE 'superadmin.%'").all() as Json[]).map((x) => x.action);
    expect(actions).toEqual(expect.arrayContaining(['superadmin.granted_cli', 'superadmin.invited', 'superadmin.invite_accepted', 'superadmin.invite_revoked', 'superadmin.removed']));
  });

  // ------------------------------------------------------------ command line

  it('deletes only an empty business from the command line', async () => {
    await expect(runCli(db, ['delete-business', '--slug', 'lemoni', '--confirm', 'lemoni'], io())).rejects.toThrow(/not empty/);
    await expect(runCli(db, ['delete-business', '--slug', 'lemoni'], io())).rejects.toThrow(/confirm/);
    const r = await call('POST', '/v1/platform/businesses', tokens.root, { name: 'Empty one', ownerEmail: 'empty@example.com' });
    const out = io();
    expect(await runCli(db, ['delete-business', '--slug', r.body.slug, '--confirm', r.body.slug], out)).toBe(0);
    expect(db.prepare('SELECT 1 FROM organizations WHERE id = ?').get(r.body.orgId)).toBeUndefined();
    expect((db.prepare('SELECT count(*) AS n FROM invites WHERE org_id = ?').get(r.body.orgId) as Json).n).toBe(0);
    expect((db.prepare("SELECT count(*) AS n FROM platform_audit WHERE action = 'business.deleted'").get() as Json).n).toBe(1);
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });
});

// ---------------------------------------------------------------- deleting a whole business

describe('deleting a business with everything in it', () => {
  let db: Db;
  let s: SeedResult;
  let app: App;
  const call = caller(() => app);
  let root = '';
  let otherOrg = '';

  const orgTables = (d: Db) => (d.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_fts%'").all() as Json[])
    .map((r) => r.name as string)
    .filter((n) => (d.prepare(`PRAGMA table_info("${n}")`).all() as Json[]).some((c) => c.name === 'org_id') && n !== 'platform_audit');
  const countsFor = (orgId: string) => Object.fromEntries(orgTables(db).map((n) => [n, (db.prepare(`SELECT count(*) AS n FROM "${n}" WHERE org_id = ?`).get(orgId) as Json).n]));

  beforeAll(async () => {
    db = openDb(':memory:');
    migrate(db);
    s = seed(db, { passwordHash: hashPassword('custock'), now: clock });
    app = createApp({ db, dev: true, jwtSecret: SECRET, publicWebUrl: WEB, corsOrigins: [], now: () => clock, rateLimit: false });
    const id = uuidv7(clock);
    db.prepare(`INSERT INTO users (id, email, display_name, password_hash, locale, platform_role, created_at, updated_at) VALUES (?, 'root@example.com', 'Root', ?, 'en', 'superadmin', ?, ?)`)
      .run(id, hashPassword('custock'), clock, clock);
    root = (await call('POST', '/v1/auth/login', undefined, { email: 'root@example.com', password: 'custock' })).body.accessToken;
    // a second business that must stay as it is, and sofia works there too
    otherOrg = createBusiness(db, { name: 'Other', slug: 'other', ownerEmail: 'other.owner@example.com', ownerName: 'Other Owner', passwordHash: hashPassword('custock'), shopName: 'Other shop', now: clock }).orgId;
    const sofia = (db.prepare("SELECT id FROM users WHERE email = 'sofia@example.com'").get() as Json).id;
    db.prepare("INSERT INTO memberships (id, org_id, user_id, status, perms_version, joined_at) VALUES (?, ?, ?, 'active', 1, ?)").run(uuidv7(clock), otherOrg, sofia, clock);
    // nikos is a super admin, his account stays even though Lemoni is his only business
    db.prepare("UPDATE users SET platform_role = 'superadmin' WHERE email = 'nikos@example.com'").run();
    db.prepare(`INSERT INTO files (id, org_id, storage_key, purpose, is_public, mime, bytes, created_at) VALUES (?, ?, ?, 'product', 1, 'image/webp', 1234, ?)`)
      .run(uuidv7(clock), s.orgId, `orgs/${s.orgId}/products/${uuidv7(clock)}.webp`, clock);
  });

  it('asks for the web address again and is for super admins only', async () => {
    const eleni = (await call('POST', '/v1/auth/login', undefined, { email: 'eleni@example.com', password: 'custock' })).body.accessToken;
    expect((await call('DELETE', `/v1/platform/businesses/${s.orgId}`, eleni, { confirm: 'lemoni' })).status).toBe(403);
    const wrong = await call('DELETE', `/v1/platform/businesses/${s.orgId}`, root, { confirm: 'lemon' });
    expect(wrong.status).toBe(400);
    expect(db.prepare('SELECT 1 FROM organizations WHERE id = ?').get(s.orgId)).toBeDefined();
  });

  it('leaves nothing of the business and touches nothing else', async () => {
    const before = countsFor(otherOrg);
    expect(Object.values(countsFor(s.orgId)).reduce((a, b) => a + (b as number), 0)).toBeGreaterThan(1000);
    const removed: string[] = [];
    const r = await deleteBusinessEverything(db, s.orgId, null, { removeObject: async (k) => void removed.push(k), now: clock });
    expect(r.slug).toBe('lemoni');
    expect(removed).toHaveLength(1);
    for (const [table, n] of Object.entries(countsFor(s.orgId))) expect([table, n]).toEqual([table, 0]);
    expect(db.prepare('SELECT 1 FROM organizations WHERE id = ?').get(s.orgId)).toBeUndefined();
    for (const [child, parent, col] of [['role_permissions', 'roles', 'role_id'], ['product_translations', 'products', 'product_id'], ['post_translations', 'posts', 'post_id'], ['category_translations', 'categories', 'category_id']]) {
      expect((db.prepare(`SELECT count(*) AS n FROM ${child} WHERE ${col} NOT IN (SELECT id FROM ${parent})`).get() as Json).n).toBe(0);
    }
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(countsFor(otherOrg)).toEqual(before);

    const user = (email: string) => db.prepare('SELECT deleted_at, email FROM users WHERE id = (SELECT id FROM users WHERE email = ? OR id IN (SELECT user_id FROM sessions WHERE 0))').get(email) as Json;
    // eleni and anna were only in Lemoni: their accounts are closed and emptied
    expect(user('eleni@example.com')).toBeUndefined();
    expect(user('anna@example.com')).toBeUndefined();
    expect((db.prepare('SELECT count(*) AS n FROM users WHERE deleted_at IS NOT NULL AND email IS NULL').get() as Json).n).toBe(r.accountsClosed);
    expect(r.accountsClosed).toBeGreaterThanOrEqual(2);
    // sofia works in the other business, nikos is a super admin, both stay
    expect(user('sofia@example.com').deleted_at).toBeNull();
    expect(user('nikos@example.com').deleted_at).toBeNull();
    expect((await call('POST', '/v1/auth/login', undefined, { email: 'eleni@example.com', password: 'custock' })).status).toBe(401);
    expect((await call('POST', '/v1/auth/login', undefined, { email: 'sofia@example.com', password: 'custock' })).status).toBe(200);

    const audit = db.prepare("SELECT org_id, details_json FROM platform_audit WHERE action = 'business.deleted'").all() as Json[];
    expect(audit).toHaveLength(1);
    expect(JSON.parse(audit[0].details_json).after.rows.stock_movements).toBeGreaterThan(0);
    // the ledger guard is back for everything else
    expect(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = 'stock_movements_no_delete'").get()).toBeDefined();
  });

  it('deletes from the command line with --everything', async () => {
    const r = await call('POST', '/v1/platform/businesses', root, { name: 'Throwaway', ownerEmail: 'throw@example.com' });
    expect(r.status).toBe(201);
    const out = io();
    expect(await runCli(db, ['delete-business', '--slug', r.body.slug, '--confirm', r.body.slug, '--everything'], out)).toBe(0);
    expect(db.prepare('SELECT 1 FROM organizations WHERE id = ?').get(r.body.orgId)).toBeUndefined();
    expect(Object.values(countsFor(r.body.orgId)).every((n) => n === 0)).toBe(true);
  });
});
