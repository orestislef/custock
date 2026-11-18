import { see, L, api, eq, expect, go, lemoni, linkIn, login, ok, one, open, outboxFor, q, seed, sleep, test, text, waitOutbox } from '../lib.mjs';
import { openSheet, primary } from '../helpers.mjs';

const st = { email: 'cust-e2e@example.com' };

async function catalogMode(mode) {
  const l = await lemoni();
  await ok(`/v1/orgs/${l.orgId}`, { method: 'PATCH', token: await login(seed.owner), body: { customerCatalog: mode } });
}

test('customers', 'join from a QR link and confirm by the email link', async (t) => {
  const since = Date.now();
  const page = await open(t, { device: 'phone' });
  await go(page, '/j/kif7q2');
  t.step('name, email, email news, 15 or older');
  await page.locator('input[name=name]').fill('Casey Customer');
  await page.locator('input[name=email]').fill(st.email);
  await page.locator('input[name=emailNews]').check({ force: true });
  await page.locator('input[name=over15]').check({ force: true });
  await page.getByRole('button', { name: L('join.submit'), exact: true }).click();
  await see(page, L('join.checkTitle'), 10_000);
  const rows = await waitOutbox(st.email, { since });
  const link = linkIn(rows[0], '/confirm/');
  expect(!!link, 'confirm link in the email', 'a /confirm/ link', (rows[0].body ?? '').slice(0, 120));
  await page.goto(link, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const c = one('SELECT id, email_verified_at, email_ok FROM customers WHERE email = @e', { e: st.email });
  expect(c && c.email_verified_at, 'customer confirmed', 'email verified', JSON.stringify(c));
  expect(c.email_ok === 1, 'email consent', 'on', c.email_ok);
  st.customerId = c.id;
});

test('customers', 'customer signs in with an email code', async (t) => {
  const since = Date.now();
  const page = await open(t, { device: 'phone' });
  await go(page, '/s/lemoni/me');
  await page.getByPlaceholder(L('shopper.signIn.email')).fill(st.email);
  await page.getByRole('button', { name: L('shopper.signIn.send') }).click();
  const rows = await waitOutbox(st.email, { since });
  const code = `${rows[0].title ?? ''} ${rows[0].body ?? ''}`.match(/\b(\d{6})\b/)?.[1];
  expect(!!code, 'code in the email', '6 digits', (rows[0].body ?? '').slice(0, 80));
  await page.locator('input[autocomplete=one-time-code]').fill(code);
  await page.getByRole('button', { name: L('common:action.signIn') }).click();
  await see(page, L('shopper.me.channels', { org: 'Lemoni' }), 10_000);
  st.tokens = await page.evaluate(() => JSON.parse(localStorage.getItem('custock.tokens') ?? 'null'));
  expect(!!st.tokens?.accessToken, 'customer session', 'tokens', 'none');
});

test('customers', 'a signed in customer follows the business', async () => {
  const shops = await ok('/v1/c/shops', { token: st.tokens });
  expect(shops.some((s) => s.orgName === 'Lemoni' || s.name === 'Kifisia'), 'followed shops', 'Lemoni listed', JSON.stringify(shops).slice(0, 200));
  const l = await lemoni();
  await ok('/v1/c/follow', { method: 'POST', token: st.tokens, body: { scopeType: 'shop', scopeId: l.glyfada } });
  const again = await ok('/v1/c/shops', { token: st.tokens });
  expect(again.some((s) => s.id === l.glyfada || s.name === 'Glyfada'), 'after following Glyfada', 'Glyfada listed', JSON.stringify(again.map((s) => s.name)));
});

test('customers', 'catalog off, followers and everyone', async (t) => {
  try {
    await catalogMode('public');
    const page = await open(t, { device: 'phone' });
    await go(page, '/s/lemoni');
    await see(page, /honey|Honey|μέλι/, 10_000);
    await catalogMode('subscribers');
    await go(page, '/s/lemoni');
    const asVisitor = await text(page);
    expect(!/Thyme honey/.test(asVisitor), 'followers only, seen by a visitor', 'no products', 'products listed');
    const follower = await open(t, { device: 'phone', tokens: st.tokens });
    await go(follower, '/s/lemoni');
    await see(follower, /Thyme honey|honey/i, 10_000);
    await catalogMode('off');
    await go(follower, '/s/lemoni');
    const off = await text(follower);
    expect(!/Thyme honey/.test(off), 'catalog off, seen by a follower', 'no products', 'products listed');
  } finally {
    await catalogMode('public');
  }
});

test('customers', 'notify me, then back in stock sends a delivery', async (t) => {
  const l = await lemoni();
  const owner = await login(seed.owner);
  const p = await ok(`/v1/orgs/${l.orgId}/products`, { method: 'POST', token: owner, body: { name: 'E2E Rare tea', priceMinor: 450, uom: 'piece' } });
  const variantId = p.variants[0].id;
  st.rare = { productId: p.id, variantId };
  const page = await open(t, { device: 'phone', tokens: st.tokens });
  await go(page, `/s/lemoni/p/${p.id}`);
  t.step('Tell me when it is back');
  await page.getByRole('button', { name: L('product.notifyMe') }).first().click();
  await see(page, L('shopper.product.notifySet'), 10_000);
  const alert = one('SELECT id, status FROM stock_alerts WHERE variant_id = @v AND customer_id IN (SELECT id FROM customers WHERE email = @e)', { v: variantId, e: st.email });
  expect(!!alert, 'stock alert saved', 'a row', 'none');
  t.step('receive 3 in Kifisia');
  await ok(`/v1/orgs/${l.orgId}/movements`, { method: 'POST', token: owner, body: { movements: [{ id: crypto.randomUUID(), shopId: l.kifisia, variantId, qtyDelta: 3, kind: 'receive', occurredAt: Date.now() }] } });
  await api('/v1/dev/run-jobs', { method: 'POST', token: owner });
  await sleep(1500);
  const after = one('SELECT status, notified_at FROM stock_alerts WHERE id = @id', { id: alert.id });
  expect(after.notified_at, 'alert after it is back', 'notified', JSON.stringify(after));
  const del = q('SELECT channel, status FROM deliveries WHERE alert_id = @a', { a: alert.id });
  expect(del.length >= 1, 'deliveries for the alert', 'at least one', JSON.stringify(del));
});

test('customers', 'save a product and see it under You', async (t) => {
  const page = await open(t, { device: 'phone', tokens: st.tokens });
  await go(page, `/s/lemoni/p/${st.rare.productId}`);
  await page.getByRole('button', { name: L('shopper.product.save'), exact: true }).first().click();
  await see(page, L('shopper.product.savedToast'), 8000);
  const fav = await ok('/v1/c/favorites', { token: st.tokens });
  expect(fav.some((f) => f.id === st.rare.productId || f.productId === st.rare.productId), 'favorites api', 'the product', JSON.stringify(fav).slice(0, 160));
  await go(page, '/s/lemoni/me');
  await see(page, 'E2E Rare tea', 8000);
});

test('customers', 'email and push channels turn off and on', async () => {
  const l = await lemoni();
  await ok('/v1/c/channels', { method: 'PUT', token: st.tokens, body: { orgId: l.orgId, channel: 'email', on: false } });
  eq(one('SELECT email_ok FROM customers WHERE email = @e AND org_id = @o', { e: st.email, o: l.orgId }).email_ok, 0, 'email after off');
  await ok('/v1/c/channels', { method: 'PUT', token: st.tokens, body: { orgId: l.orgId, channel: 'email', on: true } });
  eq(one('SELECT email_ok FROM customers WHERE email = @e AND org_id = @o', { e: st.email, o: l.orgId }).email_ok, 1, 'email after on');
  const consents = q('SELECT granted FROM consents WHERE customer_id = @c AND channel = \'email\' ORDER BY created_at', { c: st.customerId }).map((r) => r.granted);
  expect(consents.slice(-2).join(',') === '0,1', 'consent ledger', 'off then on', consents.join(','));
});

test('customers', 'unsubscribe from the link in a post email', async (t) => {
  const l = await lemoni();
  const owner = await login(seed.owner);
  const since = Date.now();
  const post = await ok(`/v1/orgs/${l.orgId}/posts`, { method: 'POST', token: owner, body: {
    kind: 'news', defaultLocale: 'en', translations: { en: { title: 'E2E unsubscribe test', body: 'Hello' } }, channels: ['email'],
    audience: { scopes: [{ scopeType: 'shop', scopeId: l.kifisia }] },
  } });
  await ok(`/v1/orgs/${l.orgId}/posts/${post.id}/publish`, { method: 'POST', token: owner });
  if (one('SELECT status FROM posts WHERE id = @p', { p: post.id }).status === 'pending_approval') await ok(`/v1/orgs/${l.orgId}/posts/${post.id}/approve`, { method: 'POST', token: owner });
  await api('/v1/dev/run-jobs', { method: 'POST', token: owner });
  const rows = await waitOutbox(st.email, { since }, 20_000);
  const link = linkIn(rows[0], '/unsubscribe/');
  expect(!!link, 'unsubscribe link in the post email', 'a /unsubscribe/ link', (rows[0].body ?? '').slice(-160));
  const page = await open(t, { device: 'phone' });
  await page.goto(link, { waitUntil: 'networkidle' });
  await page.locator('main button, button').filter({ hasText: /unsubscribe|Stop|stop/i }).first().click();
  await sleep(1000);
  eq(one('SELECT email_ok FROM customers WHERE email = @e AND org_id = @o', { e: st.email, o: l.orgId }).email_ok, 0, 'email after unsubscribing');
});

test('customers', 'export my data, then delete my account', async (t) => {
  const exp = await api('/v1/me/export', { token: st.tokens });
  expect(exp.status === 200 && JSON.stringify(exp.json).includes(st.email), 'export', 'json with my email', exp.status);
  const page = await open(t, { device: 'phone', tokens: st.tokens });
  await go(page, '/s/lemoni/me');
  const sheet = await openSheet(page, page.getByRole('button', { name: L('shopper.me.delete') }));
  const since = Date.now();
  t.step('continue, then confirm with the code from the email');
  await sheet.getByRole('button', { name: L('shopper.me.deleteContinue') }).click();
  const code = sheet.locator('input[autocomplete=one-time-code]');
  await code.waitFor({ timeout: 8000 });
  if (!(await code.inputValue())) {
    const rows = await waitOutbox(st.email, { since });
    await code.fill(`${rows[0].title ?? ''} ${rows[0].body ?? ''}`.match(/(\d{6})/)?.[1] ?? '');
  }
  await sheet.getByRole('button', { name: L('shopper.me.deleteConfirm') }).click();
  await sleep(1500);
  const me = await api('/v1/me/context', { token: st.tokens });
  expect(me.status === 401, 'session after deleting the account', '401', me.status);
  const c = one('SELECT erased_at, email FROM customers WHERE id = @c', { c: st.customerId });
  expect(c?.erased_at || !c?.email, 'customer row', 'erased', JSON.stringify(c));
});

test('customers', 'confirm link from an old email asks nothing and fails calmly', async (t) => {
  const page = await open(t, { device: 'phone' });
  await go(page, '/confirm/not-a-real-token-0000');
  const body = await text(page);
  expect(body.length > 20 && !/Error|undefined|Exception/.test(body), 'bad confirm link page', 'a calm message', body.slice(0, 120));
  void outboxFor;
});
