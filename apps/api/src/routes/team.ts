// team (read side): members, roles, what the caller may grant

import type { Hono } from 'hono';
import { z } from 'zod';
import { canManageMember, grantableRoles, scopeContains, shopsInScope, type AccessAssignment, type Member, type Role, type RoleTemplateKey } from '@custock/core';
import type { AppEnv } from '../types';
import { has, need, orgOf, orgWide } from '../lib/context';
import { badRequest } from '../lib/problem';
import { avatarKeySql, fileUrl } from '../services/catalog';

interface RoleRow {
  id: string;
  template_key: RoleTemplateKey | null;
  name: string;
  rank: number;
  is_locked: number;
}

export function loadRoles(t: ReturnType<typeof orgOf>['t']): (RoleRow & { permissions: string[]; members: number })[] {
  const roles = t.all<RoleRow>('SELECT id, template_key, name, rank, is_locked FROM roles WHERE org_id = @org AND archived_at IS NULL ORDER BY rank DESC, name');
  const perms = t.all<{ role_id: string; permission: string }>(
    'SELECT rp.role_id, rp.permission FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE r.org_id = @org',
  );
  const counts = t.all<{ role_id: string; n: number }>(
    `SELECT a.role_id, count(DISTINCT a.membership_id) AS n FROM role_assignments a JOIN memberships m ON m.id = a.membership_id
      WHERE a.org_id = @org AND m.status = 'active' GROUP BY a.role_id`,
  );
  return roles.map((r) => ({
    ...r,
    permissions: perms.filter((p) => p.role_id === r.id).map((p) => p.permission).sort(),
    members: counts.find((x) => x.role_id === r.id)?.n ?? 0,
  }));
}

export function teamRoutes(app: Hono<AppEnv>) {
  app.get('/v1/orgs/:org/members', (c) => {
    need(c, 'members.view');
    const { t, topology, assignments, shopNames, groupNames, org } = orgOf(c);
    const me = c.get('user').id;
    const all = orgWide(c, 'members.view');
    const myShops = new Set(orgOf(c).access.shops.filter((s) => s.perms.includes('members.view')).map((s) => s.shopId));
    const members = t.all<{ id: string; user_id: string; name: string | null; email: string | null; status: Member['status']; avatar_key: string | null }>(
      `SELECT m.id, m.user_id, u.display_name AS name, u.email, m.status, ${avatarKeySql('u.id')} AS avatar_key FROM memberships m JOIN users u ON u.id = m.user_id
        WHERE m.org_id = @org AND m.status != 'removed' ORDER BY u.display_name`,
    );
    const rows = t.all<{ id: string; membership_id: string; role_id: string; role_name: string; rank: number; scope_type: 'org' | 'group' | 'shop'; scope_id: string }>(
      `SELECT a.id, a.membership_id, a.role_id, r.name AS role_name, r.rank, a.scope_type, a.scope_id
         FROM role_assignments a JOIN roles r ON r.id = a.role_id WHERE a.org_id = @org`,
    );
    const permsByRole = new Map(loadRoles(t).map((r) => [r.id, r.permissions]));
    const scopeName = (type: string, id: string) => (type === 'org' ? org.name : type === 'group' ? groupNames[id] ?? id : shopNames[id] ?? id);
    const actor = { userId: me, assignments };

    const out: Member[] = [];
    for (const m of members) {
      const mine = rows.filter((r) => r.membership_id === m.id);
      const visible = all || mine.some((a) => shopsInScope(topology, { scopeType: a.scope_type, scopeId: a.scope_id }).some((s) => myShops.has(s)));
      if (!visible) continue;
      const targetAssignments: AccessAssignment[] = mine.map((a) => ({ id: a.id, roleId: a.role_id, rank: a.rank, permissions: permsByRole.get(a.role_id) ?? [], scopeType: a.scope_type, scopeId: a.scope_id }));
      // judge at the widest scope of theirs that the caller covers, else at their first scope
      const scope =
        mine
          .map((a) => ({ scopeType: a.scope_type, scopeId: a.scope_id }))
          .find((s) => assignments.some((x) => scopeContains(topology, x, s))) ?? (mine[0] ? { scopeType: mine[0].scope_type, scopeId: mine[0].scope_id } : { scopeType: 'org' as const, scopeId: org.id });
      const check = canManageMember({ actor, topology, target: { userId: m.user_id, assignments: targetAssignments }, scope });
      out.push({
        membershipId: m.id,
        userId: m.user_id,
        name: m.name,
        email: m.email,
        avatarUrl: fileUrl(m.avatar_key),
        status: m.status,
        assignments: mine.map((a) => ({ id: a.id, roleId: a.role_id, roleName: a.role_name, scopeType: a.scope_type, scopeId: a.scope_id, scopeName: scopeName(a.scope_type, a.scope_id) })),
        canManage: check.ok,
        manageBlockedBy: check.ok ? null : check.code,
      });
    }
    return c.json(out);
  });

  app.get('/v1/orgs/:org/roles', (c) => {
    if (!has(c, 'roles.manage') && !has(c, 'members.invite')) need(c, 'members.view');
    const roles: Role[] = loadRoles(orgOf(c).t).map((r) => ({
      id: r.id,
      templateKey: r.template_key,
      name: r.name,
      rank: r.rank,
      locked: !!r.is_locked,
      permissions: r.permissions,
      memberCount: r.members,
    }));
    return c.json(roles);
  });

  app.get('/v1/orgs/:org/roles/grantable', (c) => {
    const q = z.object({ scopeType: z.enum(['org', 'group', 'shop']), scopeId: z.string() }).safeParse(c.req.query());
    if (!q.success) throw badRequest('scopeType and scopeId are required');
    if (!has(c, 'members.invite') && !has(c, 'members.manage')) need(c, 'members.invite');
    const { t, topology, assignments } = orgOf(c);
    const roles = loadRoles(t).map((r) => ({ id: r.id, name: r.name, rank: r.rank, permissions: r.permissions, locked: !!r.is_locked }));
    return c.json(grantableRoles({ actor: { userId: c.get('user').id, assignments }, topology, scope: q.data, roles }));
  });
}
