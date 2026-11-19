// shops from the app: an owner with one shop adds a second one in Settings, and without a reload
// it is in the shop picker and Transfers appear under Stock. editing a shop's details saves, and at
// the super admin's shop limit "Add shop" is simply not there.
import { L, eq, expect, go, login, ok, one, open, see, test } from '../lib.mjs';
import { cli } from '../env.mjs';
import { PW, openSheet, primary, superAdmin } from '../helpers.mjs';

const SLUG = 'two-shops-e2e';
const OWNER = 'two-shops-owner@example.com';

async function freshBusiness() {
  if (one('SELECT id FROM organizations WHERE slug = @s', { s: SLUG })) {
    const del = cli(['delete-business', '--slug', SLUG, '--confirm', SLUG]);
    expect(del.code === 0, 'delete the old test business', 'exit 0', del.out.slice(0, 300));
  }
  const made = cli(['create-business', '--name', 'Two Shops E2E', '--slug', SLUG, '--owner-email', OWNER, '--owner-name', 'Two Owner', '--shop', 'Centre', '--set-password'], { CUSTOCK_NEW_PASSWORD: PW });
  expect(made.code === 0, 'create the test business', 'exit 0', made.out.slice(0, 300));
  return one('SELECT id FROM organizations WHERE slug = @s', { s: SLUG });
}

test('settings', 'an owner adds a second shop: it is in the picker and Transfers appear without a reload', async (t) => {
  const org = await freshBusiness();
  const page = await open(t, { tokens: await login(OWNER, PW, { fresh: true }) });
  await go(page, `/admin/${SLUG}/stock`);
  await page.waitForTimeout(500);
  eq(await page.locator('a[href*="/stock/transfers"]').count(), 0, 'Transfers links with one shop');

  await go(page, `/admin/${SLUG}/settings`);
  await see(page, L('settings.shops.title'));
  // a reload clears this mark, so it shows the rest happens in the same page
  await page.evaluate(() => { window.__sameDocument = true; });

  t.step('Add shop');
  const sheet = await openSheet(page, page.getByRole('button', { name: L('settings.shops.add') }));
  await sheet.getByLabel(L('settings.shops.name'), { exact: true }).fill('  Harbour  ');
  await sheet.getByLabel(L('settings.shops.city'), { exact: true }).fill('Patra');
  await sheet.getByLabel(L('settings.shops.phone'), { exact: true }).fill('2610 123456');
  await primary(page).click();
  await see(page, L('settings.shops.added', { shop: 'Harbour' }));

  const row = one('SELECT id, name, city, phone FROM shops WHERE org_id = @o AND name = @n', { o: org.id, n: 'Harbour' });
  expect(!!row, 'the new shop in the database', 'Harbour', 'missing');
  eq(row.city, 'Patra', 'city of the new shop');
  eq(row.phone, '+302610123456', 'phone of the new shop');

  t.step('picker and Transfers');
  const picker = page.getByRole('combobox', { name: L('admin.shop') }).first();
  await picker.waitFor({ state: 'visible', timeout: 10_000 });
  const until = Date.now() + 10_000;
  let options = [];
  while (Date.now() < until) {
    options = await picker.locator('option').allInnerTexts();
    if (options.includes('Harbour')) break;
    await page.waitForTimeout(200);
  }
  expect(options.includes('Harbour') && options.includes('Centre'), 'shops in the picker', 'Centre and Harbour', options.join(', '));
  await page.getByRole('link', { name: L('nav.stock'), exact: true }).first().click();
  await page.locator('a[href*="/stock/transfers"]').first().waitFor({ state: 'visible', timeout: 10_000 });
  eq(await page.evaluate(() => window.__sameDocument === true), true, 'no reload on the way');

  t.step('edit the shop');
  await go(page, `/admin/${SLUG}/settings`);
  const edit = await openSheet(page, page.getByRole('button', { name: L('settings.shops.editLabel', { shop: 'Harbour' }) }));
  await edit.getByLabel(L('settings.shops.city'), { exact: true }).fill('Patras');
  await edit.getByLabel(L('settings.shops.phone'), { exact: true }).fill('');
  await primary(page).click();
  await see(page, 'Patras');
  const after = one('SELECT city, phone FROM shops WHERE id = @id', { id: row.id });
  eq(after.city, 'Patras', 'city after the edit');
  eq(after.phone, null, 'phone after it was cleared');

  t.step('at the shop limit');
  const sa = await superAdmin();
  await ok(`/v1/platform/businesses/${org.id}/controls`, { method: 'PATCH', token: sa.tokens, body: { maxShops: 2 } });
  await go(page, `/admin/${SLUG}/settings`);
  await see(page, L('settings.shops.title'));
  eq(await page.getByRole('button', { name: L('settings.shops.add') }).count(), 0, 'Add shop at the limit');
  eq(await page.getByRole('button', { name: L('settings.shops.editLabel', { shop: 'Harbour' }) }).count(), 1, 'shops still listed at the limit');
});
