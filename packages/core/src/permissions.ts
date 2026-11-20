// permission catalog and default roles, from thinking/03-permissions.md

import catalog from './permissions.json';

export type PermLevel = 'org' | 'shop' | 'any';
export type PermGroup = 'org' | 'team' | 'catalog' | 'prices' | 'stock' | 'customers' | 'orders' | 'comms' | 'reports';

export interface PermissionDef {
  key: string;
  level: PermLevel;
  group: PermGroup;
}

export const PERMISSIONS: readonly PermissionDef[] = catalog.permissions as PermissionDef[];
export const PERMISSION_KEYS: readonly string[] = PERMISSIONS.map((p) => p.key);
export type Permission = string;

const levelByKey = new Map(PERMISSIONS.map((p) => [p.key, p.level]));

export function permLevel(key: string): PermLevel | undefined {
  return levelByKey.get(key);
}

export function isPermission(key: string): boolean {
  return levelByKey.has(key);
}

export type RoleTemplateKey = 'owner' | 'admin' | 'manager' | 'staff' | 'viewer';

export interface RoleTemplate {
  key: RoleTemplateKey;
  rank: number;
  locked: boolean;
  permissions: readonly string[];
}

const ALL = PERMISSION_KEYS;

const ADMIN = ALL.filter((k) => k !== 'org.billing.manage' && k !== 'org.support_access.manage');

const MANAGER = [
  'members.view', 'members.invite', 'members.manage', 'shop.settings.manage',
  'products.view', 'products.create', 'products.edit',
  'prices.shop.edit',
  'stock.view', 'stock.history.view', 'stock.receive', 'stock.sell', 'stock.return', 'stock.adjust',
  'stock.count', 'stock.count.approve', 'stock.transfer.send', 'stock.transfer.receive', 'stock.settings.manage',
  'customers.view', 'customers.contact.view', 'customers.add', 'customers.edit',
  'posts.view', 'posts.create', 'posts.publish', 'posts.channel.push', 'posts.channel.email',
  'offers.price.set', 'joinlinks.manage',
  'orders.view', 'orders.quote', 'orders.fulfil',
  'reports.view', 'reports.staff.view',
];

const STAFF = [
  'products.view',
  'stock.view', 'stock.receive', 'stock.sell', 'stock.return', 'stock.count', 'stock.transfer.receive',
  'customers.view', 'customers.add',
  'orders.view', 'orders.fulfil',
  'posts.view',
];

const VIEWER = [
  'products.view', 'products.cost.view',
  'stock.view', 'stock.history.view',
  'customers.view',
  'orders.view',
  'posts.view',
  'reports.view', 'reports.financial.view',
];

export const DEFAULT_ROLES: readonly RoleTemplate[] = [
  { key: 'owner', rank: 100, locked: true, permissions: ALL },
  { key: 'admin', rank: 80, locked: false, permissions: ADMIN },
  { key: 'manager', rank: 60, locked: false, permissions: MANAGER },
  { key: 'staff', rank: 40, locked: false, permissions: STAFF },
  { key: 'viewer', rank: 20, locked: false, permissions: VIEWER },
];

export function roleTemplate(key: RoleTemplateKey): RoleTemplate {
  const t = DEFAULT_ROLES.find((r) => r.key === key);
  if (!t) throw new Error(`unknown role template ${key}`);
  return t;
}
