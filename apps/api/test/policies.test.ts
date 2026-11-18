// the policy engine: one registry of limits and options, values at platform, business ceiling,
// business, shop, role and person, always held inside the levels above, and the authority rules:
// only someone above changes a role or a person, nobody changes their own role or themselves
// (apart from personal preferences), nobody hands out more than they have, and the super admin
// binds owners. nothing is ever sent.

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hashPassword, migrate, openDb, seed, type Db, type SeedResult } from '@custock/db';
import { cap, POLICIES, resolvePolicy, uuidv7, windowContains, within, policyDef, type MovementInput } from '@custock/core';
import { createApp, type App } from '../src/app';
import { runCli, type CliIo } from '../src/cli';
import { notifyMembers } from '../src/lib/notify';
import { platformPolicy, policyIn } from '../src/lib/policy';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const SECRET = 'policies-test-secret-long-enough-1234';
const clock = Date.now();
const WEB = 'http://localhost:3000/custock';

function io(): CliIo & { lines: string[] } {
  const lines: string[] = [];
  return { env: {}, readStdin: async () => '', out: (l) => lines.push(l), lines };
}

describe('policy engine', () => {
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
  const q = <T = Json>(sql: string, ...p: unknown[]) => db.prepare(sql).get(...p) as T;
  const membership = (who: string) => q<{ id: string }>('SELECT id FROM memberships WHERE org_id = ? AND user_id = ?', s.orgId, s.users[who]).id;
  const role = (key: string) => q<{ id: string }>('SELECT id FROM roles WHERE org_id = ? AND template_key = ?', s.orgId, key).id;
  const entry = (list: Json[], key: string) => list.find((e: Json) => e.key === key);

  async function login(who: string) {
    const r = await call('POST', '/v1/auth/login', undefined, { email: `${who}@example.com`, password: 'custock' });
    expect(r.status).toBe(200);
    tokens[who] = r.body.accessToken;
  }

  beforeAll(async () => {
    db = openDb(':memory:');
    migrate(db);
    s = seed(db, { passwordHash: hashPassword('custock'), now: clock });
    app = createApp({ db, dev: true, jwtSecret: SECRET, publicWebUrl: WEB, corsOrigins: [], now: () => clock, rateLimit: false });
    db.prepare(`INSERT INTO users (id, email, display_name, password_hash, locale, created_at, updated_at) VALUES (?, 'root@example.com', 'Root', ?, 'en', ?, ?)`)
      .run(uuidv7(clock), hashPassword('custock'), clock, clock);
    expect(await runCli(db, ['make-superadmin', '--email', 'root@example.com'], io())).toBe(0);
    for (const who of ['eleni', 'nikos', 'maria', 'giorgos', 'dimitris', 'katerina', 'sofia', 'anna', 'root']) await login(who);
  });

  beforeEach(() => {
    db.prepare('DELETE FROM policy_values').run();
    db.prepare("UPDATE organizations SET push_daily_cap = 2, quiet_hours = '22:00-09:00', posts_need_approval = 0").run();
  });

  // ------------------------------------------------------------ the registry

  it('keeps every default exactly as the app behaved before', () => {
    const want: Record<string, unknown> = {
      'push.dailyCap': 2, 'push.quietHours': '22:00-09:00', 'posts.needApproval': false, 'posts.dailyLimit': 0, 'stock.allowNegative': true,
      'stock.fewLeft': 3, 'stock.adjustLimit': 0, 'catalog.mode': 'subscribers', 'catalog.prices': true, 'catalog.stock': 'off',
      'auth.accessMinutes': 15, 'auth.sessionDays': 30, 'auth.loginAttempts': 5, 'auth.lockMinutes': 15, 'auth.otpMinutes': 10, 'auth.resetMinutes': 30,
      'rate.publicPerMinute': 120, 'rate.authPerMinute': 20, 'invites.staffDays': 7, 'invites.ownerDays': 14, 'invites.superAdminDays': 7,
      'join.confirmDays': 7, 'email.changeCodeMinutes': 15, 'uploads.maxMegabytes': 5, 'retention.outboxDays': 30, 'retention.errorDays': 30, 'retention.unconfirmedDays': 30,
    };
    for (const [k, v] of Object.entries(want)) expect(platformPolicy(db, k)).toBe(v);
    for (const p of POLICIES) {
      expect(p.levels).toContain('platform');
      if (p.type === 'int') expect(p.default as number).toBeGreaterThanOrEqual(p.min ?? 0);
      if (p.selfService) expect(p.levels).toContain('user');
    }
  });

  it('holds narrower values inside wider ones', () => {
    const capDef = policyDef('push.dailyCap')!;
    expect(cap(capDef, 4, 2)).toBe(2);
    expect(resolvePolicy(capDef, { platform: 2, limit: 1, business: 2 })).toBe(1);
    expect(resolvePolicy(capDef, { platform: 2, limit: 4, business: null })).toBe(2);
    const none = policyDef('stock.adjustLimit')!;
    expect(resolvePolicy(none, { platform: 0, business: 0, roles: [10], user: 0 })).toBe(10);
    expect(resolvePolicy(none, { platform: 0, business: 20, roles: [50] })).toBe(20);
    expect(within(none, 0, 20)).toBe(false);
    const appr = policyDef('posts.needApproval')!;
    expect(resolvePolicy(appr, { platform: false, business: true, roles: [false] })).toBe(true);
    expect(resolvePolicy(appr, { platform: false, business: false, roles: [true] })).toBe(true);
    expect(windowContains('21:00-09:30', '22:00-09:00')).toBe(true);
    expect(windowContains('23:00-08:00', '22:00-09:00')).toBe(false);
  });

  // ------------------------------------------------------------ super admin

  it('gives the platform values and business ceilings to super admins only', async () => {
    for (const who of ['eleni', 'nikos', 'maria', 'anna']) {
      expect((await call('GET', '/v1/platform/policies', who)).status).toBe(403);
      expect((await call('PATCH', '/v1/platform/policies', who, { 'auth.accessMinutes': 30 })).status).toBe(403);
      expect((await call('PATCH', `/v1/platform/businesses/${s.orgId}/policies`, who, { 'push.dailyCap': { limit: 5 } })).status).toBe(403);
    }
    expect((await call('GET', '/v1/platform/policies')).status).toBe(401);
    expect((await call('GET', '/v1/platform/policies', 'root')).status).toBe(200);
  });

  it('keeps safety values above their minimums', async () => {
    expect((await call('PATCH', '/v1/platform/policies', 'root', { 'rate.authPerMinute': 0 })).status).toBe(422);
    expect((await call('PATCH', '/v1/platform/policies', 'root', { 'auth.loginAttempts': 100 })).status).toBe(422);
    const r = await call('PATCH', '/v1/platform/policies', 'root', { 'auth.accessMinutes': 10 });
    expect(r.status).toBe(200);
    const t = await call('POST', '/v1/auth/login', undefined, { email: 'sofia@example.com', password: 'custock' });
    expect(t.body.expiresAt).toBe(clock + 10 * 60_000);
    expect(q<{ n: number }>("SELECT count(*) AS n FROM platform_audit WHERE action = 'policies.platform_changed'").n).toBeGreaterThan(0);
    await call('PATCH', '/v1/platform/policies', 'root', { 'auth.accessMinutes': null });
    expect(platformPolicy(db, 'auth.accessMinutes')).toBe(15);
  });

  it('binds owners to the ceiling and writes the business value back inside it', async () => {
    expect((await call('PATCH', `/v1/platform/businesses/${s.orgId}/policies`, 'root', { 'push.dailyCap': { limit: 1 } })).status).toBe(200);
    expect(q<{ c: number }>('SELECT push_daily_cap AS c FROM organizations WHERE id = ?', s.orgId).c).toBe(1);
    const over = await call('PATCH', `${org()}/policies`, 'eleni', { 'push.dailyCap': 2 });
    expect(over.status).toBe(422);
    expect(over.body.code).toBe('limit_reached');
    // the older settings route goes through the same rules
    expect((await call('PATCH', org(), 'eleni', { pushDailyCap: 2 })).status).toBe(422);
    expect((await call('PATCH', `${org()}/policies`, 'eleni', { 'push.dailyCap': 0 })).status).toBe(200);
    expect(policyIn(db, s.orgId, 'push.dailyCap')).toBe(0);
    // a stricter "always need approval" forces the business value
    await call('PATCH', `/v1/platform/businesses/${s.orgId}/policies`, 'root', { 'posts.needApproval': { limit: true } });
    expect(q<{ v: number }>('SELECT posts_need_approval AS v FROM organizations WHERE id = ?', s.orgId).v).toBe(1);
    expect((await call('PATCH', org(), 'eleni', { postsNeedApproval: false })).status).toBe(422);
    expect(q<{ n: number }>("SELECT count(*) AS n FROM platform_audit WHERE action = 'policies.business_controls_changed' AND org_id = ?", s.orgId).n).toBeGreaterThan(0);
  });

  it('only lets owners change a key the super admin left open', async () => {
    await call('PATCH', `/v1/platform/businesses/${s.orgId}/policies`, 'root', { 'push.dailyCap': { delegated: false } });
    const r = await call('GET', `${org()}/policies`, 'eleni');
    expect(entry(r.body.entries, 'push.dailyCap').editable).toBe(false);
    expect((await call('PATCH', `${org()}/policies`, 'eleni', { 'push.dailyCap': 1 })).status).toBe(403);
    expect((await call('PATCH', org(), 'eleni', { pushDailyCap: 1 })).status).toBe(403);
    // the super admin himself still can
    expect((await call('PATCH', `${org()}/policies`, 'root', { 'push.dailyCap': 1 })).status).toBe(200);
  });

  // ------------------------------------------------------------ business

  it('asks for the push limits permission, given to owners and admins and delegable through roles', async () => {
    expect((await call('PATCH', `${org()}/policies`, 'eleni', { 'push.dailyCap': 1 })).status).toBe(200);
    expect((await call('PATCH', `${org()}/policies`, 'nikos', { 'push.quietHours': '21:00-09:30' })).status).toBe(200);
    expect((await call('PATCH', `${org()}/policies`, 'maria', { 'push.dailyCap': 1 })).status).toBe(403);
    expect((await call('PATCH', `${org()}/policies`, 'dimitris', { 'push.dailyCap': 1 })).status).toBe(403);
    // without the permission on the admin role, admins lose it
    db.prepare("DELETE FROM role_permissions WHERE role_id = ? AND permission = 'settings.push'").run(role('admin'));
    expect((await call('PATCH', `${org()}/policies`, 'nikos', { 'push.dailyCap': 1 })).status).toBe(403);
    db.prepare("INSERT INTO role_permissions (role_id, permission) VALUES (?, 'settings.push')").run(role('admin'));
    // a customer is not in the business at all
    expect((await call('GET', `${org()}/policies`, 'anna')).status).toBe(404);
  });

  it('lets quiet hours only grow past the super admin window', async () => {
    expect((await call('PATCH', `${org()}/policies`, 'eleni', { 'push.quietHours': '21:00-09:30' })).status).toBe(200);
    expect(q<{ w: string }>('SELECT quiet_hours AS w FROM organizations WHERE id = ?', s.orgId).w).toBe('21:00-09:30');
    const short = await call('PATCH', `${org()}/policies`, 'eleni', { 'push.quietHours': '23:00-08:00' });
    expect(short.status).toBe(422);
    expect((await call('PATCH', `${org()}/policies`, 'eleni', { 'push.quietHours': 'later' })).status).toBe(422);
    expect(q<{ n: number }>("SELECT count(*) AS n FROM audit_log WHERE org_id = ? AND action = 'policies.business_changed'", s.orgId).n).toBeGreaterThan(0);
  });

  // ------------------------------------------------------------ roles

  it('lets only people above a role change it, never their own role', async () => {
    const mgr = role('manager');
    expect((await call('PATCH', `${org()}/roles/${mgr}/policies`, 'eleni', { 'posts.dailyLimit': 3 })).status).toBe(200);
    expect((await call('PATCH', `${org()}/roles/${mgr}/policies`, 'nikos', { 'posts.dailyLimit': 4 })).status).toBe(200);
    // a manager has no say over roles, not even their own
    expect((await call('PATCH', `${org()}/roles/${mgr}/policies`, 'maria', { 'posts.dailyLimit': 50 })).status).toBe(403);
    // an admin cannot touch the admin role, nobody touches the owner role
    expect((await call('PATCH', `${org()}/roles/${role('admin')}/policies`, 'nikos', { 'posts.dailyLimit': 50 })).status).toBe(403);
    expect((await call('PATCH', `${org()}/roles/${role('owner')}/policies`, 'eleni', { 'posts.dailyLimit': 50 })).status).toBe(403);
    // the super admin binds owners
    expect((await call('PATCH', `${org()}/roles/${role('owner')}/policies`, 'root', { 'posts.dailyLimit': 50 })).status).toBe(200);
    await call('PATCH', `${org()}/roles/${role('owner')}/policies`, 'root', { 'posts.dailyLimit': null });
    const view = await call('GET', `${org()}/roles/${mgr}/policies`, 'eleni');
    expect(entry(view.body.entries, 'posts.dailyLimit').value).toBe(4);
    expect((await call('GET', `${org()}/roles/${mgr}/policies`, 'maria')).status).toBe(403);
  });

  it('never lets anyone give more than they have', async () => {
    // the owner holds admins to 10, an admin cannot give managers more than that
    expect((await call('PATCH', `${org()}/roles/${role('admin')}/policies`, 'eleni', { 'stock.adjustLimit': 10 })).status).toBe(200);
    const more = await call('PATCH', `${org()}/roles/${role('manager')}/policies`, 'nikos', { 'stock.adjustLimit': 20 });
    expect(more.status).toBe(403);
    expect(more.body.code).toBe('ceiling');
    expect((await call('PATCH', `${org()}/roles/${role('manager')}/policies`, 'nikos', { 'stock.adjustLimit': 0 })).status).toBe(403);
    expect((await call('PATCH', `${org()}/roles/${role('manager')}/policies`, 'nikos', { 'stock.adjustLimit': 5 })).status).toBe(200);
    expect((await call('PATCH', `${org()}/members/${membership('maria')}/policies`, 'nikos', { 'stock.adjustLimit': 8 })).status).toBe(422);
    // a business value never goes past what the role above allows: the owner sets the business to 3
    expect((await call('PATCH', `${org()}/policies`, 'eleni', { 'stock.adjustLimit': 3 })).status).toBe(200);
    expect(policyIn(db, s.orgId, 'stock.adjustLimit', { userId: s.users.maria })).toBe(3);
  });

  // ------------------------------------------------------------ people

  it('lets managers set people below them inside their own shops only', async () => {
    expect((await call('PATCH', `${org()}/members/${membership('dimitris')}/policies`, 'maria', { 'posts.needApproval': true })).status).toBe(200);
    expect((await call('PATCH', `${org()}/members/${membership('katerina')}/policies`, 'maria', { 'posts.needApproval': true })).status).toBe(403);
    expect((await call('PATCH', `${org()}/members/${membership('giorgos')}/policies`, 'maria', { 'posts.needApproval': true })).status).toBe(403);
    expect((await call('PATCH', `${org()}/members/${membership('nikos')}/policies`, 'maria', { 'posts.needApproval': true })).status).toBe(403);
    expect((await call('PATCH', `${org()}/members/${membership('eleni')}/policies`, 'nikos', { 'posts.dailyLimit': 1 })).status).toBe(403);
    // a peer at the same rank
    expect((await call('PATCH', `${org()}/members/${membership('maria')}/policies`, 'giorgos', { 'posts.dailyLimit': 1 })).status).toBe(403);
  });

  it('lets people change only their own preferences, nothing that gives power', async () => {
    const self = await call('PATCH', `${org()}/members/${membership('maria')}/policies`, 'maria', { 'posts.dailyLimit': 0 });
    expect(self.status).toBe(403);
    expect(self.body.code).toBe('self');
    expect((await call('PATCH', `${org()}/me/policies`, 'maria', { 'stock.adjustLimit': 0 })).status).toBe(403);
    expect((await call('PATCH', `${org()}/me/policies`, 'maria', { 'posts.needApproval': false })).status).toBe(403);
    const mine = await call('PATCH', `${org()}/me/policies`, 'maria', { 'alerts.lowStock': false });
    expect(mine.status).toBe(200);
    expect(entry(mine.body.entries, 'alerts.lowStock').effective).toBe(false);
    expect((await call('GET', `${org()}/me/policies`, 'maria')).body.entries.every((e: Json) => policyDef(e.key)!.selfService)).toBe(true);
  });

  // ------------------------------------------------------------ what they do

  it('holds a role or a person to approval for posts', async () => {
    const perms = async (who: string, shop = s.shops.kifisia) => {
      const me = (await call('GET', '/v1/me/context', who)).body.orgs.find((o: Json) => o.orgId === s.orgId);
      return me.shops.find((sh: Json) => sh.shopId === shop).perms as string[];
    };
    expect(await perms('maria')).toContain('posts.publish');
    await call('PATCH', `${org()}/roles/${role('manager')}/policies`, 'eleni', { 'posts.needApproval': true });
    expect(await perms('maria')).not.toContain('posts.publish');
    await call('PATCH', `${org()}/roles/${role('manager')}/policies`, 'eleni', { 'posts.needApproval': null });
    await call('PATCH', `${org()}/members/${membership('maria')}/policies`, 'eleni', { 'posts.needApproval': true });
    expect(await perms('maria')).not.toContain('posts.publish');
    expect(await perms('giorgos', s.shops.glyfada)).toContain('posts.publish');
  });

  it('refuses a correction bigger than the limit of the person at that shop', async () => {
    await call('PATCH', `${org()}/members/${membership('maria')}/policies`, 'eleni', { 'stock.adjustLimit': 2 });
    const m = (qty: number): MovementInput => ({ id: uuidv7(), shopId: s.shops.kifisia, variantId: s.variants['p-tahini']!, qtyDelta: qty, kind: 'adjust', reason: 'correction', occurredAt: clock });
    const big = m(-5);
    const small = m(-1);
    const r = await call('POST', `${org()}/movements`, 'maria', { movements: [big, small] });
    expect(r.body.accepted).toEqual([small.id]);
    expect(r.body.rejected.find((x: Json) => x.id === big.id).code).toBe('limit_reached');
    // a shop value holds everyone there
    await call('PATCH', `${org()}/members/${membership('maria')}/policies`, 'eleni', { 'stock.adjustLimit': null });
    expect((await call('PATCH', `${org()}/shops/${s.shops.kifisia}/policies`, 'maria', { 'stock.adjustLimit': 3 })).status).toBe(200);
    expect(policyIn(db, s.orgId, 'stock.adjustLimit', { userId: s.users.maria, shopId: s.shops.kifisia })).toBe(3);
    expect((await call('PATCH', `${org()}/shops/${s.shops.marousi}/policies`, 'maria', { 'stock.adjustLimit': 3 })).status).toBe(403);
  });

  it('stops a person at their daily posts', async () => {
    await call('PATCH', `${org()}/members/${membership('eleni')}/policies`, 'root', { 'posts.dailyLimit': 1 });
    db.prepare(`INSERT INTO audit_log (id, org_id, actor_id, actor_kind, action, entity_type, entity_id, created_at) VALUES (?, ?, ?, 'member', 'post.published', 'post', 'x', ?)`)
      .run(uuidv7(clock), s.orgId, s.users.eleni, clock - 1000);
    const r = await call('POST', `${org()}/posts/${s.posts.draft}/publish`, 'eleni');
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('limit_reached');
  });

  it('leaves out staff alerts a person turned off', async () => {
    const count = () => q<{ n: number }>("SELECT count(*) AS n FROM dev_outbox WHERE channel = 'push' AND user_id = ? AND payload LIKE '%lowStock%'", s.users.maria).n;
    const send = () => notifyMembers(db, s.orgId, { perm: 'stock.settings.manage', shopId: s.shops.kifisia, key: 'lowStock', params: () => ({ name: 'x', count: 1, shop: 'Kifisia' }) });
    const before = count();
    send();
    expect(count()).toBe(before + 1);
    await call('PATCH', `${org()}/me/policies`, 'maria', { 'alerts.lowStock': false });
    send();
    expect(count()).toBe(before + 1);
  });

  it('starts a new business from the platform values', async () => {
    await call('PATCH', '/v1/platform/policies', 'root', { 'catalog.mode': 'public', 'push.dailyCap': 1 });
    const r = await call('POST', '/v1/platform/businesses', 'root', { name: 'Policy Shop', slug: 'policy-shop', ownerEmail: 'policy-owner@example.com', locale: 'en' });
    expect(r.status).toBeLessThan(300);
    const row = q<{ c: string; p: number }>("SELECT customer_catalog AS c, push_daily_cap AS p FROM organizations WHERE slug = 'policy-shop'");
    expect(row).toEqual({ c: 'public', p: 1 });
    // and every business is held to a stricter platform value at once
    expect(q<{ p: number }>('SELECT push_daily_cap AS p FROM organizations WHERE id = ?', s.orgId).p).toBe(1);
  });
});
