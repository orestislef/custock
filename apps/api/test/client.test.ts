// the shared fetch client against the real app: every path the web and the phone use must exist

import { beforeAll, describe, expect, it } from 'vitest';
import { migrate, openDb, seed, hashPassword, type Db, type SeedResult } from '@custock/db';
import { ApiError, createApiClient, uuidv7, type CustockApi } from '@custock/core';
import { createApp, type App } from '../src/app';

let db: Db;
let s: SeedResult;
let app: App;
const tokens: Record<string, string | null> = {};
let who = 'eleni';

function client(): CustockApi {
  return createApiClient({
    baseUrl: 'http://api.test',
    getAccessToken: () => tokens[who],
    getLocale: () => 'el',
    fetch: ((url: string, init?: RequestInit) => app.request(url.replace('http://api.test', ''), init)) as typeof fetch,
  });
}

beforeAll(async () => {
  db = openDb(':memory:');
  migrate(db);
  s = seed(db, { passwordHash: hashPassword('custock') });
  app = createApp({ db, dev: true, jwtSecret: 'client-test-secret-long-enough-789', publicWebUrl: 'http://localhost:3000', corsOrigins: [], rateLimit: false });
  for (const name of ['eleni', 'maria', 'dimitris', 'anna']) {
    tokens[name] = null;
    const t = await client().login(`${name}@example.com`, 'custock');
    tokens[name] = t.accessToken;
  }
});

const as = (name: string) => {
  who = name;
  return client();
};

describe('client paths', () => {
  it('reads', async () => {
    const api = as('eleni');
    const me = await api.me();
    const orgId = me.orgs[0]!.orgId;
    expect((await api.orgSettings(orgId)).slug).toBe('lemoni');
    expect(await api.shops(orgId)).toHaveLength(3);
    expect(await api.groups(orgId)).toHaveLength(1);
    expect((await api.categories(orgId)).length).toBeGreaterThan(0);
    expect((await api.products(orgId, { q: 'meli' })).items.length).toBeGreaterThan(0);
    expect((await api.product(orgId, s.products['p-olive-oil']!)).id).toBe(s.products['p-olive-oil']);
    expect((await api.scan(orgId, 'nothing-here', undefined, s.shops.kifisia)).match).toBe('unknown');
    expect((await api.unknownScans(orgId)).length).toBeGreaterThan(0);
    expect((await api.movements(orgId, { limit: 3 })).items).toHaveLength(3);
    expect((await api.customers(orgId)).items.length).toBeGreaterThan(0);
    expect((await api.joinLinks(orgId)).length).toBe(6);
    expect((await api.posts(orgId)).items.length).toBeGreaterThan(0);
    expect((await api.post(orgId, s.posts.offer)).kind).toBe('offer');
    expect((await api.members(orgId)).length).toBeGreaterThan(0);
    expect((await api.roles(orgId)).length).toBe(5);
    expect((await api.grantableRoles(orgId, 'shop', s.shops.kifisia)).length).toBe(5);
    expect((await api.dashboard(orgId)).peopleWaiting).toBeGreaterThan(0);
    expect(await api.salesSeries(orgId, undefined, 7)).toHaveLength(7);
    expect((await api.topSellers(orgId)).length).toBeGreaterThan(0);
    expect((await api.mostWanted(orgId)).length).toBeGreaterThan(0);
    expect((await api.joinLinkStats(orgId)).length).toBe(6);
    expect(Array.isArray(await api.shrinkage(orgId))).toBe(true);
    expect((await api.counts(orgId)).length).toBe(0);
    expect((await api.transfers(orgId)).length).toBe(0);
    expect((await api.invites(orgId)).length).toBe(0);
    expect((await api.audit(orgId)).items.length).toBeGreaterThan(0);
    expect((await api.sync(orgId, s.shops.kifisia)).full).toBe(true);
    expect((await api.devOutbox(5)).length).toBeGreaterThanOrEqual(0);
  });

  it('writes', async () => {
    const api = as('eleni');
    const orgId = s.orgId;
    const product = await api.createProduct(orgId, { name: 'Ρίγανη', uom: 'piece', taxRateBp: 1300, trackStock: true, priceMinor: 300 });
    await api.updateProduct(orgId, product.id, { description: 'Από τον Ταΰγετο' });
    const { code } = await api.nextInternalBarcode(orgId);
    await api.attachBarcode(orgId, product.variants[0]!.id, code);
    await api.setBasePrice(orgId, product.variants[0]!.id, 320);
    await api.setShopPrice(orgId, s.shops.kifisia, product.variants[0]!.id, 310);
    await api.setShopVariantSettings(orgId, s.shops.kifisia, product.variants[0]!.id, { reorderPoint: 3 });
    const batch = await api.postMovements(orgId, [{ id: uuidv7(), shopId: s.shops.kifisia, variantId: product.variants[0]!.id, qtyDelta: 12, kind: 'receive', occurredAt: Date.now() }]);
    expect(batch.accepted).toHaveLength(1);
    const unknown = (await api.unknownScans(orgId))[0]!;
    await api.resolveUnknownScan(orgId, unknown.id, null);

    const count = await api.startCount(orgId, s.shops.kifisia, { kind: 'partial' });
    await api.setCountLine(orgId, count.id, product.variants[0]!.id, 11);
    await api.submitCount(orgId, count.id);
    expect((await api.applyCount(orgId, count.id)).status).toBe('applied');
    const count2 = await api.startCount(orgId, s.shops.marousi, { kind: 'partial' });
    expect((await api.cancelCount(orgId, count2.id)).status).toBe('cancelled');
    expect((await api.stockCount(orgId, count.id)).lines).toHaveLength(1);

    const tr = await api.createTransfer(orgId, { fromShopId: s.shops.kifisia, toShopId: s.shops.marousi, lines: [{ variantId: product.variants[0]!.id, qty: 2 }] });
    await api.sendTransfer(orgId, tr.id);
    expect((await api.receiveTransfer(orgId, tr.id, [])).status).toBe('received');
    expect((await api.transfer(orgId, tr.id)).lines[0]!.lost).toBe(0);
    const tr2 = await api.createTransfer(orgId, { fromShopId: s.shops.kifisia, toShopId: s.shops.marousi, lines: [{ variantId: product.variants[0]!.id, qty: 1 }] });
    expect((await api.cancelTransfer(orgId, tr2.id)).status).toBe('cancelled');

    const customer = await api.addCustomer(orgId, { name: 'Νίκη', email: 'niki@example.com', locale: 'el', shopId: s.shops.kifisia, emailNews: false, push: false, tags: ['vip'] });
    await api.addCustomerNote(orgId, customer.id, 'Θέλει ρίγανη');
    await api.setCustomerTags(orgId, customer.id, ['vip', 'τακτικοί']);
    expect((await api.customer(orgId, customer.id)).tags).toEqual(['vip', 'τακτικοί']);
    await api.eraseCustomer(orgId, customer.id);
    const link = await api.createJoinLink(orgId, { scopeType: 'shop', scopeId: s.shops.kifisia, label: 'Ταμείο' });
    expect((await api.updateJoinLink(orgId, link.id, { disabled: true })).disabled).toBe(true);

    const post = await api.createPost(orgId, {
      kind: 'news', defaultLocale: 'el', translations: { el: { title: 'Ρίγανη', body: 'Ήρθε' } }, channels: ['feed'],
      audience: { scopes: [{ scopeType: 'org', scopeId: orgId }], tags: [], interests: [], locales: [], savedAnyLinked: false, joinedWithinDays: null },
      products: [], coverUrl: null, scheduledAt: null, validFrom: null, validUntil: null,
    });
    await api.updatePost(orgId, post.id, {
      kind: 'news', defaultLocale: 'el', translations: { el: { title: 'Ρίγανη!', body: 'Ήρθε' } }, channels: ['feed'],
      audience: { scopes: [{ scopeType: 'org', scopeId: orgId }], tags: [], interests: [], locales: [], savedAnyLinked: false, joinedWithinDays: null },
      products: [], coverUrl: null, scheduledAt: null, validFrom: null, validUntil: null,
    });
    const preview = await api.previewAudience(orgId, post.audience, ['feed', 'push']);
    expect(preview.total).toBeGreaterThan(0);
    expect((await api.publishPost(orgId, post.id)).status).toBe('sending');
    expect((await api.devRunJobs()).ran).toBeGreaterThan(0);
    await api.deletePost(orgId, post.id);

    const role = await api.saveRole(orgId, { name: 'Ταμίας', rank: 30, permissions: ['products.view', 'stock.sell'] });
    expect((await api.roleImpact(orgId, role.id)).members).toBe(0);
    const inv = await api.invite(orgId, { email: 'cashier@example.com', roleId: role.id, scopeType: 'shop', scopeId: s.shops.kifisia, locale: 'el' });
    expect(inv.devLink).toContain('/invite/');
    await api.revokeInvite(orgId, inv.id);
    const members = await api.members(orgId);
    const dim = members.find((m) => m.userId === s.users.dimitris)!;
    await api.assignRole(orgId, dim.membershipId, { roleId: role.id, scopeType: 'shop', scopeId: s.shops.kifisia });
    const fresh = (await api.members(orgId)).find((m) => m.userId === s.users.dimitris)!;
    await api.removeAssignment(orgId, dim.membershipId, fresh.assignments.find((a) => a.roleId === role.id)!.id);
    await api.updateMember(orgId, dim.membershipId, { status: 'suspended' });
    await api.updateMember(orgId, dim.membershipId, { status: 'active' });
    expect((await api.updateOrgSettings(orgId, { customerCatalog: 'public' })).customerCatalog).toBe('public');
    expect((await api.updateShop(orgId, s.shops.glyfada, { city: 'Γλυφάδα Αττικής' })).city).toBe('Γλυφάδα Αττικής');
    await api.archiveProduct(orgId, product.id);
  });

  it('errors come back typed', async () => {
    const api = as('dimitris');
    try {
      await api.members(s.orgId);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).code).toBe('forbidden');
      expect((e as ApiError).status).toBe(403);
    }
  });

  it('customer side and public', async () => {
    const api = as('anna');
    expect((await api.feed()).items.length).toBeGreaterThan(0);
    expect((await api.offers()).length).toBeGreaterThan(0);
    expect((await api.catalog('lemoni')).length).toBeGreaterThan(0);
    expect((await api.publicProduct('lemoni', s.products['p-olive-oil']!)).id).toBe(s.products['p-olive-oil']);
    await api.notifyMe(s.variants['p-sea-salt']!, null);
    const alerts = await api.alerts();
    await api.cancelAlert(alerts.find((a) => a.status === 'waiting')!.id);
    await api.setFavorite(s.products['p-candle']!, true);
    expect((await api.favorites()).map((p) => p.id)).toContain(s.products['p-candle']);
    expect((await api.followedShops()).length).toBeGreaterThan(0);
    await api.unfollow('shop', s.shops.marousi);
    await api.follow('shop', s.shops.marousi);
    await api.setChannel(s.orgId, 'email', true);
    await api.updateMe({ locale: 'ru' });
    expect((await api.exportMyData()) as object).toHaveProperty('customerRecords');
    expect((await api.joinAsCustomer('nt5f1y')).scopeName).toBe('Lemoni North Athens');

    const pub = as('nobody');
    expect((await pub.joinPage('kif7q2')).orgName).toBe('Lemoni');
    const joined = await pub.join('kif7q2', { name: 'Τάνια', email: 'tania@example.com', locale: 'el', emailNews: true, push: false, over15: true, interests: [] });
    expect(joined.pending).toBe(true);
    const token = (joined as { devConfirmLink?: string }).devConfirmLink!.split('/confirm/')[1]!;
    expect((await pub.confirmJoin(token)).orgName).toBe('Lemoni');
    const olive = db.prepare('SELECT code FROM barcodes WHERE variant_id = ? LIMIT 1').get(s.variants['p-olive-oil']) as { code: string };
    expect((await pub.shelfProduct(olive.code)).name).toBeTruthy();
  });

  it('otp, refresh and logout', async () => {
    const pub = as('nobody');
    const { devCode } = await pub.requestOtp('otp.person@example.com', 'ru');
    const t = await pub.verifyOtp('otp.person@example.com', devCode!);
    const t2 = await pub.refresh(t.refreshToken);
    tokens.otp = t2.accessToken;
    const api = as('otp');
    expect((await api.me()).user.email).toBe('otp.person@example.com');
    await api.logout();
    await expect(api.me()).rejects.toBeInstanceOf(ApiError);
    tokens.del = (await pub.verifyOtp('otp.person@example.com', (await pub.requestOtp('otp.person@example.com')).devCode!)).accessToken;
    await as('del').deleteMyAccount();
  });
});
