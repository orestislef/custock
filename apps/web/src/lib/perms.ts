import { can as coreCan, PERMISSIONS, PERMISSION_KEYS, type OrgAccess } from '@custock/core';

// the ui side of permissions. the server always decides, this only hides and explains.
export function can(org: OrgAccess | null | undefined, perm: string, shopId?: string | null): boolean {
  if (!org) return false;
  return coreCan(org, perm, shopId ?? null);
}

export function rankAt(org: OrgAccess, shopId?: string | null): number {
  if (shopId) return org.shops.find((s) => s.shopId === shopId)?.rank ?? 0;
  return Math.max(0, ...org.shops.map((s) => s.rank));
}

export function shopsWith(org: OrgAccess, perm: string) {
  return org.shops.filter((s) => coreCan(org, perm, s.shopId));
}

export const ALL_PERMISSIONS = PERMISSION_KEYS;

const GROUP_ORDER = ['org', 'team', 'catalog', 'prices', 'stock', 'customers', 'comms', 'reports'] as const;

export const PERM_GROUPS: { group: string; perms: string[] }[] = GROUP_ORDER.map((group) => ({
  group,
  perms: PERMISSIONS.filter((p) => p.group === group).map((p) => p.key),
})).filter((g) => g.perms.length > 0);
