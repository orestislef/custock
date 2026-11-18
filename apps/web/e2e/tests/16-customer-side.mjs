// the customer side from the bug hunt: pages for links that do not work, the join form keeping
// what was typed, codes pasted with spaces, a new code on request, the shelf QR as a way in, and
// texts that follow the business's own push limits.
import { L, api, eq, expect, go, lemoni, login, ok, one, open, q, see, seed, test, text } from '../lib.mjs';

async function customerTokens(email) {
  const r = await ok('/v1/auth/otp/request', { method: 'POST', body: { email } });
  return ok('/v1/auth/otp/verify', { method: 'POST', body: { email, code: r.devCode } });
}

test('customer side', 'an unknown shop address is a not found page, not a made up shop', async (t) => {
  const page = await open(t, { device: 'phone' });
  await go(page, '/s/nosuchshop');
  const body = await text(page);
  expect(!/nosuchshop shows its products/i.test(body), 'no made up shop', 'not found page', body.slice(0, 120));
  await see(page, L('notFound.title'));
  const manifest = await page.request.get(page.url().replace(/\/s\/nosuchshop.*$/, '/s/nosuchshop/manifest.webmanifest'));
  eq(manifest.status(), 404, 'manifest of an unknown shop');
});

test('customer side', 'an old unsubscribe link says so and shows no form', async (t) => {
  const page = await open(t, { device: 'phone' });
  await go(page, '/unsubscribe/not-a-real-token');
  await see(page, L('confirm.failTitle'));
  eq(await page.locator('form button[type=submit]').count(), 0, 'no unsubscribe button');
  const body = await text(page);
  expect(!/Custock uses Custock/i.test(body), 'no "Custock uses Custock" footer', 'none', 'present');
});

test('customer side', 'an old email undo link says so before any button', async (t) => {
  const page = await open(t, { device: 'phone' });
  await go(page, '/account/email-revert/not-a-real-token-1234');
  await see(page, L('emailRevert.failTitle'));
  eq(await page.getByRole('button', { name: L('emailRevert.button') }).count(), 0, 'no undo button');
});

test('customer side', 'the join form shows every problem at once and keeps what was typed', async (t) => {
  const page = await open(t, { device: 'phone' });
  await go(page, '/j/kif7q2');
  await page.locator('input[name=name]').fill('Bob123');
  await page.locator('input[name=email]').fill('bob@@x');
  await page.locator('input[name=emailNews]').check({ force: true });
  await page.getByRole('button', { name: L('join.submit'), exact: true }).click();
  await see(page, L('join.nameInvalid'));
  await see(page, L('join.emailInvalid'));
  await see(page, L('join.over15Needed'));
  eq(await page.locator('input[name=name]').inputValue(), 'Bob123', 'the name stays');
  expect(await page.locator('input[name=emailNews]').isChecked(), 'the email switch stays on', 'on', 'off');
});

test('customer side', 'a code pasted with a space signs the customer in, and a new code can be asked for', async (t) => {
  const page = await open(t, { device: 'phone' });
  await go(page, '/s/lemoni/me');
  const email = 'anna@example.com';
  await page.getByPlaceholder(L('shopper.signIn.email')).fill(email);
  await page.getByRole('button', { name: L('shopper.signIn.send') }).click();
  await see(page, L('shopper.signIn.resendIn', { count: 30 }).replace(/\d+/, '').slice(0, 12));
  const row = one("SELECT title, body FROM dev_outbox WHERE to_address = @e ORDER BY rowid DESC LIMIT 1", { e: email });
  const code = `${row?.title ?? ''} ${row?.body ?? ''}`.match(/\b(\d{6})\b/)?.[1];
  expect(!!code, 'the code', '6 digits', 'none');
  const box = page.locator('input[autocomplete=one-time-code]');
  await box.click();
  await page.keyboard.insertText(`${code.slice(0, 3)} ${code.slice(3)}`);
  eq(await box.inputValue(), code, 'the field keeps all six digits');
  await page.getByRole('button', { name: L('common:action.signIn') }).click();
  await see(page, L('shopper.me.channels', { org: 'Lemoni' }), 10_000);
});

test('customer side', 'a shelf QR on a followers only catalog still offers the way in', async (t) => {
  const l = await lemoni();
  const owner = await login(seed.owner);
  await ok(`/v1/orgs/${l.orgId}`, { method: 'PATCH', token: owner, body: { customerCatalog: 'subscribers' } });
  const code = q("SELECT code FROM barcodes WHERE org_id = @o AND code LIKE '520%' LIMIT 1", { o: l.orgId })[0].code;
  const page = await open(t, { device: 'phone' });
  await go(page, `/p/${code}`);
  await see(page, L('product.join', { org: 'Lemoni' }));
});

test('customer side', 'texts follow the business push cap and quiet hours', async (t) => {
  const l = await lemoni();
  const owner = await login(seed.owner);
  const before = await ok(`/v1/orgs/${l.orgId}`, { token: owner });
  try {
    const r = await api(`/v1/orgs/${l.orgId}`, { method: 'PATCH', token: owner, body: { pushDailyCap: 1, quietHours: '21:00-09:30' } });
    expect(r.status < 300, 'settings saved', '2xx', String(r.status));
    const page = await open(t, { device: 'phone' });
    await go(page, '/j/kif7q2');
    await see(page, L('join.pushSubCap', { count: 1 }));
    const tokens = await customerTokens(seed.customer);
    const me = await open(t, { device: 'phone', tokens });
    await go(me, '/s/lemoni/me');
    await see(me, L('shopper.me.channelsFoot', { from: '21:00', to: '09:30' }), 10_000);
  } finally {
    await api(`/v1/orgs/${l.orgId}`, { method: 'PATCH', token: owner, body: { pushDailyCap: before.pushDailyCap, quietHours: before.quietHours } });
  }
});

test('customer side', 'a customer without a phone shows no empty phone row and no sms channel', async (t) => {
  const l = await lemoni();
  const owner = await login(seed.owner);
  // a customer added by staff with an email and no phone
  const c = await ok(`/v1/orgs/${l.orgId}/customers`, { method: 'POST', token: owner, body: { name: 'Nophone Person', email: 'nophone-e2e@example.com', shopId: l.kifisia } });
  expect(!!c?.id, 'customer added', 'an id', JSON.stringify(c).slice(0, 80));
  const page = await open(t, { device: 'phone', tokens: owner });
  await go(page, `/admin/lemoni/customers/${c.id}`);
  await see(page, L('customer.channels'));
  eq(await page.getByText(L('customer.phone'), { exact: true }).count(), 0, 'no phone row');
  eq(await page.getByText(L('common:channel.sms'), { exact: true }).count(), 0, 'no sms row');
});

test('customer side', 'a double tap on Save adds a customer note once', async (t) => {
  const l = await lemoni();
  const owner = await login(seed.owner);
  const c = await ok(`/v1/orgs/${l.orgId}/customers`, { method: 'POST', token: owner, body: { name: 'Double Tap', email: 'double-tap-e2e@example.com', shopId: l.kifisia } });
  const page = await open(t, { device: 'phone', tokens: owner });
  await go(page, `/admin/lemoni/customers/${c.id}`);
  await page.getByPlaceholder(L('customer.addNote')).fill('called about the honey');
  await page.getByRole('button', { name: L('common:action.save'), exact: true }).dblclick();
  await see(page, 'called about the honey');
  await page.waitForTimeout(800);
  eq(q('SELECT count(*) AS n FROM customer_notes WHERE customer_id = @c', { c: c.id })[0].n, 1, 'notes saved');
});

test('customer side', 'a double tap on the delete confirm deletes the post once', async (t) => {
  const l = await lemoni();
  const owner = await login(seed.owner);
  const p = await ok(`/v1/orgs/${l.orgId}/posts`, { method: 'POST', token: owner, body: {
    kind: 'news', defaultLocale: 'en', translations: { en: { title: 'Delete me once', body: 'x' } },
    channels: ['feed'], audience: { scopes: [{ scopeType: 'shop', scopeId: l.kifisia }] },
  } });
  const page = await open(t, { device: 'phone', tokens: owner });
  const deletes = [];
  page.on('response', (res) => { if (res.request().method() === 'DELETE' && res.url().includes(`/posts/${p.id}`)) deletes.push(res.status()); });
  await go(page, `/admin/lemoni/posts/${p.id}`);
  await page.getByRole('button', { name: L('common:action.delete'), exact: true }).click();
  await see(page, L('post.deleteConfirm'));
  await page.getByRole('button', { name: L('common:action.delete'), exact: true }).first().dblclick();
  await see(page, L('posts.title'));
  await page.waitForTimeout(800);
  eq(deletes.join(','), '204', 'delete calls');
});

test('customer side', 'on an iphone the join form keeps what was typed and a spaced code still signs in', async (t) => {
  const page = await open(t, { device: 'phone', ios: true, engine: 'webkit' });
  await go(page, '/j/kif7q2');
  await page.locator('input[name=name]').fill('Bob123');
  await page.getByRole('button', { name: L('join.submit'), exact: true }).click();
  await see(page, L('join.nameInvalid'));
  eq(await page.locator('input[name=name]').inputValue(), 'Bob123', 'the name stays on safari');
  const email = 'anna@example.com';
  await go(page, '/s/lemoni/me');
  await page.getByPlaceholder(L('shopper.signIn.email')).fill(email);
  await page.getByRole('button', { name: L('shopper.signIn.send') }).click();
  const box = page.locator('input[autocomplete=one-time-code]');
  await box.waitFor();
  const row = one('SELECT title, body FROM dev_outbox WHERE to_address = @e ORDER BY rowid DESC LIMIT 1', { e: email });
  const code = `${row?.title ?? ''} ${row?.body ?? ''}`.match(/\b(\d{6})\b/)?.[1];
  await box.click();
  await page.keyboard.insertText(`${code.slice(0, 3)} ${code.slice(3)}`);
  eq(await box.inputValue(), code, 'all six digits on safari');
  await page.getByRole('button', { name: L('common:action.signIn') }).click();
  await see(page, L('shopper.me.channels', { org: 'Lemoni' }), 10_000);
});
