// team and org writes with the delegation rules from thinking/02: invites, assignments, member
// status, roles, org settings, shop details, the audit log

import type { Context, Hono } from 'hono';
import { z } from 'zod';
import {
  canEditRole, canGrantRole, canManageMember, checkOwnersAfter, effectiveAtScope, InviteInput, isPermission, uuidv7,
  type AccessAssignment, type AuditEntry, type Invite, type OrgSettings,
} from '@custock/core';
import { randomToken, sha256 } from '@custock/db';
import { pickLocale, translator } from '@custock/i18n';
import type { AppEnv } from '../types';
import { audit, bumpPerms } from '../lib/audit';
import { cfgOf, need, nowOf, orgOf, requireAuth, ORG_COLUMNS } from '../lib/context';
import { idempotent } from '../lib/idempotency';
import { permsChanged } from '../lib/notify';
import { ApiProblem, badRequest, forbidden, notFound } from '../lib/problem';
import { clampLimit, decodeCursor, page, parseJson, platform, Tenant } from '../lib/tenant';
import { devOutboxTransport } from '../lib/transport';
import { loadRoles } from './team';
import { loadShops, orgSettings } from './org';

const INVITE_TTL = 7 * 86_400_000;

function actorOf(c: Context<AppEnv>) {
  return { userId: c.get('user').id, assignments: orgOf(c).assignments };
}

function roleById(c: Context<AppEnv>, roleId: string) {
  const role = loadRoles(orgOf(c).t).find((r) => r.id === roleId);
  if (!role) throw notFound('role');
  return { ...role, locked: !!role.is_locked };
}

function scopeKnown(c: Context<AppEnv>, scopeType: string, scopeId: string) {
  const { topology, org } = orgOf(c);
  const ok = scopeType === 'org' ? scopeId === org.id : scopeType === 'group' ? scopeId in topology.groups : topology.shops.includes(scopeId);
  if (!ok) throw notFound('scope');
}

function memberAssignments(c: Context<AppEnv>, membershipId: string): { userId: string; status: string; assignments: (AccessAssignment & { id: string; templateKey: string | null })[] } {
  const { t } = orgOf(c);
  const m = t.get<{ user_id: string; status: string }>('SELECT user_id, status FROM memberships WHERE org_id = @org AND id = @id', { id: membershipId });
  if (!m) throw notFound('member');
  const roles = new Map(loadRoles(t).map((r) => [r.id, r]));
  const rows = t.all<{ id: string; role_id: string; scope_type: 'org' | 'group' | 'shop'; scope_id: string }>(
    'SELECT id, role_id, scope_type, scope_id FROM role_assignments WHERE org_id = @org AND membership_id = @m',
    { m: membershipId },
  );
  return {
    userId: m.user_id,
    status: m.status,
    assignments: rows.map((r) => ({
      id: r.id, roleId: r.role_id, rank: roles.get(r.role_id)?.rank ?? 0, permissions: roles.get(r.role_id)?.permissions ?? [],
      scopeType: r.scope_type, scopeId: r.scope_id, templateKey: roles.get(r.role_id)?.template_key ?? null,
    })),
  };
}

function ownerUserIds(c: Context<AppEnv>, exceptAssignment?: string, exceptMembership?: string): string[] {
  return orgOf(c)
    .t.all<{ user_id: string }>(
      `SELECT DISTINCT m.user_id FROM role_assignments a JOIN roles r ON r.id = a.role_id JOIN memberships m ON m.id = a.membership_id
        WHERE a.org_id = @org AND r.template_key = 'owner' AND m.status = 'active' AND a.scope_type = 'org'
          AND (@a IS NULL OR a.id != @a) AND (@m IS NULL OR m.id != @m)`,
      { a: exceptAssignment ?? null, m: exceptMembership ?? null },
    )
    .map((r) => r.user_id);
}

function refuse(code: Parameters<typeof forbidden>[1]) {
  if (code === 'last_owner') return new ApiProblem(409, 'last_owner');
  return forbidden(undefined, code);
}

export function teamWriteRoutes(app: Hono<AppEnv>) {
  // ------------------------------------------------------------ invites

  app.get('/v1/orgs/:org/invites', (c) => {
    need(c, 'members.invite');
    const { t, assignments, topology } = orgOf(c);
    const rows = t.all<{ id: string; email: string; role_id: string; role_name: string; scope_type: 'org' | 'group' | 'shop'; scope_id: string; invited_by: string; created_at: number; expires_at: number }>(
      `SELECT i.id, i.email, i.role_id, r.name AS role_name, i.scope_type, i.scope_id, i.invited_by, i.created_at, i.expires_at
         FROM invites i JOIN roles r ON r.id = i.role_id
        WHERE i.org_id = @org AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > @now ORDER BY i.created_at DESC`,
      { now: nowOf(c) },
    );
    const items: Invite[] = rows
      .filter((r) => effectiveAtScope(assignments, topology, { scopeType: r.scope_type, scopeId: r.scope_id }).perms.has('members.invite'))
      .map((r) => ({ id: r.id, email: r.email, roleId: r.role_id, roleName: r.role_name, scopeType: r.scope_type, scopeId: r.scope_id, invitedBy: r.invited_by, createdAt: r.created_at, expiresAt: r.expires_at }));
    return c.json(items);
  });

  app.post('/v1/orgs/:org/invites', async (c) => {
    const input = InviteInput.parse(await c.req.json());
    scopeKnown(c, input.scopeType, input.scopeId);
    const role = roleById(c, input.roleId);
    const check = canGrantRole({ actor: actorOf(c), topology: orgOf(c).topology, role, scope: input, via: 'members.invite' });
    if (!check.ok) throw refuse(check.code);
    return idempotent(c, () => {
      const { t, org, shopNames, groupNames } = orgOf(c);
      const now = nowOf(c);
      const token = randomToken();
      const id = uuidv7(now);
      const email = input.email.trim().toLowerCase();
      t.run(
        `INSERT INTO invites (id, org_id, email, role_id, scope_type, scope_id, token_hash, locale, invited_by, created_at, expires_at)
         VALUES (@id, @org, @email, @role, @st, @sid, @hash, @locale, @u, @now, @exp)`,
        { id, email, role: role.id, st: input.scopeType, sid: input.scopeId, hash: sha256(token), locale: input.locale, u: c.get('user').id, now, exp: now + INVITE_TTL },
      );
      const url = `${cfgOf(c).publicWebUrl.replace(/\/$/, '')}/invite/${token}`;
      const tr = translator(pickLocale(input.locale), 'server');
      const commonRole = translator(pickLocale(input.locale), 'common');
      const scopeName = input.scopeType === 'org' ? org.name : input.scopeType === 'group' ? groupNames[input.scopeId] ?? '' : shopNames[input.scopeId] ?? '';
      const roleLabel = role.template_key ? commonRole(`role.${role.template_key}`) : role.name;
      const params = { inviter: c.get('user').displayName ?? '', org: org.name, role: roleLabel, scope: scopeName, url };
      devOutboxTransport(cfgOf(c).db).send({ channel: 'email', orgId: org.id, to: email, locale: input.locale, title: tr('email.invite.subject', params), body: tr('email.invite.body', params), payload: { type: 'invite', inviteId: id } });
      audit(t, { id: c.get('user').id }, 'invite.sent', { type: 'invite', id }, null, { email, roleId: role.id, scopeType: input.scopeType, scopeId: input.scopeId }, now);
      return { status: 201, body: cfgOf(c).dev ? { id, devLink: url } : { id } };
    });
  });

  app.post('/v1/orgs/:org/invites/:id/revoke', (c) => {
    need(c, 'members.invite');
    const { t } = orgOf(c);
    const res = t.run('UPDATE invites SET revoked_at = @now WHERE org_id = @org AND id = @id AND accepted_at IS NULL AND revoked_at IS NULL', { now: nowOf(c), id: c.req.param('id') });
    if (!res.changes) throw notFound('invite');
    audit(t, { id: c.get('user').id }, 'invite.revoked', { type: 'invite', id: c.req.param('id') }, null, null, nowOf(c));
    return c.body(null, 204);
  });

  // the invited person, signed in with the invited email
  app.post('/v1/invites/accept', requireAuth, async (c) => {
    const { token } = z.object({ token: z.string().min(10) }).parse(await c.req.json());
    const db = cfgOf(c).db;
    const now = nowOf(c);
    const inv = platform(db).get<{ id: string; org_id: string; email: string; role_id: string; scope_type: string; scope_id: string; expires_at: number; accepted_at: number | null; revoked_at: number | null; invited_by: string }>(
      'SELECT id, org_id, email, role_id, scope_type, scope_id, expires_at, accepted_at, revoked_at, invited_by FROM invites WHERE token_hash = @h',
      { h: sha256(token) },
    );
    if (!inv || inv.revoked_at || inv.accepted_at || inv.expires_at < now) throw new ApiProblem(410, 'invite_expired');
    const user = c.get('user');
    if ((user.email ?? '').toLowerCase() !== inv.email) throw forbidden('different email', 'invite_email_mismatch');
    const t = new Tenant(db, inv.org_id);
    db.transaction(() => {
      let m = t.get<{ id: string; status: string }>('SELECT id, status FROM memberships WHERE org_id = @org AND user_id = @u', { u: user.id });
      if (!m) {
        m = { id: uuidv7(now), status: 'active' };
        t.run("INSERT INTO memberships (id, org_id, user_id, status, perms_version, joined_at) VALUES (@id, @org, @u, 'active', 1, @now)", { id: m.id, u: user.id, now });
      } else if (m.status !== 'active') {
        t.run("UPDATE memberships SET status = 'active', removed_at = NULL WHERE org_id = @org AND id = @id", { id: m.id });
      }
      t.run(
        `INSERT OR IGNORE INTO role_assignments (id, org_id, membership_id, role_id, scope_type, scope_id, granted_by, created_at)
         VALUES (@id, @org, @m, @r, @st, @sid, @by, @now)`,
        { id: uuidv7(now), m: m.id, r: inv.role_id, st: inv.scope_type, sid: inv.scope_id, by: inv.invited_by, now },
      );
      bumpPerms(t, [m.id]);
      t.run('UPDATE invites SET accepted_at = @now, accepted_by = @u WHERE id = @id AND org_id = @org', { now, u: user.id, id: inv.id });
      audit(t, { id: user.id }, 'invite.accepted', { type: 'invite', id: inv.id }, null, null, now);
    })();
    const orgName = t.get<{ name: string }>('SELECT name FROM organizations WHERE id = @org')!.name;
    const transport = devOutboxTransport(db, () => {});
    const inviter = platform(db).get<{ locale: string }>('SELECT locale FROM users WHERE id = @id', { id: inv.invited_by });
    const tr = translator(pickLocale(inviter?.locale), 'server');
    const params = { name: user.displayName ?? user.email ?? '', org: orgName };
    transport.send({ channel: 'push', orgId: inv.org_id, userId: inv.invited_by, locale: inviter?.locale ?? 'el', title: tr('push.inviteAccepted.title', params), body: tr('push.inviteAccepted.body', params), payload: { type: 'inviteAccepted' } });
    return c.json({ orgId: inv.org_id });
  });

  // ------------------------------------------------------------ assignments and members

  app.post('/v1/orgs/:org/members/:m/assignments', async (c) => {
    const input = z.object({ roleId: z.string(), scopeType: z.enum(['org', 'group', 'shop']), scopeId: z.string() }).parse(await c.req.json());
    scopeKnown(c, input.scopeType, input.scopeId);
    const target = memberAssignments(c, c.req.param('m'));
    const role = roleById(c, input.roleId);
    const check = canGrantRole({ actor: actorOf(c), topology: orgOf(c).topology, role, scope: input, targetUserId: target.userId, via: 'members.manage' });
    if (!check.ok) throw refuse(check.code);
    const { t, org } = orgOf(c);
    const now = nowOf(c);
    cfgOf(c).db.transaction(() => {
      t.run(
        `INSERT OR IGNORE INTO role_assignments (id, org_id, membership_id, role_id, scope_type, scope_id, granted_by, created_at)
         VALUES (@id, @org, @m, @r, @st, @sid, @u, @now)`,
        { id: uuidv7(now), m: c.req.param('m'), r: role.id, st: input.scopeType, sid: input.scopeId, u: c.get('user').id, now },
      );
      bumpPerms(t, [c.req.param('m')]);
      audit(t, { id: c.get('user').id }, 'role.assigned', { type: 'membership', id: c.req.param('m') }, null, input, now);
    })();
    permsChanged(cfgOf(c).db, org.id, target.userId);
    return c.body(null, 204);
  });

  app.delete('/v1/orgs/:org/members/:m/assignments/:a', (c) => {
    const target = memberAssignments(c, c.req.param('m'));
    const a = target.assignments.find((x) => x.id === c.req.param('a'));
    if (!a) throw notFound('assignment');
    const check = canManageMember({ actor: actorOf(c), topology: orgOf(c).topology, target, scope: a });
    if (!check.ok) throw refuse(check.code);
    if (a.templateKey === 'owner') {
      const owners = checkOwnersAfter(ownerUserIds(c, a.id));
      if (!owners.ok) throw refuse(owners.code);
    }
    const { t, org } = orgOf(c);
    const now = nowOf(c);
    cfgOf(c).db.transaction(() => {
      t.run('DELETE FROM role_assignments WHERE org_id = @org AND id = @id', { id: a.id });
      bumpPerms(t, [c.req.param('m')]);
      audit(t, { id: c.get('user').id }, 'role.unassigned', { type: 'membership', id: c.req.param('m') }, { roleId: a.roleId, scopeType: a.scopeType, scopeId: a.scopeId }, null, now);
    })();
    permsChanged(cfgOf(c).db, org.id, target.userId);
    return c.body(null, 204);
  });

  app.patch('/v1/orgs/:org/members/:m', async (c) => {
    const { status } = z.object({ status: z.enum(['active', 'suspended', 'removed']) }).parse(await c.req.json());
    const target = memberAssignments(c, c.req.param('m'));
    const { org, t } = orgOf(c);
    // judged at the widest scope the target holds
    const scope = target.assignments.find((a) => a.scopeType === 'org') ?? target.assignments.find((a) => a.scopeType === 'group') ?? target.assignments[0] ?? { scopeType: 'org' as const, scopeId: org.id };
    const check = canManageMember({ actor: actorOf(c), topology: orgOf(c).topology, target, scope });
    if (!check.ok) throw refuse(check.code);
    if (status !== 'active' && target.assignments.some((a) => a.templateKey === 'owner')) {
      const owners = checkOwnersAfter(ownerUserIds(c, undefined, c.req.param('m')));
      if (!owners.ok) throw refuse(owners.code);
    }
    const now = nowOf(c);
    t.run('UPDATE memberships SET status = @s, removed_at = CASE WHEN @s = \'removed\' THEN @now ELSE NULL END, perms_version = perms_version + 1 WHERE org_id = @org AND id = @id', { s: status, now, id: c.req.param('m') });
    audit(t, { id: c.get('user').id }, `member.${status}`, { type: 'membership', id: c.req.param('m') }, { status: target.status }, { status }, now);
    permsChanged(cfgOf(c).db, org.id, target.userId);
    return c.body(null, 204);
  });

  // ------------------------------------------------------------ roles

  app.post('/v1/orgs/:org/roles', async (c) => {
    const input = z.object({ id: z.string().optional(), name: z.string().min(1).max(60), rank: z.number().int().min(1).max(99), permissions: z.array(z.string()) }).parse(await c.req.json());
    const unknown = input.permissions.filter((p) => !isPermission(p));
    if (unknown.length) throw badRequest('unknown permissions', Object.fromEntries(unknown.map((p) => [p, 'unknown'])));
    const { t, topology } = orgOf(c);
    const existing = input.id ? roleById(c, input.id) : null;
    const check = canEditRole({ actor: actorOf(c), topology, role: { rank: input.rank, permissions: input.permissions }, existing });
    if (!check.ok) throw refuse(check.code);
    const now = nowOf(c);
    const id = existing?.id ?? uuidv7(now);
    cfgOf(c).db.transaction(() => {
      if (existing) {
        t.run('UPDATE roles SET name = @name, rank = @rank, updated_at = @now WHERE org_id = @org AND id = @id', { name: input.name, rank: input.rank, now, id });
        t.run('DELETE FROM role_permissions WHERE role_id = @id AND role_id IN (SELECT id FROM roles WHERE org_id = @org)', { id });
      } else {
        t.run('INSERT INTO roles (id, org_id, template_key, name, rank, is_locked, created_by, created_at, updated_at) VALUES (@id, @org, NULL, @name, @rank, 0, @u, @now, @now)', { id, name: input.name, rank: input.rank, u: c.get('user').id, now });
      }
      for (const p of new Set(input.permissions)) t.run('INSERT INTO role_permissions (role_id, permission) SELECT @id, @p WHERE EXISTS (SELECT 1 FROM roles WHERE id = @id AND org_id = @org)', { id, p });
      const holders = t.all<{ membership_id: string }>('SELECT DISTINCT membership_id FROM role_assignments WHERE org_id = @org AND role_id = @id', { id }).map((r) => r.membership_id);
      bumpPerms(t, holders);
      audit(t, { id: c.get('user').id }, existing ? 'role.updated' : 'role.created', { type: 'role', id }, existing ? { name: existing.name, rank: existing.rank, permissions: existing.permissions } : null, input, now);
    })();
    const role = loadRoles(t).find((r) => r.id === id)!;
    return c.json({ id: role.id, templateKey: role.template_key, name: role.name, rank: role.rank, locked: !!role.is_locked, permissions: role.permissions, memberCount: role.members }, existing ? 200 : 201);
  });

  app.get('/v1/orgs/:org/roles/:id/impact', (c) => {
    need(c, 'roles.manage');
    const rows = orgOf(c).t.all<{ name: string | null }>(
      `SELECT DISTINCT u.display_name AS name FROM role_assignments a JOIN memberships m ON m.id = a.membership_id JOIN users u ON u.id = m.user_id
        WHERE a.org_id = @org AND a.role_id = @id AND m.status = 'active' ORDER BY u.display_name`,
      { id: c.req.param('id') },
    );
    return c.json({ members: rows.length, names: rows.map((r) => r.name ?? '') });
  });

  // ------------------------------------------------------------ org and shop settings

  app.patch('/v1/orgs/:org', async (c) => {
    need(c, 'org.settings.manage');
    const patch = z
      .object({
        name: z.string().min(1).max(120),
        brandColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).nullable(),
        defaultLocale: z.enum(['en', 'el', 'ru']),
        timezone: z.string().min(3),
        allowNegativeStock: z.boolean(),
        postsNeedApproval: z.boolean(),
        pushDailyCap: z.number().int().min(0).max(20),
        quietHours: z.string().regex(/^\d{1,2}:\d{2}-\d{1,2}:\d{2}$/),
        customerCatalog: z.enum(['off', 'subscribers', 'public']),
        customerPrices: z.boolean(),
        customerStock: z.enum(['off', 'availability', 'exact']),
        fewLeftThreshold: z.number().int().min(0).max(100),
      })
      .partial()
      .parse(await c.req.json());
    const { t, org } = orgOf(c);
    const before = orgSettings(cfgOf(c).db, org);
    const cols: Record<string, string> = {
      name: 'name', brandColor: 'brand_color', defaultLocale: 'default_locale', timezone: 'timezone', allowNegativeStock: 'allow_negative_stock',
      postsNeedApproval: 'posts_need_approval', pushDailyCap: 'push_daily_cap', quietHours: 'quiet_hours', customerCatalog: 'customer_catalog',
      customerPrices: 'customer_prices', customerStock: 'customer_stock', fewLeftThreshold: 'few_left_threshold',
    };
    const now = nowOf(c);
    cfgOf(c).db.transaction(() => {
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) continue;
        t.run(`UPDATE organizations SET ${cols[k]} = @v WHERE id = @org`, { v: typeof v === 'boolean' ? (v ? 1 : 0) : v });
      }
      if (patch.postsNeedApproval !== undefined && patch.postsNeedApproval !== before.postsNeedApproval) bumpPerms(t, 'all');
      audit(t, { id: c.get('user').id }, 'org.settings_changed', { type: 'organization', id: org.id }, before, patch, now);
    })();
    const fresh = platform(cfgOf(c).db).get<typeof org>(`SELECT ${ORG_COLUMNS} FROM organizations WHERE id = @id`, { id: org.id })!;
    return c.json(orgSettings(cfgOf(c).db, fresh) satisfies OrgSettings);
  });

  app.patch('/v1/orgs/:org/shops/:shop', async (c) => {
    const shopId = c.req.param('shop');
    need(c, 'shop.settings.manage', shopId);
    const patch = z
      .object({
        name: z.string().min(1).max(80), city: z.string().nullable(), address: z.string().nullable(), phone: z.string().nullable(),
        timezone: z.string().nullable(), customerVisible: z.boolean(), customerStock: z.enum(['off', 'availability', 'exact']).nullable(),
      })
      .partial()
      .parse(await c.req.json());
    const cols: Record<string, string> = { name: 'name', city: 'city', address: 'address', phone: 'phone', timezone: 'timezone', customerVisible: 'customer_visible', customerStock: 'customer_stock' };
    const { t } = orgOf(c);
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      t.run(`UPDATE shops SET ${cols[k]} = @v WHERE org_id = @org AND id = @id`, { v: typeof v === 'boolean' ? (v ? 1 : 0) : v, id: shopId });
    }
    audit(t, { id: c.get('user').id }, 'shop.updated', { type: 'shop', id: shopId }, null, patch, nowOf(c));
    return c.json(loadShops(t, [shopId])[0]);
  });

  app.get('/v1/orgs/:org/audit', (c) => {
    need(c, 'org.audit.view');
    const offset = decodeCursor(c.req.query('cursor'));
    const limit = clampLimit(c.req.query('limit'), 50, 200);
    const rows = orgOf(c).t.all<{ id: string; actor_id: string | null; actor_name: string | null; actor_kind: string; action: string; entity_type: string | null; entity_id: string | null; before_json: string | null; after_json: string | null; created_at: number }>(
      `SELECT a.id, a.actor_id, u.display_name AS actor_name, a.actor_kind, a.action, a.entity_type, a.entity_id, a.before_json, a.after_json, a.created_at
         FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id WHERE a.org_id = @org ORDER BY a.created_at DESC, a.id DESC LIMIT @lim OFFSET @off`,
      { lim: limit + 1, off: offset },
    );
    const items: AuditEntry[] = rows.map((r) => ({
      id: r.id, actorId: r.actor_id, actorName: r.actor_name, actorKind: r.actor_kind, action: r.action, entityType: r.entity_type, entityId: r.entity_id,
      before: parseJson(r.before_json, null), after: parseJson(r.after_json, null), createdAt: r.created_at,
    }));
    return c.json(page(items, offset, limit));
  });
}
