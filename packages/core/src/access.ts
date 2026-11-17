// the access engine from thinking/02-tenancy-and-roles.md.
// scopes: org covers every shop, a group covers its shops, a shop covers itself.
// org level permissions only count from org scope, any level from any scope.

import type { ErrorCode, Locale, OrgAccess, ScopeType, ShopAccess, Subscription } from './contract';
import { permLevel } from './permissions';

export interface Topology {
  orgId: string;
  shops: readonly string[];
  groups: Readonly<Record<string, readonly string[]>>; // group id -> shop ids
}

export interface Scope {
  scopeType: ScopeType;
  scopeId: string;
}

export interface AccessAssignment extends Scope {
  id?: string;
  roleId: string;
  rank: number;
  permissions: readonly string[];
}

export interface Effective {
  perms: Set<string>;
  rank: number;
}

export function shopsInScope(topo: Topology, scope: Scope): string[] {
  if (scope.scopeType === 'org') return scope.scopeId === topo.orgId ? [...topo.shops] : [];
  if (scope.scopeType === 'group') return [...(topo.groups[scope.scopeId] ?? [])];
  return topo.shops.includes(scope.scopeId) ? [scope.scopeId] : [];
}

// does scope `outer` contain scope `inner`?
export function scopeContains(topo: Topology, outer: Scope, inner: Scope): boolean {
  if (outer.scopeType === 'org') return outer.scopeId === topo.orgId;
  if (outer.scopeType === inner.scopeType) return outer.scopeId === inner.scopeId;
  if (outer.scopeType === 'group' && inner.scopeType === 'shop') {
    return (topo.groups[outer.scopeId] ?? []).includes(inner.scopeId);
  }
  return false;
}

function permsFrom(a: AccessAssignment): string[] {
  return a.permissions.filter((p) => permLevel(p) !== 'org' || a.scopeType === 'org');
}

// effective permissions and rank at a scope: every assignment whose scope contains it
export function effectiveAtScope(assignments: readonly AccessAssignment[], topo: Topology, scope: Scope): Effective {
  const perms = new Set<string>();
  let rank = 0;
  for (const a of assignments) {
    if (!scopeContains(topo, a, scope)) continue;
    for (const p of permsFrom(a)) perms.add(p);
    rank = Math.max(rank, a.rank);
  }
  return { perms, rank };
}

export function effectiveAtShop(assignments: readonly AccessAssignment[], topo: Topology, shopId: string): Effective {
  return effectiveAtScope(assignments, topo, { scopeType: 'shop', scopeId: shopId });
}

export interface OrgAccessInput {
  org: { id: string; name: string; slug: string; currency: string; timezone: string; defaultLocale: Locale };
  roleNames: string[];
  permsVersion: number;
  assignments: readonly AccessAssignment[];
  topology: Topology;
  shopNames: Readonly<Record<string, string>>;
}

export function buildOrgAccess(input: OrgAccessInput): OrgAccess {
  const { assignments, topology } = input;
  const orgPerms = new Set<string>();
  const anyPerms = new Set<string>();
  for (const a of assignments) {
    for (const p of a.permissions) {
      const level = permLevel(p);
      if (level === 'org' && a.scopeType === 'org') orgPerms.add(p);
      if (level === 'any') anyPerms.add(p);
    }
  }
  const shops: ShopAccess[] = [];
  for (const shopId of topology.shops) {
    const eff = effectiveAtShop(assignments, topology, shopId);
    const shopPerms = [...eff.perms].filter((p) => permLevel(p) === 'shop');
    if (eff.rank === 0) continue;
    shops.push({ shopId, name: input.shopNames[shopId] ?? shopId, perms: shopPerms.sort(), rank: eff.rank });
  }
  return {
    orgId: input.org.id,
    name: input.org.name,
    slug: input.org.slug,
    currency: input.org.currency,
    timezone: input.org.timezone,
    defaultLocale: input.org.defaultLocale,
    roleNames: input.roleNames,
    orgPerms: [...orgPerms].sort(),
    anyPerms: [...anyPerms].sort(),
    shops,
    permsVersion: input.permsVersion,
  };
}

// can the member do `perm`? shop level permissions need the shop, or any shop when none is given.
export function can(access: Pick<OrgAccess, 'orgPerms' | 'anyPerms' | 'shops'>, perm: string, shopId?: string | null): boolean {
  const level = permLevel(perm);
  if (!level) return false;
  if (level === 'org') return access.orgPerms.includes(perm);
  if (level === 'any') return access.anyPerms.includes(perm);
  if (shopId) return access.shops.some((s) => s.shopId === shopId && s.perms.includes(perm));
  return access.shops.some((s) => s.perms.includes(perm));
}

// shops where the member holds `perm`
export function shopsWith(access: Pick<OrgAccess, 'shops'>, perm: string): string[] {
  return access.shops.filter((s) => s.perms.includes(perm)).map((s) => s.shopId);
}

export function rankAt(access: Pick<OrgAccess, 'shops'>, shopId: string): number {
  return access.shops.find((s) => s.shopId === shopId)?.rank ?? 0;
}

// ---------------------------------------------------------------- delegation

export type CheckResult = { ok: true } | { ok: false; code: ErrorCode };
const ok: CheckResult = { ok: true };
const no = (code: ErrorCode): CheckResult => ({ ok: false, code });

export interface Actor {
  userId: string;
  assignments: readonly AccessAssignment[];
}

export interface RoleLike {
  rank: number;
  permissions: readonly string[];
  locked?: boolean;
}

function holdsAnywhere(assignments: readonly AccessAssignment[], perm: string): boolean {
  return assignments.some((a) => permsFrom(a).includes(perm));
}

// can the actor give `role` at `scope` to `targetUserId`? via members.invite for new people,
// members.manage for existing members.
export function canGrantRole(args: {
  actor: Actor;
  topology: Topology;
  role: RoleLike;
  scope: Scope;
  targetUserId?: string | null;
  via?: 'members.invite' | 'members.manage';
}): CheckResult {
  const { actor, topology, role, scope } = args;
  const via = args.via ?? 'members.invite';
  if (args.targetUserId && args.targetUserId === actor.userId) return no('self');
  if (role.locked) return no('rank');
  const eff = effectiveAtScope(actor.assignments, topology, scope);
  if (!eff.perms.has(via)) return holdsAnywhere(actor.assignments, via) ? no('scope') : no('forbidden');
  // rank first: "you can give roles below manager" says more than a missing permission
  if (role.rank >= eff.rank) return no('rank');
  for (const p of role.permissions) {
    const held = permLevel(p) === 'org' ? orgPermHeld(actor, topology, p) : eff.perms.has(p);
    if (!held) return no('ceiling');
  }
  return ok;
}

// org level permissions inside a role given at a shop do nothing there, but the actor still has to
// hold them at org scope to hand them out
function orgPermHeld(actor: Actor, topology: Topology, perm: string): boolean {
  return effectiveAtScope(actor.assignments, topology, { scopeType: 'org', scopeId: topology.orgId }).perms.has(perm);
}

// can the actor change or remove the target's access at `scope`?
export function canManageMember(args: {
  actor: Actor;
  topology: Topology;
  target: { userId: string; assignments: readonly AccessAssignment[] };
  scope: Scope;
}): CheckResult {
  const { actor, topology, target, scope } = args;
  if (target.userId === actor.userId) return no('self');
  const eff = effectiveAtScope(actor.assignments, topology, scope);
  if (!eff.perms.has('members.manage')) {
    return holdsAnywhere(actor.assignments, 'members.manage') ? no('scope') : no('forbidden');
  }
  const targetRank = maxRankTouching(target.assignments, topology, scope);
  if (targetRank >= eff.rank) return no('rank');
  return ok;
}

// the target's highest rank on anything that overlaps the scope
function maxRankTouching(assignments: readonly AccessAssignment[], topology: Topology, scope: Scope): number {
  const shops = new Set(shopsInScope(topology, scope));
  let rank = 0;
  for (const a of assignments) {
    const overlaps =
      scopeContains(topology, a, scope) ||
      scopeContains(topology, scope, a) ||
      shopsInScope(topology, a).some((s) => shops.has(s));
    if (overlaps) rank = Math.max(rank, a.rank);
  }
  return rank;
}

// can the actor create or edit a role? needs roles.manage at org scope, ceiling and rank.
export function canEditRole(args: { actor: Actor; topology: Topology; role: RoleLike; existing?: RoleLike | null }): CheckResult {
  const { actor, topology, role, existing } = args;
  const eff = effectiveAtScope(actor.assignments, topology, { scopeType: 'org', scopeId: topology.orgId });
  if (!eff.perms.has('roles.manage')) return no('forbidden');
  if (existing?.locked || role.locked) return no('rank');
  if (existing) {
    if (existing.rank >= eff.rank) return no('rank');
    if (existing.permissions.some((p) => !eff.perms.has(p))) return no('ceiling');
  }
  if (role.permissions.some((p) => !eff.perms.has(p))) return no('ceiling');
  if (role.rank >= eff.rank) return no('rank');
  return ok;
}

// refuses any change that leaves the org without an owner
export function checkOwnersAfter(ownerUserIdsAfter: readonly string[]): CheckResult {
  return ownerUserIdsAfter.length > 0 ? ok : no('last_owner');
}

export interface GrantableRoleResult {
  roleId: string;
  name: string;
  rank: number;
  ok: boolean;
  blockedBy: ErrorCode | null;
}

export function grantableRoles(args: {
  actor: Actor;
  topology: Topology;
  scope: Scope;
  roles: readonly (RoleLike & { id: string; name: string })[];
  via?: 'members.invite' | 'members.manage';
}): GrantableRoleResult[] {
  return [...args.roles]
    .sort((a, b) => b.rank - a.rank)
    .map((r) => {
      const res = canGrantRole({ actor: args.actor, topology: args.topology, role: r, scope: args.scope, via: args.via ?? 'members.invite' });
      return { roleId: r.id, name: r.name, rank: r.rank, ok: res.ok, blockedBy: res.ok ? null : res.code };
    });
}

// ---------------------------------------------------------------- subscriptions

// most specific row wins: shop, then group, then org. pending counts as not following yet,
// unless includePending is set (used for staff visibility of new signups).
export function followsShop(
  subs: readonly Subscription[],
  topology: Topology,
  shopId: string,
  includePending = false,
): boolean {
  const on = (s: Subscription) => s.status === 'subscribed' || (includePending && s.status === 'pending');
  const shopRow = subs.find((s) => s.scopeType === 'shop' && s.scopeId === shopId);
  if (shopRow) return on(shopRow);
  const groupRows = subs.filter((s) => s.scopeType === 'group' && (topology.groups[s.scopeId] ?? []).includes(shopId));
  if (groupRows.length) return groupRows.some(on);
  const orgRow = subs.find((s) => s.scopeType === 'org' && s.scopeId === topology.orgId);
  return orgRow ? on(orgRow) : false;
}

export function followedShops(subs: readonly Subscription[], topology: Topology, includePending = false): string[] {
  return topology.shops.filter((s) => followsShop(subs, topology, s, includePending));
}
