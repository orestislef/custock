import { see, L, eq, expect, go, lemoni, login, ok, one, onHand, open, q, rx, seed, sleep, test, text } from '../lib.mjs';
import { anyCode, openSheet, primary, waitPath } from '../helpers.mjs';

const st = {};

// the scan screen with a typed code, the way a usb scanner or a person types it
export async function scanTyped(page, code) {
  const input = page.getByPlaceholder(L('scanner.typeCodePlaceholder'));
  if (!(await input.isVisible().catch(() => false))) {
    for (let i = 0; i < 5 && !(await input.isVisible().catch(() => false)); i++) {
      await page.getByRole('button', { name: L('scanner.typeCode') }).first().click();
      await page.waitForTimeout(400);
    }
  }
  await input.fill(code);
  await input.press('Enter');
}
export async function pickMode(page, mode) {
  const chip = page.getByRole('button', { name: L(`scanner.mode.${mode}`), exact: true }).or(page.getByRole('radio', { name: L(`scanner.mode.${mode}`), exact: true }));
  if (await chip.count()) await chip.first().click();
  await page.waitForTimeout(300);
}

test('stock', 'create a product with two variants, a shop barcode, price and cost', async (t) => {
  const page = await open(t, { tokens: await login(seed.owner) });
  await go(page, '/admin/stock/new');
  t.step('name, variants, barcode, price, cost');
  await page.locator('main input.field').first().fill('E2E Linen napkin');
  const addOption = page.getByRole('button', { name: L('productForm.addOption') });
  if (!(await page.getByPlaceholder(L('productForm.optionName')).count())) await addOption.click();
  await page.getByPlaceholder(L('productForm.optionName')).first().fill('Colour');
  await page.getByPlaceholder(L('productForm.optionValues')).first().fill('Sand, Olive');
  await page.getByRole('button', { name: L('productForm.ownCode') }).click();
  await page.waitForTimeout(800);
  await page.locator('input[inputmode=decimal]').nth(0).fill('12,50');
  await page.locator('input[inputmode=decimal]').nth(1).fill('6,00');
  t.step('create');
  await page.getByRole('button', { name: L('productForm.create') }).click();
  await waitPath(page, /^\/admin\/stock\/[0-9a-f-]{20,}$/);
  const p = one("SELECT id FROM products WHERE name = 'E2E Linen napkin'");
  expect(!!p, 'product saved', 'in the database', 'missing');
  st.productId = p.id;
  const vs = q('SELECT id, price_minor, cost_minor, options FROM product_variants WHERE product_id = @p ORDER BY sort', { p: p.id });
  eq(vs.length, 2, 'variants made from Sand, Olive');
  expect(vs.every((v) => v.price_minor === 1250), 'price on every variant', '1250', vs.map((v) => v.price_minor).join(','));
  expect(vs.every((v) => v.cost_minor === 600), 'cost on every variant', '600', vs.map((v) => v.cost_minor).join(','));
  st.variants = vs.map((v) => v.id);
  // each variant gets its own shop code, none is dropped
  const codes = q('SELECT variant_id AS v, code FROM barcodes WHERE variant_id IN (SELECT value FROM json_each(@v))', { v: JSON.stringify(st.variants) });
  const perVariant = st.variants.map((id) => codes.filter((c) => c.v === id).map((c) => c.code));
  expect(perVariant.every((c) => c.length === 1 && c[0].startsWith('2')) && new Set(codes.map((c) => c.code)).size === codes.length,
    'shop barcodes', 'one internal code per variant, all different', JSON.stringify(perVariant));
  st.code = codes[0]?.code;
});
const esc0 = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('stock', 'receive into a chosen shop from the product page', async (t) => {
  expect(!!st.productId, 'product from the previous test', 'an id', 'none');
  const l = await lemoni();
  const page = await open(t, { tokens: await login(seed.owner) });
  await go(page, `/admin/stock/${st.productId}`);
  const sheet = await openSheet(page, page.getByRole('button', { name: L('product.receive') }));
  t.step('pick Kifisia and the first variant, 12');
  const shopSel = sheet.locator(`select[aria-label="${L('stockSheet.shop')}"]`);
  if (await shopSel.count()) await shopSel.selectOption(l.kifisia);
  const varSel = sheet.locator(`select[aria-label="${L('stockSheet.variant')}"]`);
  if (await varSel.count()) await varSel.selectOption(st.variants[0]);
  await sheet.getByLabel(L('stockSheet.qty')).fill('12');
  await primary(page).click();
  await page.waitForTimeout(400);
  if (await page.getByRole('button', { name: L('stockSheet.confirmButton') }).isVisible().catch(() => false)) await page.getByRole('button', { name: L('stockSheet.confirmButton') }).click();
  await see(page, /Received 12/, 10_000);
  eq(await onHand(st.variants[0], l.kifisia), 12, 'on hand in Kifisia after receiving 12');
});

test('stock', 'stock per shop lists every shop with the numbers from the movement history', async (t) => {
  const l = await lemoni();
  const page = await open(t, { tokens: await login(seed.owner) });
  await go(page, `/admin/stock/${st.productId}`);
  const body = await text(page);
  const missing = l.shops.filter((s) => !body.includes(s.name)).map((s) => s.name);
  expect(missing.length === 0, 'shops listed under stock per shop', 'Kifisia, Marousi, Glyfada', `missing ${missing.join(', ')}`);
  const row = page.locator('li, .row').filter({ hasText: 'Kifisia' }).first();
  const rowText = await row.innerText().catch(() => '');
  expect(/\b12\b/.test(rowText), 'Kifisia row', 'shows 12', rowText.replace(/\n/g, ' '));
});

test('stock', 'sell one by typing the code on the scan screen', async (t) => {
  const l = await lemoni();
  const { code, variantId } = await anyCode('kifisia');
  const before = await onHand(variantId, l.kifisia);
  const page = await open(t, { tokens: await login(seed.managerKif) });
  await go(page, '/admin/scan?mode=sell');
  await pickMode(page, 'sell');
  t.step(`type ${code}`);
  await scanTyped(page, code);
  await see(page, /Sold 1/, 10_000);
  await sleep(500);
  eq(await onHand(variantId, l.kifisia), before - 1, 'on hand after one sale');
});

test('stock', 'adjust with a reason, then undo', async (t) => {
  const l = await lemoni();
  const page = await open(t, { tokens: await login(seed.owner) });
  await go(page, `/admin/stock/${st.productId}`);
  const sheet = await openSheet(page, page.getByRole('button', { name: L('product.adjust') }));
  const shopSel = sheet.locator(`select[aria-label="${L('stockSheet.shop')}"]`);
  if (await shopSel.count()) await shopSel.selectOption(l.kifisia);
  const varSel = sheet.locator(`select[aria-label="${L('stockSheet.variant')}"]`);
  if (await varSel.count()) await varSel.selectOption(st.variants[0]);
  t.step('minus 2, damaged');
  await sheet.getByLabel(L('stockSheet.qty')).fill('-2');
  await sheet.getByRole('button', { name: L('common:reason.damaged') }).or(sheet.getByRole('radio', { name: L('common:reason.damaged') })).first().click();
  await primary(page).click();
  await page.waitForTimeout(500);
  if (await page.getByRole('button', { name: L('stockSheet.confirmButton') }).isVisible().catch(() => false)) await page.getByRole('button', { name: L('stockSheet.confirmButton') }).click();
  await sleep(800);
  eq(await onHand(st.variants[0], l.kifisia), 10, 'on hand after minus 2');
  const mv = one("SELECT kind, reason FROM stock_movements WHERE variant_id = @v ORDER BY recorded_at DESC LIMIT 1", { v: st.variants[0] });
  eq([mv?.kind, mv?.reason], ['damage', 'damaged'], 'the movement saved');
  t.step('undo from the toast');
  await page.getByRole('button', { name: L('common:action.undo') }).first().click();
  await see(page, L('stockSheet.undone'), 8000);
  await sleep(500);
  eq(await onHand(st.variants[0], l.kifisia), 12, 'on hand after undo');
  const rev = one("SELECT kind FROM stock_movements WHERE variant_id = @v ORDER BY recorded_at DESC LIMIT 1", { v: st.variants[0] });
  eq(rev?.kind, 'reversal', 'undo adds a reversal line');
});

test('stock', 'low stock shows on Home and under the Low filter', async (t) => {
  const l = await lemoni();
  const owner = await login(seed.owner);
  await ok(`/v1/orgs/${l.orgId}/shops/${l.kifisia}/variants/${st.variants[0]}/settings`, { method: 'PUT', token: owner, body: { reorderPoint: 20 } });
  const dash = await ok(`/v1/orgs/${l.orgId}/reports/dashboard?shopId=${l.kifisia}`, { token: owner });
  expect(dash.lowStock >= 1, 'low stock on the dashboard api', '>= 1', dash.lowStock);
  const page = await open(t, { tokens: owner });
  await go(page, '/admin/stock?filter=low');
  await see(page, 'E2E Linen napkin', 10_000);
});

test('stock', 'a count from start to apply sets the stock', async (t) => {
  const l = await lemoni();
  const owner = await login(seed.owner);
  const count = await ok(`/v1/orgs/${l.orgId}/shops/${l.kifisia}/counts`, { method: 'POST', token: owner, body: { kind: 'partial' } });
  await ok(`/v1/orgs/${l.orgId}/counts/${count.id}/lines/${st.variants[0]}`, { method: 'PUT', token: owner, body: { countedQty: 9, mode: 'set' } });
  const page = await open(t, { tokens: owner });
  await go(page, '/admin/stock/counts');
  await see(page, /Kifisia/, 10_000);
  await go(page, `/admin/stock/counts/${count.id}`);
  await see(page, 'E2E Linen napkin', 10_000);
  await ok(`/v1/orgs/${l.orgId}/counts/${count.id}/submit`, { method: 'POST', token: owner });
  await ok(`/v1/orgs/${l.orgId}/counts/${count.id}/apply`, { method: 'POST', token: owner, body: { uncountedPolicy: 'ignore' } });
  eq(await onHand(st.variants[0], l.kifisia), 9, 'on hand after the count was applied');
});

test('stock', 'transfer sent from Kifisia and received in Marousi with a shortage', async (t) => {
  const l = await lemoni();
  const owner = await login(seed.owner);
  const fromBefore = await onHand(st.variants[0], l.kifisia);
  const tr = await ok(`/v1/orgs/${l.orgId}/transfers`, { method: 'POST', token: owner, body: { fromShopId: l.kifisia, toShopId: l.marousi, lines: [{ variantId: st.variants[0], qty: 5 }] } });
  await ok(`/v1/orgs/${l.orgId}/transfers/${tr.id}/send`, { method: 'POST', token: owner });
  eq(await onHand(st.variants[0], l.kifisia), fromBefore - 5, 'Kifisia after sending 5');
  const katerina = await login(seed.staffMar);
  const page = await open(t, { tokens: katerina });
  await go(page, `/admin/stock/transfers/${tr.id}`);
  await see(page, 'E2E Linen napkin', 10_000);
  st.transferId = tr.id;
  await ok(`/v1/orgs/${l.orgId}/transfers/${tr.id}/receive`, { method: 'POST', token: katerina, body: { lines: [{ variantId: st.variants[0], qtyReceived: 4 }] } });
  eq(await onHand(st.variants[0], l.marousi), 4, 'Marousi after receiving 4 of 5');
  const detail = await ok(`/v1/orgs/${l.orgId}/transfers/${tr.id}`, { token: owner });
  const line = detail.lines.find((x) => x.variantId === st.variants[0]);
  eq([line?.qtySent ?? line?.qty, line?.qtyReceived], [5, 4], 'transfer line sent and received');
  const audit = one("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'stock.transfer_shortage' AND entity_id = @id", { id: tr.id });
  expect(audit?.n >= 1, 'the missing one recorded', 'a shortage entry', audit?.n);
  await go(page, `/admin/stock/transfers/${tr.id}`);
  const body = await text(page);
  expect(/4/.test(body) && /5/.test(body), 'transfer page shows sent and received', '5 sent, 4 received', body.slice(0, 200));
});

test('stock', 'offline sale waits on the phone and syncs once', async (t) => {
  const l = await lemoni();
  const { code, variantId } = await anyCode('kifisia');
  const before = await onHand(variantId, l.kifisia);
  const page = await open(t, { tokens: await login(seed.managerKif), device: 'phone' });
  await go(page, '/admin/scan?mode=sell');
  await pickMode(page, 'sell');
  // the catalog copy for offline scans is fetched on open
  await page.waitForTimeout(2500);
  t.step('go offline, sell one');
  await t.contexts[t.contexts.length - 1].setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await scanTyped(page, code);
  await see(page, /not synced yet|No signal/, 10_000);
  eq(await onHand(variantId, l.kifisia), before, 'server stock while offline');
  t.step('back online');
  await t.contexts[t.contexts.length - 1].setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await see(page, /synced/, 15_000);
  await sleep(800);
  eq(await onHand(variantId, l.kifisia), before - 1, 'server stock after sync');
});

test('stock', 'categories: create one and pick it on a product', async (t) => {
  const page = await open(t, { tokens: await login(seed.owner) });
  await go(page, '/admin/stock/categories');
  const body = await text(page);
  expect(!/Nothing here|not found/i.test(body) || body.length > 50, 'categories screen', 'opens', body.slice(0, 120));
  const l = await lemoni();
  const owner = await login(seed.owner);
  const cat = await ok(`/v1/orgs/${l.orgId}/categories`, { method: 'POST', token: owner, body: { name: 'E2E Linen', translations: { en: 'E2E Linen', el: 'E2E Λινά', ru: 'E2E Лён' } } });
  await go(page, `/admin/stock/${st.productId}/edit`);
  const sel = page.locator(`select[aria-label="${L('stock.form.category')}"]`);
  await sel.selectOption(cat.id);
  await page.getByRole('button', { name: L('common:action.save') }).click();
  await sleep(1000);
  eq(one('SELECT category_id AS c FROM products WHERE id = @p', { p: st.productId })?.c, cat.id, 'category on the product');
});

test('stock', 'the receiving shop sees where a transfer comes from', async (t) => {
  expect(!!st.transferId, 'transfer from the previous test', 'an id', 'none');
  const page = await open(t, { tokens: await login(seed.staffMar) });
  await go(page, `/admin/stock/transfers/${st.transferId}`);
  const body = await page.locator('main').innerText();
  expect(body.includes('Kifisia'), 'origin shop on the transfer page', 'Kifisia shown', body.split('\n').join(' ').slice(0, 160));
});

test('stock', 'camera off: the button under the message has a readable label', async (t) => {
  const page = await open(t, { tokens: await login(seed.managerKif) });
  await go(page, '/admin/scan');
  const cont = page.getByRole('button', { name: L('scanner.useCamera') });
  if (await cont.isVisible().catch(() => false)) await cont.click();
  await page.waitForTimeout(1500);
  const btn = page.locator('.scan-empty button').first();
  await btn.waitFor({ timeout: 8000 });
  const info = await btn.evaluate((b) => ({ text: b.textContent.trim(), name: b.getAttribute('aria-label') ?? b.textContent.trim(), color: getComputedStyle(b).color }));
  expect(info.name.length > 0, 'button name', 'a label', JSON.stringify(info));
  const lum = (info.color.match(/\d+/g) ?? ['0', '0', '0']).slice(0, 3).map(Number);
  expect(0.2126 * lum[0] + 0.7152 * lum[1] + 0.0722 * lum[2] > 160, 'button text on the dark camera view', 'light text', info.color);
});
