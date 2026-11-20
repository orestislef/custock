// orders from customers end to end (thinking/19-orders.md): a customer asks for a price from the
// shop's app, a manager sends one, the customer accepts, staff mark it ready and picked up and the
// stock goes down. an order at shown prices is confirmed and shows "on orders" on the product.
// own products, so tests running beside these can not move the numbers.
import { L, api, eq, expect, go, lemoni, login, ok, one, onHand, open, q, see, seed, shot, sleep, test, text } from '../lib.mjs';

const ean = (twelve) => {
  const sum = [...twelve].reduce((n, d, i) => n + Number(d) * (i % 2 ? 3 : 1), 0);
  return twelve + ((10 - (sum % 10)) % 10);
};

async function ownProduct(l, name, stock = 20, priceMinor = 300) {
  const owner = await login(seed.owner);
  const code = ean('5208' + String(Date.now()).slice(-7) + Math.floor(Math.random() * 10));
  const p = await ok(`/v1/orgs/${l.orgId}/products`, { method: 'POST', token: owner, body: { name, priceMinor, barcode: code } });
  const variantId = p.variants[0].id;
  await ok(`/v1/orgs/${l.orgId}/movements`, { method: 'POST', token: owner, body: { movements: [{ id: crypto.randomUUID(), shopId: l.kifisia, variantId, qtyDelta: stock, kind: 'receive', occurredAt: Date.now() }] } });
  return { productId: p.id, variantId, name };
}

async function customerTokens(email) {
  const r = await ok('/v1/auth/otp/request', { method: 'POST', body: { email } });
  return ok('/v1/auth/otp/verify', { method: 'POST', body: { email, code: r.devCode } });
}

// the business and Kifisia as these tests need them: tests before may have hidden prices or switched
// the shop off, and they run one after another on the same sample business
async function setMode(l, mode) {
  const owner = await login(seed.owner);
  await ok(`/v1/orgs/${l.orgId}`, { method: 'PATCH', token: owner, body: { customerOrders: mode, customerPrices: true } });
  await ok(`/v1/orgs/${l.orgId}/shops/${l.kifisia}`, { method: 'PATCH', token: owner, body: { customerOrders: null } });
}

const orderRow = (id) => one('SELECT status, total_minor, number FROM orders WHERE id = @id', { id });

test('orders', 'a price request: the customer asks, a manager prices, the customer accepts, staff hand it over', async (t) => {
  const l = await lemoni();
  const item = await ownProduct(l, `E2E pelmeni ${Date.now() % 100000}`);
  await setMode(l, 'quote');
  try {
    // the customer, on a phone, in the shop's app
    const tokens = await customerTokens(seed.customer);
    const page = await open(t, { device: 'phone', tokens });
    await go(page, `/s/lemoni/p/${item.productId}`);
    t.step('add 3 to the order');
    const more = page.getByRole('button', { name: L('qty.more', { name: L('order.qtyOf', { name: item.name }) }) });
    await more.click();
    await more.click();
    await shot(page, 'orders-01-product-add');
    await page.getByRole('button', { name: L('order.add') }).click();
    await see(page, L('order.pill'));
    await shot(page, 'orders-02-product-pill');
    await go(page, '/s/lemoni/order');
    await see(page, item.name);
    const kif = page.getByRole('radio', { name: /Kifisia/ });
    if (await kif.count()) await kif.first().click();
    await page.getByLabel(L('orders.note')).fill('For Saturday, in a box please');
    await sleep(500);
    await shot(page, 'orders-03-cart');
    await page.screenshot({ path: 'apps/web/e2e/results/shots/orders-03b-cart-full.png', fullPage: true }).catch(() => {});
    t.step('ask for a price');
    const ask = page.getByRole('button', { name: L('orders.ask') });
    await ask.waitFor({ state: 'visible', timeout: 10_000 });
    await sleep(600);
    await ask.click();
    await page.waitForURL(/\/s\/lemoni\/orders\/[^/]+$/, { timeout: 15_000 });
    const orderId = page.url().split('/').pop();
    eq(orderRow(orderId)?.status, 'requested', 'sent as a request');
    eq(one('SELECT qty FROM order_lines WHERE order_id = @id', { id: orderId })?.qty, 3, 'three asked for');
    await see(page, L('orders.state.requested'));
    await shot(page, 'orders-04-customer-sent');
    // the managers of that shop hear about it
    const maria = one('SELECT id FROM users WHERE email = @e', { e: seed.managerKif });
    expect(q("SELECT 1 FROM dev_outbox WHERE user_id = @u AND channel = 'push' AND payload LIKE @p", { u: maria.id, p: `%${orderId}%` }).length > 0, 'push to the manager', 'a push', 'none');

    t.step('the manager sends a price');
    const mgr = await open(t, { tokens: await login(seed.managerKif) });
    await go(mgr, `/admin/orders/${orderId}`);
    await mgr.getByRole('button', { name: L('orders.sendPrice') }).click();
    await shot(mgr, 'orders-05-staff-order');
    await mgr.getByLabel(L('orders.priceOf', { name: item.name })).fill('2,50');
    await sleep(300);
    await shot(mgr, 'orders-06-quote-sheet');
    await mgr.locator('[data-sheet-footer] button').last().click();
    await see(mgr, L('orders.quotedToast'));
    await sleep(500);
    eq(orderRow(orderId)?.status, 'quoted', 'a price is waiting for the customer');
    eq(orderRow(orderId)?.total_minor, 750, 'three at 2,50');
    const anna = one("SELECT id FROM customers WHERE email = @e AND org_id = @o", { e: seed.customer, o: l.orgId });
    expect(q("SELECT 1 FROM dev_outbox WHERE customer_id = @c AND channel = 'email' AND payload LIKE @p AND payload LIKE '%order_quote%'", { c: anna.id, p: `%${orderId}%` }).length > 0, 'the price by email', 'an email', 'none');

    t.step('the customer accepts');
    await go(page, `/s/lemoni/orders/${orderId}`);
    await see(page, L('orders.quoteTitle'));
    await shot(page, 'orders-07-customer-quote');
    await page.getByRole('button', { name: L('orders.accept') }).click();
    await see(page, L('orders.acceptedToast'));
    await sleep(400);
    eq(orderRow(orderId)?.status, 'confirmed', 'agreed');

    t.step('staff of the shop prepare and hand it over, without pricing buttons');
    const before = await onHand(item.variantId, l.kifisia);
    const staff = await open(t, { tokens: await login(seed.staffKif) });
    await go(staff, `/admin/orders/${orderId}`);
    await see(staff, L('orders.markReady'));
    await shot(staff, 'orders-08-staff-confirmed');
    eq(await staff.getByRole('button', { name: L('orders.sendPrice') }).count(), 0, 'staff send no prices');
    eq(await staff.getByRole('button', { name: L('orders.cancelStaff') }).count(), 0, 'staff cancel nothing');
    await staff.getByRole('button', { name: L('orders.markReady') }).click();
    await see(staff, L('orders.readyToast'));
    await sleep(400);
    eq(orderRow(orderId)?.status, 'ready', 'ready to pick up');
    await staff.getByRole('button', { name: L('orders.markPicked') }).click();
    await see(staff, L('orders.completedToast'));
    await sleep(500);
    eq(orderRow(orderId)?.status, 'completed', 'picked up');
    eq(await onHand(item.variantId, l.kifisia), before - 3, 'the stock went down by the order');
    eq(one("SELECT count(*) AS n FROM stock_movements WHERE ref_type = 'order' AND ref_id = @id", { id: orderId })?.n, 1, 'one sale tied to the order');
    expect(q("SELECT 1 FROM dev_outbox WHERE customer_id = @c AND payload LIKE @p AND payload LIKE '%order_ready%'", { c: anna.id, p: `%${orderId}%` }).length > 0, 'ready told to the customer', 'a message', 'none');

    t.step('the history reads right on both sides');
    await go(page, `/s/lemoni/orders/${orderId}`);
    await page.screenshot({ path: 'apps/web/e2e/results/shots/orders-09-customer-done-full.png', fullPage: true }).catch(() => {});
    const body = await text(page);
    expect(body.includes(L('orders.event.customer.accepted.any')), 'customer history', 'the accept', body.slice(0, 200));
    expect(!body.includes('Maria'), 'no staff names for the customer', 'none', 'a name');
  } finally {
    await setMode(l, 'priced');
  }
});

test('orders', 'an order at shown prices is confirmed and shows on the product as on orders', async (t) => {
  const l = await lemoni();
  await setMode(l, 'priced');
  const item = await ownProduct(l, `E2E honey jar ${Date.now() % 100000}`, 10, 450);
  const tokens = await customerTokens(seed.customer);
  const placed = await api('/v1/c/orgs/lemoni/orders', { method: 'POST', token: tokens, body: { shopId: l.kifisia, lines: [{ variantId: item.variantId, qty: 4, seenUnitPriceMinor: 450 }] } });
  eq(placed.status, 201, 'the order goes in');
  const orderId = placed.json.id;
  expect(placed.json.priced === true, 'at shown prices', 'priced', String(placed.json.priced));
  // a price that changed since it was shown is refused
  const stale = await api('/v1/c/orgs/lemoni/orders', { method: 'POST', token: tokens, body: { shopId: l.kifisia, lines: [{ variantId: item.variantId, qty: 1, seenUnitPriceMinor: 400 }] } });
  eq(stale.json?.code, 'prices_changed', 'an old price');

  t.step('the manager confirms it as it is');
  const mgr = await open(t, { tokens: await login(seed.managerKif) });
  await go(mgr, '/admin/orders');
  await see(mgr, `#${placed.json.number}`);
  await shot(mgr, 'orders-10-staff-list');
  await go(mgr, `/admin/orders/${orderId}`);
  await mgr.getByRole('button', { name: L('orders.confirm') }).click();
  await see(mgr, L('orders.confirmedToast'));
  await sleep(400);
  eq(orderRow(orderId)?.status, 'confirmed', 'confirmed');

  t.step('the product shows what the order holds, never taken off');
  const stockBefore = await onHand(item.variantId, l.kifisia);
  await go(mgr, `/admin/stock/${item.productId}`);
  const pill = mgr.getByRole('button', { name: L('orders.onOrdersOpen', { qty: '4', shop: 'Kifisia' }) });
  await pill.waitFor({ state: 'visible', timeout: 10_000 });
  await shot(mgr, 'orders-11-product-pill');
  await pill.click();
  await see(mgr, `#${placed.json.number}`);
  await sleep(300);
  await shot(mgr, 'orders-12-holds-sheet');
  eq(await onHand(item.variantId, l.kifisia), stockBefore, 'on hand unchanged');

  t.step('the customer cancels nothing confirmed; the shop can');
  const mine = await ok(`/v1/c/orgs/lemoni/orders/${orderId}`, { token: tokens });
  expect(!mine.actions.includes('cancel'), 'a confirmed order is not the customer\'s to cancel', 'no cancel', mine.actions.join(','));
  await ok(`/v1/orgs/${l.orgId}/orders/${orderId}/cancel`, { method: 'POST', token: await login(seed.managerKif), body: { reason: 'E2E clean up' } });
  eq(orderRow(orderId)?.status, 'cancelled', 'cleaned up');
});
