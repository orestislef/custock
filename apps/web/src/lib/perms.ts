import { can as coreCan, PERMISSIONS, PERMISSION_KEYS, type OrgAccess } from '@custock/core';

// the ui side of permissions. the server always decides, this only hides and explains.
// rights that belong to a feature the super admin switched off for the business are not offered
// at all, so no screen asks the api for something it will refuse (and nothing says why)
const FEATURE_OF: [prefix: string, feature: string][] = [
  ['posts.channel.email', 'email'], ['posts.channel.push', 'push'], ['posts.', 'posts'],
  ['stock.transfer.', 'transfers'], ['stock.count.', 'counts'], ['reports.', 'reports'], ['joinlinks.', 'customer_pages'],
];

export function featureOff(org: { disabledFeatures?: readonly string[] } | null | undefined, perm: string): boolean {
  const off = org?.disabledFeatures;
  if (!off?.length) return false;
  return FEATURE_OF.some(([prefix, feature]) => (perm === prefix || perm.startsWith(prefix)) && off.includes(feature));
}

export function can(org: OrgAccess | null | undefined, perm: string, shopId?: string | null): boolean {
  if (!org) return false;
  if (featureOff(org as { disabledFeatures?: readonly string[] }, perm)) return false;
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
