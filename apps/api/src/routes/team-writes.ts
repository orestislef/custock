// team and org writes with the delegation rules from thinking/02: invites, assignments, member
// status, roles, org settings, shop details, the audit log

import type { Context, Hono } from 'hono';
import { z } from 'zod';
import {
  canEditRole, canGrantRole, canManageMember, checkOwnersAfter, effectiveAtScope, InviteInput, InviteRegisterInput, isPermission, ShopInput, uuidv7,
  type AccessAssignment, type AuditEntry, type Invite, type InviteCreated, type InvitePreview, type OrgSettings,
} from '@custock/core';
import { hashPassword, randomToken, sha256, type Db } from '@custock/db';
import { pickLocale, translator } from '@custock/i18n';
import type { AppEnv } from '../types';
import { audit, bumpPerms } from '../lib/audit';
import { issueTokens } from '../lib/auth';
import { rateLimit } from '../lib/ratelimit';
import { cfgOf, need, nowOf, orgOf, requireAuth, ORG_COLUMNS } from '../lib/context';
import { idempotent } from '../lib/idempotency';
import { permsChanged } from '../lib/notify';
import { ApiProblem, badRequest, forbidden, notFound } from '../lib/problem';
import { clampLimit, decodeCursor, page, parseJson, platform, Tenant } from '../lib/tenant';
import { devOutboxTransport } from '../lib/transport';
import { emailMessage } from '../lib/transport';
import { inviteEmail } from '../email/messages';
import { loadRoles } from './team';
import { loadShops, orgSettings } from './org';
import { addShop, BootstrapError, ensureDefaultJoinLink } from '../services/bootstrap';
import { avatarKeySql, fileUrl } from '../services/catalog';
import { retireFile } from './uploads';

const INVITE_TTL = 7 * 86_400_000;

// asks the runtime, so aliases like Europe/Nicosia pass and made up names do not
export function isTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return tz.length <= 64;
  } catch {
    return false;
  }
}

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

interface OpenInvite {
  id: string; org_id: string; email: string; role_id: string; scope_type: string; scope_id: string;
  expires_at: number; invited_by: string | null; locale: string | null;
}

// an invite that can still be used, or 410
function openInvite(db: Db, token: string, now: number): OpenInvite {
  const inv = platform(db).get<OpenInvite & { accepted_at: number | null; revoked_at: number | null }>(
    'SELECT id, org_id, email, role_id, scope_type, scope_id, expires_at, accepted_at, revoked_at, invited_by, locale FROM invites WHERE token_hash = @h',
    { h: sha256(token) },
  );
  if (!inv || inv.revoked_at || inv.accepted_at || inv.expires_at < now) throw new ApiProblem(410, 'invite_expired');
  return inv;
}

// the person joins the org with the invite's role, and the inviter hears about it
function claimInvite(db: Db, inv: OpenInvite, user: { id: string; name: string }, now: number) {
  const t = new Tenant(db, inv.org_id);
  db.transaction(() => {
    const claimed = t.run(
      'UPDATE invites SET accepted_at = @now, accepted_by = @u WHERE org_id = @org AND id = @id AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at >= @now',
      { now, u: user.id, id: inv.id },
    );
    if (!claimed.changes) throw new ApiProblem(410, 'invite_expired');
    let m = t.get<{ id: string; status: string }>('SELECT id, status FROM memberships WHERE org_id = @org AND user_id = @u', { u: user.id });
    if (!m) {
      m = { id: uuidv7(now), status: 'active' };
      t.run("INSERT INTO memberships (id, org_id, user_id, status, perms_version, joined_at) VALUES (@id, @org, @u, 'active', 1, @now)", { id: m.id, u: user.id, now });
    } else if (m.status !== 'active') {
      // a suspended or removed member does not get their old roles back through an invite
      t.run('DELETE FROM role_assignments WHERE org_id = @org AND membership_id = @m', { m: m.id });
      t.run("UPDATE memberships SET status = 'active', removed_at = NULL WHERE org_id = @org AND id = @id", { id: m.id });
      audit(t, { id: user.id }, 'member.rejoined_by_invite', { type: 'membership', id: m.id }, { status: m.status }, { status: 'active' }, now);
    }
    t.run(
      `INSERT OR IGNORE INTO role_assignments (id, org_id, membership_id, role_id, scope_type, scope_id, granted_by, created_at)
       VALUES (@id, @org, @m, @r, @st, @sid, @by, @now)`,
      { id: uuidv7(now), m: m.id, r: inv.role_id, st: inv.scope_type, sid: inv.scope_id, by: inv.invited_by, now },
    );
    bumpPerms(t, [m.id]);
    audit(t, { id: user.id }, 'invite.accepted', { type: 'invite', id: inv.id }, null, null, now);
    // the first owner from the server setup: the business gets its default join link now
    if (!inv.invited_by) ensureDefaultJoinLink(db, inv.org_id, user.id, now);
  })();
  // the first owner was invited by the server setup, there is nobody to tell
  if (!inv.invited_by) return;
  const orgName = t.get<{ name: string }>('SELECT name FROM organizations WHERE id = @org')!.name;
  const inviter = platform(db).get<{ locale: string }>('SELECT locale FROM users WHERE id = @id', { id: inv.invited_by });
  const tr = translator(pickLocale(inviter?.locale), 'server');
  const params = { name: user.name, org: orgName };
  devOutboxTransport(db, () => {}).send({
    channel: 'push', orgId: inv.org_id, userId: inv.invited_by, locale: inviter?.locale ?? 'el',
    title: tr('push.inviteAccepted.title', params), body: tr('push.inviteAccepted.body', params), payload: { type: 'inviteAccepted' },
  });
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
    const rows = t.all<{ id: string; email: string; role_id: string; role_name: string; scope_type: 'org' | 'group' | 'shop'; scope_id: string; invited_by: string | null; created_at: number; expires_at: number }>(
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
      const commonRole = translator(pickLocale(input.locale), 'common');
      const scopeName = input.scopeType === 'org' ? org.name : input.scopeType === 'group' ? groupNames[input.scopeId] ?? '' : shopNames[input.scopeId] ?? '';
      const roleLabel = role.template_key ? commonRole(`role.${role.template_key}`) : role.name;
      const params = { inviter: c.get('user').displayName ?? '', org: org.name, role: roleLabel, scope: scopeName, url };
      devOutboxTransport(cfgOf(c).db).send(emailMessage(inviteEmail(input.locale, params), { orgId: org.id, to: email, locale: input.locale, payload: { type: 'invite', inviteId: id } }));
      audit(t, { id: c.get('user').id }, 'invite.sent', { type: 'invite', id }, null, { email, roleId: role.id, scopeType: input.scopeType, scopeId: input.scopeId }, now);
      // the link always comes back so it can be shared by hand while mail is not live
      const body: InviteCreated = { id, link: url, emailed: !!cfgOf(c).sending?.email, ...(cfgOf(c).dev ? { devLink: url } : {}) };
      return { status: 201, body };
    });
  });

  app.post('/v1/orgs/:org/invites/:id/revoke', (c) => {
    need(c, 'members.invite');
    const { t, assignments, topology } = orgOf(c);
    const inv = t.get<{ scope_type: 'org' | 'group' | 'shop'; scope_id: string }>('SELECT scope_type, scope_id FROM invites WHERE org_id = @org AND id = @id', { id: c.req.param('id') });
    if (!inv) throw notFound('invite');
    if (!effectiveAtScope(assignments, topology, { scopeType: inv.scope_type, scopeId: inv.scope_id }).perms.has('members.invite')) throw forbidden('members.invite at the invite scope', 'scope');
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
    const inv = openInvite(db, token, now);
    const user = c.get('user');
    if ((user.email ?? '').toLowerCase() !== inv.email) throw forbidden('different email', 'invite_email_mismatch');
    claimInvite(db, inv, { id: user.id, name: user.displayName ?? user.email ?? '' }, now);
    return c.json({ orgId: inv.org_id });
  });

  // ------------------------------------------------------------ invites without email
  // the link is the proof: whoever holds it may join with the role it carries. a brand new person
  // sets a name and password here. an email that already has an account signs in and accepts, so
  // an invite can never take over an existing account.

  const inviteLimit = rateLimit({ windowMs: 60_000, max: 30, prefix: 'invite' });

  app.get('/v1/invites/:token', inviteLimit, (c) => {
    const db = cfgOf(c).db;
    const inv = openInvite(db, c.req.param('token'), nowOf(c));
    const t = new Tenant(db, inv.org_id);
    const org = t.get<{ name: string }>('SELECT name FROM organizations WHERE id = @org')!;
    const scopeName = inv.scope_type === 'org'
      ? org.name
      : inv.scope_type === 'group'
        ? t.get<{ name: string }>('SELECT name FROM shop_groups WHERE org_id = @org AND id = @id', { id: inv.scope_id })?.name ?? ''
        : t.get<{ name: string }>('SELECT name FROM shops WHERE org_id = @org AND id = @id', { id: inv.scope_id })?.name ?? '';
    const role = t.get<{ name: string; template_key: string | null }>('SELECT name, template_key FROM roles WHERE org_id = @org AND id = @id', { id: inv.role_id });
    const roleName = role?.template_key ? translator(c.get('locale'), 'common')(`role.${role.template_key}`) : role?.name ?? '';
    const accountExists = !!platform(db).get('SELECT 1 FROM users WHERE email = @e AND deleted_at IS NULL', { e: inv.email });
    const body: InvitePreview = { orgName: org.name, scopeName, roleName, email: inv.email, accountExists, expiresAt: inv.expires_at };
    return c.json(body);
  });

  app.post('/v1/invites/register', inviteLimit, async (c) => {
    const input = InviteRegisterInput.parse(await c.req.json());
    const cfg = cfgOf(c);
    if (cfg.auth?.mode === 'jwks') throw new ApiProblem(404, 'not_found', 'accounts are made on the login server');
    const db = cfg.db;
    const now = nowOf(c);
    const inv = openInvite(db, input.token, now);
    const p = platform(db);
    if (p.get('SELECT 1 FROM users WHERE email = @e', { e: inv.email })) throw new ApiProblem(409, 'account_exists', 'sign in with that account, then accept');
    // the email counts as verified only when the invite really went out by email
    const emailed = !!p.get("SELECT 1 FROM dev_outbox WHERE channel = 'email' AND sent_at IS NOT NULL AND json_extract(payload, '$.inviteId') = @id", { id: inv.id });
    const userId = uuidv7(now);
    const hash = hashPassword(input.password);
    db.transaction(() => {
      p.run(
        `INSERT INTO users (id, email, display_name, password_hash, email_verified_at, locale, created_at, updated_at)
         VALUES (@id, @e, @n, @h, @v, @l, @now, @now)`,
        { id: userId, e: inv.email, n: input.displayName, h: hash, v: emailed ? now : null, l: input.locale ?? inv.locale ?? c.get('locale'), now },
      );
      claimInvite(db, inv, { id: userId, name: input.displayName }, now);
    })();
    const { sessionId: _s, ...tokens } = await issueTokens(cfg, userId, { userAgent: c.req.header('User-Agent') });
    return c.json({ ...tokens, orgId: inv.org_id }, 201);
  });

  // ------------------------------------------------------------ assignments and members

  app.post('/v1/orgs/:org/members/:m/assignments', async (c) => {
    const input = z.object({ roleId: z.string(), scopeType: z.enum(['org', 'group', 'shop']), scopeId: z.string() }).parse(await c.req.json());
    scopeKnown(c, input.scopeType, input.scopeId);
    const target = memberAssignments(c, c.req.param('m'));
    const role = roleById(c, input.roleId);
    const check = canGrantRole({ actor: actorOf(c), topology: orgOf(c).topology, role, scope: input, targetUserId: target.userId, via: 'members.manage' });
    if (!check.ok) throw refuse(check.code);
    const manage = canManageMember({ actor: actorOf(c), topology: orgOf(c).topology, target, scope: input });
    if (!manage.ok) throw refuse(manage.code);
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
    const scopes = target.assignments.length ? target.assignments : [{ scopeType: 'org' as const, scopeId: org.id }];
    for (const scope of scopes) {
      const check = canManageMember({ actor: actorOf(c), topology: orgOf(c).topology, target, scope });
      if (!check.ok) throw refuse(check.code);
    }
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
        timezone: z.string().refine(isTimezone, 'unknown timezone'),
        allowNegativeStock: z.boolean(),
        postsNeedApproval: z.boolean(),
        pushDailyCap: z.number().int().min(0).max(20),
        quietHours: z.string().regex(/^\d{1,2}:\d{2}-\d{1,2}:\d{2}$/),
        customerCatalog: z.enum(['off', 'subscribers', 'public']),
        customerPrices: z.boolean(),
        customerStock: z.enum(['off', 'availability', 'exact']),
        fewLeftThreshold: z.number().int().min(0).max(100),
        // a 'logo' upload of this business, or null to take the logo off
        logoFileId: z.string().max(64).nullable(),
      })
      .partial()
      .parse(await c.req.json());
    const { t, org } = orgOf(c);
    const before = orgSettings(cfgOf(c).db, org);
    if (patch.logoFileId && !t.get("SELECT 1 FROM files WHERE org_id = @org AND id = @f AND purpose = 'logo' AND deleted_at IS NULL", { f: patch.logoFileId })) {
      throw notFound('file');
    }
    const oldLogo = patch.logoFileId !== undefined && patch.logoFileId !== org.logo_file_id ? org.logo_file_id : null;
    const cols: Record<string, string> = {
      name: 'name', brandColor: 'brand_color', defaultLocale: 'default_locale', timezone: 'timezone', allowNegativeStock: 'allow_negative_stock',
      postsNeedApproval: 'posts_need_approval', pushDailyCap: 'push_daily_cap', quietHours: 'quiet_hours', customerCatalog: 'customer_catalog',
      customerPrices: 'customer_prices', customerStock: 'customer_stock', fewLeftThreshold: 'few_left_threshold', logoFileId: 'logo_file_id',
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
    // a replaced or removed logo leaves the bucket
    if (oldLogo) retireFile(cfgOf(c), oldLogo, now);
    const fresh = platform(cfgOf(c).db).get<typeof org>(`SELECT ${ORG_COLUMNS} FROM organizations WHERE id = @id`, { id: org.id })!;
    return c.json(orgSettings(cfgOf(c).db, fresh) satisfies OrgSettings);
  });

  app.post('/v1/orgs/:org/shops', async (c) => {
    need(c, 'shops.create');
    const input = ShopInput.parse(await c.req.json());
    const { t } = orgOf(c);
    try {
      const shop = addShop(cfgOf(c).db, t.orgId, input, { id: c.get('user').id }, nowOf(c));
      return c.json(loadShops(t, [shop.id])[0], 201);
    } catch (err) {
      if (err instanceof BootstrapError) throw new ApiProblem(409, 'conflict', err.message);
      throw err;
    }
  });

  app.patch('/v1/orgs/:org/shops/:shop', async (c) => {
    const shopId = c.req.param('shop');
    need(c, 'shop.settings.manage', shopId);
    const patch = z
      .object({
        name: z.string().min(1).max(80), city: z.string().nullable(), address: z.string().nullable(), phone: z.string().nullable(),
        timezone: z.string().refine(isTimezone, 'unknown timezone').nullable(), customerVisible: z.boolean(), customerStock: z.enum(['off', 'availability', 'exact']).nullable(),
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
    const rows = orgOf(c).t.all<{ id: string; actor_id: string | null; actor_name: string | null; actor_avatar: string | null; actor_kind: string; action: string; entity_type: string | null; entity_id: string | null; before_json: string | null; after_json: string | null; created_at: number }>(
      `SELECT a.id, a.actor_id, u.display_name AS actor_name, ${avatarKeySql('u.id')} AS actor_avatar, a.actor_kind, a.action, a.entity_type, a.entity_id, a.before_json, a.after_json, a.created_at
         FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id WHERE a.org_id = @org ORDER BY a.created_at DESC, a.id DESC LIMIT @lim OFFSET @off`,
      { lim: limit + 1, off: offset },
    );
    const items: AuditEntry[] = rows.map((r) => ({
      id: r.id, actorId: r.actor_id, actorName: r.actor_name, actorAvatarUrl: fileUrl(r.actor_avatar), actorKind: r.actor_kind, action: r.action, entityType: r.entity_type, entityId: r.entity_id,
      before: parseJson(r.before_json, null), after: parseJson(r.after_json, null), createdAt: r.created_at,
    }));
    return c.json(page(items, offset, limit));
  });
}
