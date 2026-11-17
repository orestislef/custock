// the demo data follows the same rules as the server. these tests keep it honest.

import { uuidv7 } from '@custock/core';
import { describe, expect, it } from 'vitest';

import { createFixtureApi, FIXTURE_OTP } from '../src/lib/fixtures';

const KIF = 'shop_kifisia';
const ORG = 'org_lemoni';

function as(email: string, password = 'custock') {
  let token: string | null = null;
  const api = createFixtureApi(() => token, () => 'en');
  return {
    api,
    async signIn() {
      const t = email.startsWith('anna') ? await api.verifyOtp(email, FIXTURE_OTP) : await api.login(email, password);
      token = t.accessToken;
      return api;
    },
  };
}

describe('demo data rules', () => {
  it('refuses a wrong password', async () => {
    await expect(as('maria@example.com', 'nope').signIn()).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('gives staff no adjust and no cost', async () => {
    const api = await as('dimitris@example.com').signIn();
    const res = await api.postMovements(ORG, [{ id: uuidv7(), shopId: KIF, variantId: 'var_oil_0', qtyDelta: -1, kind: 'adjust', reason: 'lost', occurredAt: Date.now() }]);
    expect(res.rejected).toEqual([expect.objectContaining({ code: 'forbidden' })]);
    const p = await api.product(ORG, 'prod_oil');
    expect(p.variants[0]!.costMinor).toBeUndefined();
  });

  it('masks customer contacts for staff and shows them to managers', async () => {
    const staff = await as('dimitris@example.com').signIn();
    const manager = await as('maria@example.com').signIn();
    const a = (await staff.customers(ORG)).items[0]!;
    const b = (await manager.customers(ORG)).items.find((c) => c.id === a.id)!;
    expect(a.contactMasked).toBe(true);
    expect(a.email).toContain('***');
    expect(b.contactMasked).toBe(false);
    expect(b.email).not.toContain('***');
  });

  it('tells the people waiting when the honey is received, once', async () => {
    const api = await as('maria@example.com').signIn();
    const first = await api.postMovements(ORG, [{ id: uuidv7(), shopId: KIF, variantId: 'var_honey_0', qtyDelta: 6, kind: 'receive', occurredAt: Date.now() }]);
    expect(first.backInStock).toEqual([{ variantId: 'var_honey_0', shopId: KIF, notified: 14 }]);
    await api.postMovements(ORG, [{ id: uuidv7(), shopId: KIF, variantId: 'var_honey_0', qtyDelta: -6, kind: 'sale', occurredAt: Date.now() }]);
    const again = await api.postMovements(ORG, [{ id: uuidv7(), shopId: KIF, variantId: 'var_honey_0', qtyDelta: 2, kind: 'receive', occurredAt: Date.now() }]);
    expect(again.backInStock).toEqual([]);
  });

  it('treats a repeated movement id as a duplicate', async () => {
    const api = await as('dimitris@example.com').signIn();
    const m = { id: uuidv7(), shopId: KIF, variantId: 'var_coffee_0', qtyDelta: -1, kind: 'sale' as const, occurredAt: Date.now() };
    const one = await api.postMovements(ORG, [m]);
    const two = await api.postMovements(ORG, [m]);
    expect(one.accepted).toEqual([m.id]);
    expect(two.duplicates).toEqual([m.id]);
  });

  it('sends a manager post for approval when the business asks for it', async () => {
    const owner = await as('eleni@example.com').signIn();
    const manager = await as('maria@example.com').signIn();
    await owner.updateOrgSettings(ORG, { postsNeedApproval: true });
    const audience = { scopes: [{ scopeType: 'shop' as const, scopeId: KIF }], tags: [], interests: [], locales: [], savedAnyLinked: false, joinedWithinDays: null };
    const draft = await manager.createPost(ORG, { kind: 'news', defaultLocale: 'el', translations: { el: { title: 'Νέο', body: 'κείμενο' } } as never, channels: ['feed'], audience, products: [], coverUrl: null, scheduledAt: null, validFrom: null, validUntil: null });
    const res = await manager.publishPost(ORG, draft.id);
    expect(res.status).toBe('pending_approval');
    await owner.updateOrgSettings(ORG, { postsNeedApproval: false });
    const draft2 = await manager.createPost(ORG, { kind: 'news', defaultLocale: 'el', translations: { el: { title: 'Νέο 2', body: '' } } as never, channels: ['feed'], audience, products: [], coverUrl: null, scheduledAt: null, validFrom: null, validUntil: null });
    expect((await manager.publishPost(ORG, draft2.id)).status).toBe('sent');
  });

  it('shows customers only the stock the merchant allows', async () => {
    const owner = await as('eleni@example.com').signIn();
    const anna = await as('anna@example.com').signIn();
    await owner.updateOrgSettings(ORG, { customerStock: 'off' });
    const off = await anna.publicProduct('lemoni', 'prod_oil');
    expect(off.availability.every((a) => a.state === null && a.qty === null)).toBe(true);
    await owner.updateOrgSettings(ORG, { customerStock: 'exact' });
    const exact = await anna.publicProduct('lemoni', 'prod_oil');
    expect(exact.availability.some((a) => typeof a.qty === 'number')).toBe(true);
    await owner.updateOrgSettings(ORG, { customerStock: 'availability', customerPrices: false });
    const noPrice = await anna.publicProduct('lemoni', 'prod_oil');
    expect(noPrice.priceMinor).toBeNull();
    await owner.updateOrgSettings(ORG, { customerPrices: true });
  });

  it('lets a manager invite staff but not another manager', async () => {
    const manager = await as('maria@example.com').signIn();
    const roles = await manager.grantableRoles(ORG, 'shop', KIF);
    expect(roles.find((r) => r.roleId === 'role_staff')?.ok).toBe(true);
    expect(roles.find((r) => r.roleId === 'role_manager')).toMatchObject({ ok: false, blockedBy: 'rank' });
  });

  it('runs a count: staff count, the manager applies the difference', async () => {
    const staff = await as('dimitris@example.com').signIn();
    const manager = await as('maria@example.com').signIn();
    const before = (await manager.product(ORG, 'prod_salt')).levels.find((l) => l.shopId === KIF)!.onHand;
    const count = await staff.startCount(ORG, KIF, { kind: 'partial' });
    await staff.setCountLine(ORG, count.id, 'var_salt_0', before - 2, 'set');
    await staff.submitCount(ORG, count.id);
    await expect(staff.applyCount(ORG, count.id)).rejects.toMatchObject({ code: 'forbidden' });
    await manager.applyCount(ORG, count.id);
    const after = (await manager.product(ORG, 'prod_salt')).levels.find((l) => l.shopId === KIF)!.onHand;
    expect(after).toBe(before - 2);
  });
});
