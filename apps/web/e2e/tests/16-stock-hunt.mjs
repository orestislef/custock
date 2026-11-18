// what the stock bug hunt found on the staff side: tabs that pushed the phone page wider in greek
// and russian, an undo that could run twice, a misread code that offered to make a product, the
// scanner selling an archived product, counts from the scanner that never closed, and the shop's
// own price that the product page and the sale ignored.

import { see, L, eq, expect, go, lemoni, login, ok, one, onHand, open, overflow, q, seed, sleep, test } from '../lib.mjs';
import { anyCode } from '../helpers.mjs';
import { pickMode, scanTyped } from './04-stock.mjs';

test('stock hunt', 'phone in greek and russian: the stock tabs scroll inside their row, the page stays as wide as the screen', async (t) => {
  for (const locale of ['el', 'ru']) {
    const page = await open(t, { device: 'phone', locale, tokens: await login(seed.owner) });
    for (const p of ['/admin/stock', '/admin/stock/counts']) {
      await go(page, p);
      await page.waitForTimeout(400);
      const of = await overflow(page);
      expect(!of.scroll, `${locale} ${p} no sideways scroll`, 'none', of.items.join(','));
    }
  }
});

test('stock hunt', 'undo after a scanned sale works once, a second tap does nothing', async (t) => {
  const l = await lemoni();
  const { code, variantId } = await anyCode('kifisia');
  const before = await onHand(variantId, l.kifisia);
  const page = await open(t, { tokens: await login(seed.managerKif), storage: { 'custock.shop': l.kifisia } });
  await go(page, '/admin/scan');
  await pickMode(page, 'sell');
  await scanTyped(page, code);
  await see(page, /Sold 1/, 10_000);
  await sleep(400);
  eq(await onHand(variantId, l.kifisia), before - 1, 'on hand after the sale');
  t.step('tap undo twice');
  const undo = page.getByRole('button', { name: L('common:action.undo') }).first();
  await undo.click();
  await undo.click({ timeout: 1500 }).catch(() => {});
  await sleep(1200);
  eq(await onHand(variantId, l.kifisia), before, 'on hand after undo (once)');
  const reversals = one("SELECT count(*) AS n FROM stock_movements WHERE kind = 'reversal' AND variant_id = @v AND shop_id = @s AND recorded_at > @since", { v: variantId, s: l.kifisia, since: Date.now() - 60_000 }).n;
  eq(reversals, 1, 'reversals written');
});

test('stock hunt', 'a misread barcode shows the damaged line and no way to make a product from it', async (t) => {
  const page = await open(t, { tokens: await login(seed.owner) });
  await go(page, '/admin/scan');
  await pickMode(page, 'lookup');
  await scanTyped(page, '5201234567890');
  await see(page, L('scanner.damaged'), 8000);
  const create = await page.getByRole('link', { name: L('scanner.createWithCode') }).count();
  eq(create, 0, 'links to a new product');
  const kept = one("SELECT count(*) AS n FROM unknown_scans WHERE code_norm = '5201234567890'").n;
  eq(kept, 0, 'unknown codes kept for the misread');
});

test('stock hunt', 'scanning an archived product says so and sells nothing', async (t) => {
  const l = await lemoni();
  const owner = await login(seed.owner);
  const p = await ok(`/v1/orgs/${l.orgId}/products`, { method: 'POST', token: owner, body: { name: 'E2E Retired jam', priceMinor: 300, uom: 'piece', variants: [{ priceMinor: 300, barcodes: [{ code: '5201234567894' }] }] } });
  const variantId = p.variants[0].id;
  await ok(`/v1/orgs/${l.orgId}/movements`, { method: 'POST', token: owner, body: { movements: [{ id: crypto.randomUUID(), shopId: l.kifisia, variantId, qtyDelta: 5, kind: 'receive', occurredAt: Date.now() }] } });
  await ok(`/v1/orgs/${l.orgId}/products/${p.id}/archive`, { method: 'POST', token: owner });
  const page = await open(t, { tokens: await login(seed.managerKif), storage: { 'custock.shop': l.kifisia } });
  await go(page, '/admin/scan');
  await pickMode(page, 'sell');
  await scanTyped(page, '5201234567894');
  await see(page, L('scanner.archivedTitle'), 8000);
  await sleep(500);
  eq(await onHand(variantId, l.kifisia), 5, 'on hand of the archived product');
});

test('stock hunt', 'counting from the scanner carries on with the same open count after leaving the page', async (t) => {
  const l = await lemoni();
  const { code } = await anyCode('kifisia');
  const maria = one('SELECT id FROM users WHERE email = @e', { e: seed.managerKif }).id;
  const openCounts = () => one("SELECT count(*) AS n FROM stock_counts WHERE shop_id = @s AND status = 'open' AND started_by = @u", { s: l.kifisia, u: maria }).n;
  const before = openCounts();
  const page = await open(t, { tokens: await login(seed.managerKif), storage: { 'custock.shop': l.kifisia } });
  await go(page, '/admin/scan');
  await pickMode(page, 'count');
  await scanTyped(page, code);
  await sleep(800);
  t.step('leave and come back');
  await go(page, '/admin/stock');
  await go(page, '/admin/scan');
  await pickMode(page, 'count');
  await scanTyped(page, code);
  await sleep(800);
  eq(openCounts(), Math.max(before, 1), 'open counts by this person in this shop');
  t.step('clear starts over');
  await page.getByRole('button', { name: L('scanner.clear') }).first().click();
  await sleep(800);
  eq(openCounts(), Math.max(before - 1, 0), 'open counts after clear');
});

test('stock hunt', "the product page shows a shop's own price", async (t) => {
  const l = await lemoni();
  const owner = await login(seed.owner);
  const { variantId } = await anyCode('kifisia');
  const productId = one('SELECT product_id AS p FROM product_variants WHERE id = @v', { v: variantId }).p;
  await ok(`/v1/orgs/${l.orgId}/shops/${l.kifisia}/variants/${variantId}/settings`, { method: 'PUT', token: owner, body: { priceOverrideMinor: 777 } });
  const page = await open(t, { tokens: await login(seed.managerKif), storage: { 'custock.shop': l.kifisia } });
  await go(page, `/admin/stock/${productId}`);
  await see(page, /7[.,]77/, 8000);
  const p = await ok(`/v1/orgs/${l.orgId}/products/${productId}`, { token: owner });
  const lvl = p.levels.find((x) => x.variantId === variantId && x.shopId === l.kifisia);
  eq(lvl.priceOverrideMinor, 777, 'shop price in the product answer');
  const rows = q('SELECT 1 FROM shop_variant_settings WHERE variant_id = @v AND shop_id = @s AND price_override_minor = 777', { v: variantId, s: l.kifisia });
  eq(rows.length, 1, 'stored shop price');
});
