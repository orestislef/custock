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
import { isSuperadmin, orgFlags, orgFull, platformAssignment } from './platform-access';

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
  const assignments = rows.map((r) => {
    let list = byRole.get(r.role_id) ?? [];
    // "posts need approval" takes publishing away from everyone below admin
    if (org.posts_need_approval && r.rank < 80) list = list.filter((p) => p !== 'posts.publish');
    return { id: r.id, roleId: r.role_id, rank: r.rank, permissions: list, scopeType: r.scope_type, scopeId: r.scope_id };
  });
  return { assignments, roleNames: [...new Set(rows.map((r) => r.template_key ?? r.name))] };
}

export const ORG_COLUMNS = `id, name, slug, country, currency, timezone, default_locale, logo_file_id, brand_color,
  allow_negative_stock, posts_need_approval, push_daily_cap, quiet_hours, customer_catalog, customer_prices,
  customer_stock, few_left_threshold`;

export function buildContextFor(db: Db, orgId: string, userId: string): OrgContext | null {
  const p = platform(db);
  const org = p.get<OrgRow>(`SELECT ${ORG_COLUMNS} FROM organizations WHERE id = @id AND archived_at IS NULL`, { id: orgId });
  if (!org) return null;
  const t = new Tenant(db, org.id);
  const m = t.get<{ id: string; perms_version: number }>(
    "SELECT id, perms_version FROM memberships WHERE org_id = @org AND user_id = @u AND status = 'active'",
    { u: userId },
  );
  // a super admin has every permission in every business, member or not (lib/platform-access.ts)
  const superadmin = isSuperadmin(db, userId);
  if (!m && !superadmin) return null;
  const { topology, shopNames, groupNames } = loadTopology(db, org.id);
  const member = m ? loadAssignments(t, m.id, org) : { assignments: [], roleNames: [] as string[] };
  const assignments = superadmin ? [...member.assignments, platformAssignment(org.id)] : member.assignments;
  const viaPlatform = superadmin && !m;
  t.viaPlatform = viaPlatform;
  const permsVersion = m?.perms_version ?? 1;
  const flags = orgFlags(db, org.id);
  const access = {
    ...buildOrgAccess({
      org: { id: org.id, name: org.name, slug: org.slug, currency: org.currency, timezone: org.timezone, defaultLocale: org.default_locale },
      roleNames: viaPlatform ? ['superadmin'] : member.roleNames,
      permsVersion,
      assignments,
      topology,
      shopNames,
    }),
    ...(viaPlatform ? { platformAccess: true } : {}),
    ...(flags?.status === 'suspended' ? { suspended: true } : {}),
    ...(flags?.disabledFeatures.length ? { disabledFeatures: [...flags.disabledFeatures] } : {}),
    ...Object.fromEntries(Object.entries(orgFull(db, org.id, flags)).filter(([, full]) => full)),
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
