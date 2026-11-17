import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ROLES, roleTemplate, buildOrgAccess, can, canEditRole, canGrantRole, canManageMember,
  checkOwnersAfter, effectiveAtShop, followsShop, grantableRoles, PERMISSIONS, type AccessAssignment, type Topology,
} from '../src/index';

const topo: Topology = { orgId: 'o1', shops: ['kif', 'mar', 'gly'], groups: { north: ['kif', 'mar'] } };

function assign(role: 'owner' | 'admin' | 'manager' | 'staff' | 'viewer', scopeType: 'org' | 'group' | 'shop', scopeId: string): AccessAssignment {
  const t = roleTemplate(role);
  return { roleId: role, rank: t.rank, permissions: t.permissions, scopeType, scopeId };
}

const owner = { userId: 'eleni', assignments: [assign('owner', 'org', 'o1')] };
const admin = { userId: 'nikos', assignments: [assign('admin', 'org', 'o1')] };
const managerKif = { userId: 'maria', assignments: [assign('manager', 'shop', 'kif')] };
const managerKif2 = { userId: 'petros', assignments: [assign('manager', 'shop', 'kif')] };
const staff = roleTemplate('staff');
const manager = roleTemplate('manager');
const kif = { scopeType: 'shop' as const, scopeId: 'kif' };

describe('permission catalog', () => {
  it('has every key once', () => {
    const keys = PERMISSIONS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain('offers.price.set');
  });
  it('owner has everything, admin all but billing and support access', () => {
    expect(roleTemplate('owner').permissions.length).toBe(PERMISSIONS.length);
    const adminPerms = roleTemplate('admin').permissions;
    expect(adminPerms).not.toContain('org.billing.manage');
    expect(adminPerms).not.toContain('org.support_access.manage');
    expect(adminPerms.length).toBe(PERMISSIONS.length - 2);
  });
  it('default ranks', () => {
    expect(DEFAULT_ROLES.map((r) => r.rank)).toEqual([100, 80, 60, 40, 20]);
  });
});

describe('effective permissions', () => {
  it('org level permissions do not count from a shop assignment', () => {
    const odd: AccessAssignment = { roleId: 'x', rank: 60, permissions: ['shops.create', 'stock.adjust'], scopeType: 'shop', scopeId: 'kif' };
    const eff = effectiveAtShop([odd], topo, 'kif');
    expect(eff.perms.has('stock.adjust')).toBe(true);
    expect(eff.perms.has('shops.create')).toBe(false);
  });
  it('a group role covers its shops only', () => {
    const g = [assign('manager', 'group', 'north')];
    expect(effectiveAtShop(g, topo, 'mar').perms.has('stock.adjust')).toBe(true);
    expect(effectiveAtShop(g, topo, 'gly').perms.size).toBe(0);
  });
  it('builds org access for a shop manager', () => {
    const access = buildOrgAccess({
      org: { id: 'o1', name: 'Lemoni', slug: 'lemoni', currency: 'EUR', timezone: 'Europe/Athens', defaultLocale: 'el' },
      roleNames: ['manager'], permsVersion: 3, assignments: managerKif.assignments, topology: topo,
      shopNames: { kif: 'Kifisia', mar: 'Marousi', gly: 'Glyfada' },
    });
    expect(access.shops.map((s) => s.shopId)).toEqual(['kif']);
    expect(access.orgPerms).toEqual([]);
    expect(can(access, 'stock.adjust', 'kif')).toBe(true);
    expect(can(access, 'stock.adjust', 'mar')).toBe(false);
    expect(can(access, 'products.create')).toBe(true);
    expect(can(access, 'products.cost.view')).toBe(false);
    expect(can(access, 'org.settings.manage')).toBe(false);
    expect(can(access, 'not.a.perm')).toBe(false);
  });
  it('mixed roles add up per shop', () => {
    const maria = [assign('manager', 'shop', 'kif'), assign('staff', 'shop', 'mar')];
    expect(effectiveAtShop(maria, topo, 'kif').rank).toBe(60);
    expect(effectiveAtShop(maria, topo, 'mar').rank).toBe(40);
    expect(effectiveAtShop(maria, topo, 'mar').perms.has('stock.adjust')).toBe(false);
  });
});

describe('delegation examples from thinking/02', () => {
  it('manager of Kifisia invites staff at Kifisia: ok', () => {
    expect(canGrantRole({ actor: managerKif, topology: topo, role: staff, scope: kif })).toEqual({ ok: true });
  });
  it('manager of Kifisia invites staff at Marousi: scope', () => {
    expect(canGrantRole({ actor: managerKif, topology: topo, role: staff, scope: { scopeType: 'shop', scopeId: 'mar' } })).toEqual({ ok: false, code: 'scope' });
  });
  it('manager of Kifisia invites a manager at Kifisia: rank', () => {
    expect(canGrantRole({ actor: managerKif, topology: topo, role: manager, scope: kif })).toEqual({ ok: false, code: 'rank' });
  });
  it('manager gives staff customers.export: ceiling', () => {
    const role = { rank: 40, permissions: [...staff.permissions, 'customers.export'] };
    expect(canGrantRole({ actor: managerKif, topology: topo, role, scope: kif })).toEqual({ ok: false, code: 'ceiling' });
  });
  it('manager of Kifisia removes another manager of Kifisia: rank', () => {
    expect(canManageMember({ actor: managerKif, topology: topo, target: managerKif2, scope: kif })).toEqual({ ok: false, code: 'rank' });
  });
  it('admin makes a custom role senior staff with rank 50: ok', () => {
    const role = { rank: 50, permissions: [...staff.permissions, 'stock.adjust'] };
    expect(canEditRole({ actor: admin, topology: topo, role })).toEqual({ ok: true });
  });
  it('admin changes the owner: rank', () => {
    expect(canManageMember({ actor: admin, topology: topo, target: owner, scope: { scopeType: 'org', scopeId: 'o1' } })).toEqual({ ok: false, code: 'rank' });
  });
  it('admin removes themselves: self', () => {
    expect(canManageMember({ actor: admin, topology: topo, target: admin, scope: { scopeType: 'org', scopeId: 'o1' } })).toEqual({ ok: false, code: 'self' });
  });
  it('admin manages a shop manager: ok', () => {
    expect(canManageMember({ actor: admin, topology: topo, target: managerKif, scope: kif })).toEqual({ ok: true });
  });
  it('nobody can grant the locked owner role', () => {
    expect(canGrantRole({ actor: owner, topology: topo, role: roleTemplate('owner'), scope: { scopeType: 'org', scopeId: 'o1' } }).ok).toBe(false);
  });
  it('staff cannot invite at all: forbidden', () => {
    const s = { userId: 'dimitris', assignments: [assign('staff', 'shop', 'kif')] };
    expect(canGrantRole({ actor: s, topology: topo, role: roleTemplate('viewer'), scope: kif })).toEqual({ ok: false, code: 'forbidden' });
  });
  it('custom role above your rank or with perms you lack is refused', () => {
    expect(canEditRole({ actor: admin, topology: topo, role: { rank: 90, permissions: [] } })).toEqual({ ok: false, code: 'rank' });
    expect(canEditRole({ actor: admin, topology: topo, role: { rank: 50, permissions: ['org.billing.manage'] } })).toEqual({ ok: false, code: 'ceiling' });
    expect(canEditRole({ actor: managerKif, topology: topo, role: { rank: 10, permissions: [] } })).toEqual({ ok: false, code: 'forbidden' });
  });
  it('the last owner stays', () => {
    expect(checkOwnersAfter([])).toEqual({ ok: false, code: 'last_owner' });
    expect(checkOwnersAfter(['eleni'])).toEqual({ ok: true });
  });
  it('lists grantable roles with reasons', () => {
    const roles = DEFAULT_ROLES.map((r) => ({ id: r.key, name: r.key, rank: r.rank, permissions: r.permissions, locked: r.locked }));
    const list = grantableRoles({ actor: managerKif, topology: topo, scope: kif, roles });
    const byId = Object.fromEntries(list.map((r) => [r.roleId, r]));
    expect(byId.staff!.ok).toBe(true);
    expect(byId.manager!.blockedBy).toBe('rank');
    expect(byId.admin!.ok).toBe(false);
    // viewer includes products.cost.view, which managers do not hold
    expect(byId.viewer!.blockedBy).toBe('ceiling');
  });
});

describe('subscriptions: most specific wins', () => {
  const s = (scopeType: 'org' | 'group' | 'shop', scopeId: string, status: 'subscribed' | 'unsubscribed' | 'pending' = 'subscribed') => ({ scopeType, scopeId, status });
  it('org subscribed follows Kifisia', () => expect(followsShop([s('org', 'o1')], topo, 'kif')).toBe(true));
  it('org subscribed, shop unsubscribed', () => expect(followsShop([s('org', 'o1'), s('shop', 'kif', 'unsubscribed')], topo, 'kif')).toBe(false));
  it('group subscribed follows Kifisia', () => expect(followsShop([s('group', 'north')], topo, 'kif')).toBe(true));
  it('group subscribed, shop unsubscribed', () => expect(followsShop([s('group', 'north'), s('shop', 'kif', 'unsubscribed')], topo, 'kif')).toBe(false));
  it('shop subscribed, org unsubscribed', () => {
    const subs = [s('shop', 'kif'), s('org', 'o1', 'unsubscribed')];
    expect(followsShop(subs, topo, 'kif')).toBe(true);
    expect(followsShop(subs, topo, 'gly')).toBe(false);
  });
  it('pending only counts when asked', () => {
    expect(followsShop([s('shop', 'kif', 'pending')], topo, 'kif')).toBe(false);
    expect(followsShop([s('shop', 'kif', 'pending')], topo, 'kif', true)).toBe(true);
  });
});
