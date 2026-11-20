// auth and org context middleware, permission guards

import type { Context, MiddlewareHandler } from 'hono';
import { buildOrgAccess, can, permLevel, type AccessAssignment, type Topology } from '@custock/core';
import { pickLocale, type AppLocale } from '@custock/i18n';
import type { Db } from '@custock/db';
import type { AppEnv, AuthUser, Config, OrgContext, OrgRow } from '../types';
import { verifyAccess } from './auth';
import { verifyExternal } from './external-auth';
import { forbidden, notFound, unauthorized } from './problem';
import { Tenant, platform } from './tenant';
import { orgLogoUrl } from '../services/catalog';
import { FEATURES, type Feature } from '@custock/core';
import { isSuperadmin, orgFlags, orgFull, platformAssignment, platformPaused, shopsUsed, staffUsed, type OrgFlags } from './platform-access';

export const cfgOf = (c: Context<AppEnv>): Config => c.get('cfg');
export const nowOf = (c: Context<AppEnv>): number => {
  const cfg = c.get('cfg');
  return cfg.now ? cfg.now() : Date.now();
};

interface UserRow {
  id: string;
  email: string | null;
  display_name: string | null;
  locale: AppLocale;
  deleted_at: number | null;
}

async function loadUser(c: Context<AppEnv>): Promise<AuthUser | null> {
  const header = c.req.header('Authorization');
  if (!header?.startsWith('Bearer ')) return null;
  const cfg = cfgOf(c);
  if (cfg.auth?.mode === 'jwks') return verifyExternal(cfg.db, cfg.auth, header.slice(7), nowOf(c));
  const { userId, sessionId } = await verifyAccess(cfg, header.slice(7));
  const db = platform(cfg.db);
  const session = db.get<{ revoked_at: number | null; user_id: string }>('SELECT revoked_at, user_id FROM sessions WHERE id = @id', { id: sessionId });
  // the session must belong to the user the token names
  if (!session || session.revoked_at || session.user_id !== userId) throw unauthorized('session revoked');
  const user = db.get<UserRow>('SELECT id, email, display_name, locale, deleted_at FROM users WHERE id = @id', { id: userId });
  if (!user || user.deleted_at) throw unauthorized('user gone');
  return { id: user.id, sessionId, email: user.email, displayName: user.display_name, locale: user.locale };
}

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = await loadUser(c);
  if (!user) throw unauthorized('missing token');
  c.set('user', user);
  if (!c.req.header('Accept-Language')) c.set('locale', user.locale);
  await next();
};

// sets the user when a valid token is present, carries on without one
export const optionalAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  try {
    const user = await loadUser(c);
    if (user) c.set('user', user);
  } catch {
    // public endpoints ignore bad tokens
  }
  await next();
};

export const localeMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const header = c.req.header('Accept-Language')?.split(',')[0]?.trim();
  c.set('locale', pickLocale(header, 'el'));
  c.set('localeFromHeader', !!header && ['en', 'el', 'ru'].includes(header.toLowerCase().split(/[-_]/)[0]!));
  await next();
};

// the language to show names in: what the request asked for, else the signed in person's
// language, else the business default
export function readerLocale(c: Context<AppEnv>, orgDefault: AppLocale): AppLocale {
  if (c.get('localeFromHeader')) return c.get('locale');
  const user = c.get('user');
  if (user) return user.locale;
  return orgDefault;
}

// sql for a product name in the reader's language. alias is the products table alias.
export const productNameSql = (alias: string, param = '@loc') =>
  `coalesce((SELECT ptr.name FROM product_translations ptr WHERE ptr.product_id = ${alias}.id AND ptr.locale = ${param}), ${alias}.name)`;

// the same for a category
export const categoryNameSql = (alias: string, param = '@loc') =>
  `coalesce((SELECT ctr.name FROM category_translations ctr WHERE ctr.category_id = ${alias}.id AND ctr.locale = ${param}), ${alias}.name)`;

export function loadTopology(db: Db, orgId: string): { topology: Topology; shopNames: Record<string, string>; groupNames: Record<string, string> } {
  const t = new Tenant(db, orgId);
  const shops = t.all<{ id: string; name: string }>('SELECT id, name FROM shops WHERE org_id = @org AND archived_at IS NULL ORDER BY created_at, name');
  const groups = t.all<{ id: string; name: string }>('SELECT id, name FROM shop_groups WHERE org_id = @org AND archived_at IS NULL');
  const links = t.all<{ group_id: string; shop_id: string }>('SELECT group_id, shop_id FROM shop_group_shops WHERE org_id = @org');
  const shopIds = shops.map((s) => s.id);
  const groupMap: Record<string, string[]> = {};
  for (const g of groups) groupMap[g.id] = [];
  for (const l of links) if (groupMap[l.group_id] && shopIds.includes(l.shop_id)) groupMap[l.group_id]!.push(l.shop_id);
  return {
    topology: { orgId, shops: shopIds, groups: groupMap },
    shopNames: Object.fromEntries(shops.map((s) => [s.id, s.name])),
    groupNames: Object.fromEntries(groups.map((g) => [g.id, g.name])),
  };
}

export function loadAssignments(t: Tenant, membershipId: string, org: Pick<OrgRow, 'posts_need_approval'>): { assignments: AccessAssignment[]; roleNames: string[] } {
  const rows = t.all<{ id: string; role_id: string; rank: number; name: string; template_key: string | null; scope_type: 'org' | 'group' | 'shop'; scope_id: string }>(
    `SELECT a.id, a.role_id, r.rank, r.name, r.template_key, a.scope_type, a.scope_id
       FROM role_assignments a JOIN roles r ON r.id = a.role_id
      WHERE a.org_id = @org AND a.membership_id = @m AND r.archived_at IS NULL`,
    { m: membershipId },
  );
  const perms = t.all<{ role_id: string; permission: string }>(
    `SELECT rp.role_id, rp.permission FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE r.org_id = @org`,
  );
  const byRole = new Map<string, string[]>();
  for (const p of perms) byRole.set(p.role_id, [...(byRole.get(p.role_id) ?? []), p.permission]);
  // "posts need approval": the business setting covers everyone below admin, a role or a person
  // can be held to it on top (policy posts.needApproval, set in the role editor or for one person)
  const approval = t.all<{ level: string; target_id: string }>(
    `SELECT v.level, v.target_id FROM policy_values v WHERE v.org_id = @org AND v.key = 'posts.needApproval' AND v.value_json = 'true'
        AND (v.level = 'role' OR (v.level = 'user' AND v.target_id = (SELECT user_id FROM memberships WHERE id = @m)))`,
    { m: membershipId },
  );
  const rolesHeld = new Set(approval.filter((a) => a.level === 'role').map((a) => a.target_id));
  const personHeld = approval.some((a) => a.level === 'user');
  const assignments = rows.map((r) => {
    let list = byRole.get(r.role_id) ?? [];
    if ((org.posts_need_approval && r.rank < 80) || rolesHeld.has(r.role_id) || personHeld) list = list.filter((p) => p !== 'posts.publish');
    return { id: r.id, roleId: r.role_id, rank: r.rank, permissions: list, scopeType: r.scope_type, scopeId: r.scope_id };
  });
  return { assignments, roleNames: [...new Set(rows.map((r) => r.template_key ?? r.name))] };
}

export const ORG_COLUMNS = `id, name, slug, country, currency, timezone, default_locale, logo_file_id, brand_color,
  allow_negative_stock, posts_need_approval, push_daily_cap, quiet_hours, customer_catalog, customer_prices,
  customer_stock, few_left_threshold, customer_offer_prices, customer_orders`;

// everything buildContextFor reads for many businesses at once, in a handful of queries. used by
// /v1/me/context, where a super admin gets every business: one by one that was ten queries each
export interface ContextPreload {
  superadmin: boolean;
  invitesPaused: boolean;
  orgs: Map<string, OrgRow>;
  flags: Map<string, OrgFlags>;
  memberships: Map<string, { id: string; perms_version: number }>;
  topology: Map<string, ReturnType<typeof loadTopology>>;
}

export function preloadContexts(db: Db, orgIds: readonly string[], userId: string): ContextPreload {
  const p = platform(db);
  const ids = JSON.stringify(orgIds);
  const orgs = new Map<string, OrgRow>();
  const flags = new Map<string, OrgFlags>();
  for (const r of p.all<OrgRow & { status: 'active' | 'suspended'; disabled_features: string; max_shops: number | null; max_staff: number | null }>(
    `SELECT ${ORG_COLUMNS}, status, disabled_features, max_shops, max_staff FROM organizations
      WHERE archived_at IS NULL AND id IN (SELECT value FROM json_each(@ids))`,
    { ids },
  )) {
    const { status, disabled_features, max_shops, max_staff, ...org } = r;
    orgs.set(r.id, org as OrgRow);
    let list: string[] = [];
    try { list = JSON.parse(disabled_features || '[]') as string[]; } catch { list = []; }
    flags.set(r.id, { status, disabledFeatures: FEATURES.filter((f: Feature) => list.includes(f)), maxShops: max_shops, maxStaff: max_staff });
  }
  const memberships = new Map<string, { id: string; perms_version: number }>();
  for (const m of p.all<{ org_id: string; id: string; perms_version: number }>(
    "SELECT org_id, id, perms_version FROM memberships WHERE user_id = @u AND status = 'active'",
    { u: userId },
  )) memberships.set(m.org_id, { id: m.id, perms_version: m.perms_version });
  const shops = p.all<{ org_id: string; id: string; name: string }>(
    `SELECT org_id, id, name FROM shops WHERE archived_at IS NULL AND org_id IN (SELECT value FROM json_each(@ids)) ORDER BY created_at, name`,
    { ids },
  );
  const groups = p.all<{ org_id: string; id: string; name: string }>(
    `SELECT org_id, id, name FROM shop_groups WHERE archived_at IS NULL AND org_id IN (SELECT value FROM json_each(@ids))`,
    { ids },
  );
  const links = p.all<{ org_id: string; group_id: string; shop_id: string }>(
    `SELECT org_id, group_id, shop_id FROM shop_group_shops WHERE org_id IN (SELECT value FROM json_each(@ids))`,
    { ids },
  );
  // built in plain arrays and maps first, the Topology type is read only
  const work = new Map<string, { shops: string[]; groups: Record<string, string[]>; shopNames: Record<string, string>; groupNames: Record<string, string> }>();
  for (const id of orgs.keys()) work.set(id, { shops: [], groups: {}, shopNames: {}, groupNames: {} });
  for (const s of shops) {
    const w = work.get(s.org_id);
    if (!w) continue;
    w.shops.push(s.id);
    w.shopNames[s.id] = s.name;
  }
  for (const g of groups) {
    const w = work.get(g.org_id);
    if (!w) continue;
    w.groups[g.id] = [];
    w.groupNames[g.id] = g.name;
  }
  for (const l of links) {
    const w = work.get(l.org_id);
    if (w?.groups[l.group_id] && w.shops.includes(l.shop_id)) w.groups[l.group_id]!.push(l.shop_id);
  }
  const topology = new Map<string, ReturnType<typeof loadTopology>>();
  for (const [id, w] of work) topology.set(id, { topology: { orgId: id, shops: w.shops, groups: w.groups }, shopNames: w.shopNames, groupNames: w.groupNames });
  return { superadmin: isSuperadmin(db, userId), invitesPaused: platformPaused(db, 'pause_invites'), orgs, flags, memberships, topology };
}

export function buildContextFor(db: Db, orgId: string, userId: string, pre?: ContextPreload): OrgContext | null {
  const p = platform(db);
  const org = pre ? pre.orgs.get(orgId) : p.get<OrgRow>(`SELECT ${ORG_COLUMNS} FROM organizations WHERE id = @id AND archived_at IS NULL`, { id: orgId });
  if (!org) return null;
  const t = new Tenant(db, org.id);
  const m = pre
    ? pre.memberships.get(org.id)
    : t.get<{ id: string; perms_version: number }>(
      "SELECT id, perms_version FROM memberships WHERE org_id = @org AND user_id = @u AND status = 'active'",
      { u: userId },
    );
  // a super admin has every permission in every business, member or not (lib/platform-access.ts)
  const superadmin = pre ? pre.superadmin : isSuperadmin(db, userId);
  if (!m && !superadmin) return null;
  const { topology, shopNames, groupNames } = pre?.topology.get(org.id) ?? loadTopology(db, org.id);
  const member = m ? loadAssignments(t, m.id, org) : { assignments: [], roleNames: [] as string[] };
  const assignments = superadmin ? [...member.assignments, platformAssignment(org.id)] : member.assignments;
  const viaPlatform = superadmin && !m;
  t.viaPlatform = viaPlatform;
  const permsVersion = m?.perms_version ?? 1;
  const flags = pre ? pre.flags.get(org.id) ?? null : orgFlags(db, org.id);
  const full = pre
    ? {
      shopsFull: flags?.maxShops != null && shopsUsed(db, org.id) >= flags.maxShops,
      staffFull: pre.invitesPaused || (flags?.maxStaff != null && staffUsed(db, org.id) >= flags.maxStaff),
    }
    : orgFull(db, org.id, flags);
  const access = {
    ...buildOrgAccess({
      org: { id: org.id, name: org.name, slug: org.slug, currency: org.currency, timezone: org.timezone, defaultLocale: org.default_locale },
      roleNames: viaPlatform ? ['superadmin'] : member.roleNames,
      permsVersion,
      assignments,
      topology,
      shopNames,
    }),
    ...(org.logo_file_id ? { logoUrl: orgLogoUrl(db, org.id) } : {}),
    ...(viaPlatform ? { platformAccess: true } : {}),
    ...(flags?.status === 'suspended' ? { suspended: true } : {}),
    ...(flags?.disabledFeatures.length ? { disabledFeatures: [...flags.disabledFeatures] } : {}),
    ...Object.fromEntries(Object.entries(full).filter(([, on]) => on)),
  };
  return { org, t, membershipId: m?.id ?? '', permsVersion, access, topology, assignments, shopNames, groupNames, viaPlatform };
}

// /v1/orgs/:org/*. not a member looks the same as not existing.
export const orgContext: MiddlewareHandler<AppEnv> = async (c, next) => {
  const orgId = c.req.param('org');
  if (!orgId) throw notFound();
  const ctx = buildContextFor(cfgOf(c).db, orgId, c.get('user').id);
  if (!ctx) throw notFound('organization');
  c.set('org', ctx);
  const sent = Number(c.req.header('X-Perms-Version'));
  if (Number.isFinite(sent) && sent > 0 && sent < ctx.permsVersion) c.header('X-Perms-Stale', '1');
  await next();
};

export const orgOf = (c: Context<AppEnv>) => c.get('org');

// throws unless the member holds perm (at the shop when given)
export function need(c: Context<AppEnv>, perm: string, shopId?: string | null) {
  const { access } = orgOf(c);
  if (shopId && !access.shops.some((s) => s.shopId === shopId) && permLevel(perm) === 'shop') throw forbidden(`${perm} at ${shopId}`, 'scope');
  if (!can(access, perm, shopId)) throw forbidden(perm);
}

export function has(c: Context<AppEnv>, perm: string, shopId?: string | null): boolean {
  return can(orgOf(c).access, perm, shopId);
}

// shop ids to look at: the asked one (checked) or every shop where perm is held
export function shopsFor(c: Context<AppEnv>, perm: string, asked?: string | null): string[] {
  const { access } = orgOf(c);
  if (asked) {
    need(c, perm, asked);
    return [asked];
  }
  return access.shops.filter((s) => s.perms.includes(perm)).map((s) => s.shopId);
}

// does the member hold perm through an org scoped role (sees everything in the org)
export function orgWide(c: Context<AppEnv>, perm: string): boolean {
  return orgOf(c).assignments.some((a) => a.scopeType === 'org' && a.permissions.includes(perm));
}
