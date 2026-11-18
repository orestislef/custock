// edge cases from thinking/15 that are screen behaviour: a lost phone, who a role change reaches,
// an offer below cost, and stock work for a business someone no longer works for.

import { L, api, eq, expect, forget, go, lemoni, login, ok, one, open, see, seed, sleep, test } from '../lib.mjs';

test('edge', 'a lost phone: the account sheet signs out every other device, this one stays', async (t) => {
  const email = seed.managerGly;
  const other = await login(email, undefined, { fresh: true });
  const here = await login(email, undefined, { fresh: true });
  const page = await open(t, { device: 'phone', tokens: here });
  await go(page, '/admin');
  await page.getByRole('button', { name: L('admin.account') }).click();
  await see(page, L('admin.otherDevices'));
  await page.getByRole('button', { name: L('admin.signOutOthers') }).click();
  await see(page, L('admin.onlyThisDevice'));
  eq((await api('/v1/me/context', { token: other })).status, 401, 'the other device');
  eq((await api('/v1/me/context', { token: here })).status, 200, 'this device');
  // the cached sign in of this person was one of the others
  forget(email);
});

test('edge', 'the role editor names the people a change reaches', async (t) => {
  const l = await lemoni();
  const owner = await login(seed.owner);
  const roles = await ok(`/v1/orgs/${l.orgId}/roles`, { token: owner });
  const manager = roles.find((r) => r.templateKey === 'manager');
  const impact = await ok(`/v1/orgs/${l.orgId}/roles/${manager.id}/impact`, { token: owner });
  expect(impact.names.length > 0, 'people with the manager role', 'some', 'none');
  const page = await open(t, { tokens: owner });
  await go(page, `/admin/team/roles/${manager.id}`);
  await see(page, L('roles.affects', { count: manager.memberCount }));
  await see(page, impact.names[0]);
});

test('edge', 'an offer below cost warns the author who may see cost, nobody else', async (t) => {
  const l = await lemoni();
  const row = one(`SELECT v.id AS v, v.product_id AS p, v.cost_minor AS cost FROM product_variants v JOIN products p ON p.id = v.product_id
    WHERE v.org_id = @o AND v.cost_minor > 10 AND p.archived_at IS NULL AND v.archived_at IS NULL LIMIT 1`, { o: l.orgId });
  expect(!!row, 'a product with a cost', 'found', 'none');
  for (const who of [seed.owner, seed.managerKif]) {
    const tokens = await login(who);
    const product = await ok(`/v1/orgs/${l.orgId}/products/${row.p}`, { token: tokens });
    // warned exactly when the api gives this person the cost (it leaves cost out for everyone else;
    // earlier tests may change roles, so the expectation comes from what this person gets now)
    const warned = product.variants.some((v) => v.id === row.v && v.costMinor != null);
    if (who === seed.owner) eq(warned, true, 'the owner gets the cost');
    const page = await open(t, { tokens });
    await go(page, '/admin');
    const draft = { kind: 'offer', texts: {}, lines: [{ product, variantId: row.v, offer: '0.01' }], scopes: [{ scopeType: 'shop', scopeId: l.kifisia }], push: false, email: false, when: 'now', at: null, until: null };
    await page.evaluate(({ key, v }) => sessionStorage.setItem(`custock.draft.${key}`, JSON.stringify({ at: Date.now(), v })), { key: `post.new.${l.orgId}`, v: draft });
    await go(page, '/admin/posts/new');
    await page.getByLabel(L('composer.offerPrice')).first().waitFor({ timeout: 10_000 });
    await sleep(400);
    const shown = await page.getByText(/Below cost/).filter({ visible: true }).count();
    eq(shown > 0, warned, `below cost warning for ${who}`);
  }
});

test('edge', 'stock work for a business someone lost waits as not sent, the rest still goes', async (t) => {
  const l = await lemoni();
  const tokens = await login(seed.managerKif);
  const v = one(`SELECT l.variant_id AS v FROM stock_levels l JOIN product_variants pv ON pv.id = l.variant_id JOIN products p ON p.id = pv.product_id
    WHERE l.shop_id = @s AND p.uom = 'piece' AND p.track_stock = 1 AND p.archived_at IS NULL LIMIT 1`, { s: l.kifisia }).v;
  const before = one('SELECT on_hand AS n FROM stock_levels WHERE shop_id = @s AND variant_id = @v', { s: l.kifisia, v }).n;
  const page = await open(t, { device: 'phone', tokens });
  await go(page, '/admin');
  const gone = '01900000-0000-7000-8000-00000000dead';
  const now = Date.now();
  const rows = [
    { id: `e2e-lost-${now}`, orgId: gone, payload: { id: `e2e-lost-${now}`, shopId: 'x', variantId: 'x', qtyDelta: 1, kind: 'receive', occurredAt: now }, status: 'queued', reason: null, createdAt: now - 10 },
    { id: `e2e-kept-${now}`, orgId: l.orgId, payload: { id: `e2e-kept-${now}`, shopId: l.kifisia, variantId: v, qtyDelta: 1, kind: 'receive', occurredAt: now }, status: 'queued', reason: null, createdAt: now },
  ];
  await page.evaluate((list) => new Promise((resolve, reject) => {
    const req = indexedDB.open('custock', 1);
    req.onsuccess = () => {
      const tx = req.result.transaction('outbox', 'readwrite');
      for (const r of list) tx.objectStore('outbox').put(r);
      tx.oncomplete = () => resolve(null);
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  }), rows);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  let after = before;
  for (let i = 0; i < 30 && after === before; i++) {
    await sleep(300);
    after = one('SELECT on_hand AS n FROM stock_levels WHERE shop_id = @s AND variant_id = @v', { s: l.kifisia, v }).n;
  }
  eq(after, before + 1, 'the movement of the business they still work for');
  const left = await page.evaluate(() => new Promise((resolve) => {
    const req = indexedDB.open('custock', 1);
    req.onsuccess = () => {
      const all = req.result.transaction('outbox').objectStore('outbox').getAll();
      all.onsuccess = () => resolve(all.result.map((r) => `${r.orgId === '01900000-0000-7000-8000-00000000dead' ? 'gone' : 'kept'}:${r.status}`));
    };
  }));
  eq(left.join(','), 'gone:rejected', 'what stays on the phone');
  // the sale count goes back to how the seed had it
  await ok(`/v1/orgs/${l.orgId}/movements`, { method: 'POST', token: tokens, body: { movements: [{ id: `e2e-undo-${now}`, shopId: l.kifisia, variantId: v, qtyDelta: -1, kind: 'adjust', reason: 'correction', occurredAt: Date.now() }] } });
});
