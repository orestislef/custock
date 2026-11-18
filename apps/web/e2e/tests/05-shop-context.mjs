// the shop a stock action lands in is always the one the person means, and one they may act in
import { see, L, api, eq, expect, go, lemoni, login, ok, one, onHand, open, q, seed, sleep, test, text } from '../lib.mjs';
import { anyCode, openSheet, primary, superAdmin } from '../helpers.mjs';
import { pickMode, scanTyped } from './04-stock.mjs';

const SHOP_LABEL = () => `select[aria-label="${L('admin.shop')}"]`;

async function pickHeaderShop(page, shopId) {
  const sel = page.locator(SHOP_LABEL()).first();
  await sel.waitFor({ state: 'attached', timeout: 8000 });
  await sel.selectOption(shopId);
  await page.waitForTimeout(800);
}
async function modesShown(page) {
  return page.evaluate(() => {
    const group = [...document.querySelectorAll('[role=radiogroup], [role=group]')].find((g) => /Look up|Sell|Receive|Count|Transfer/.test(g.textContent ?? ''));
    return group ? [...group.querySelectorAll('button, [role=radio]')].map((b) => b.textContent.trim()) : [];
  });
}
// maria: manager in Kifisia, plus viewer in Glyfada, so she has two shops with different rights
async function mariaTwoShops() {
  const l = await lemoni();
  const owner = await login(seed.owner);
  const members = await ok(`/v1/orgs/${l.orgId}/members`, { token: owner });
  const m = members.find((x) => x.email === seed.managerKif);
  const already = (m.assignments ?? []).some((a) => a.scopeId === l.glyfada);
  if (!already) {
    const roles = await ok(`/v1/orgs/${l.orgId}/roles`, { token: owner });
    const viewer = roles.find((r) => r.templateKey === 'viewer');
    await ok(`/v1/orgs/${l.orgId}/members/${m.membershipId}/assignments`, { method: 'POST', token: owner, body: { roleId: viewer.id, scopeType: 'shop', scopeId: l.glyfada } });
  }
  return login(seed.managerKif, undefined, { fresh: true });
}

test('shop context', 'one shop: the scan screen names the shop and every mode lands there', async (t) => {
  const l = await lemoni();
  const { code, variantId } = await anyCode('kifisia');
  const page = await open(t, { tokens: await login(seed.staffKif) });
  await go(page, '/admin/scan');
  const body = await text(page);
  expect(body.includes('Kifisia'), 'shop shown on the scan screen', 'Kifisia', 'not shown');
  t.step('sell');
  const before = await onHand(variantId, l.kifisia);
  await pickMode(page, 'sell');
  await scanTyped(page, code);
  await see(page, /Sold 1/, 10_000);
  await sleep(500);
  eq(await onHand(variantId, l.kifisia), before - 1, 'Kifisia after a sale by the one shop staff');
  t.step('receive');
  await pickMode(page, 'receive');
  await scanTyped(page, code);
  await page.getByRole('button', { name: L('scanner.receiveCta', { count: 1 }) }).click();
  await sleep(1200);
  eq(await onHand(variantId, l.kifisia), before, 'Kifisia after receiving it back');
  t.step('count');
  const counts0 = q('SELECT id FROM stock_counts').length;
  await pickMode(page, 'count');
  await scanTyped(page, code);
  await sleep(1500);
  const c = one('SELECT shop_id FROM stock_counts ORDER BY started_at DESC LIMIT 1');
  expect(q('SELECT id FROM stock_counts').length === counts0 + 1 && c.shop_id === l.kifisia, 'count opened by the scan', 'one new count in Kifisia', JSON.stringify(c));
  const modes = await modesShown(page);
  expect(!modes.includes(L('scanner.mode.transfer')), 'transfer mode for staff without send rights', 'hidden', JSON.stringify(modes));
});

test('shop context', 'one shop: receive and adjust sheets need no shop choice', async (t) => {
  const l = await lemoni();
  const { variantId } = await anyCode('kifisia');
  const productId = one('SELECT product_id AS p FROM product_variants WHERE id = @v', { v: variantId }).p;
  const page = await open(t, { tokens: await login(seed.managerKif, undefined, { fresh: true }) });
  await go(page, `/admin/stock/${productId}`);
  const sheet = await openSheet(page, page.getByRole('button', { name: L('product.receive') }));
  const sel = sheet.locator(`select[aria-label="${L('stockSheet.shop')}"]`);
  const options = (await sel.count()) ? await sel.locator('option').allInnerTexts() : [];
  expect(options.length <= 1, 'shop choices in the receive sheet', 'none or Kifisia only', JSON.stringify(options));
  const before = await onHand(variantId, l.kifisia);
  await sheet.getByLabel(L('stockSheet.qty')).fill('2');
  await primary(page).click();
  await sleep(1200);
  eq(await onHand(variantId, l.kifisia), before + 2, 'Kifisia after receiving 2 in the sheet');
});

test('shop context', 'several shops: the selected shop is shown, switching moves the next scan, it persists', async (t) => {
  const l = await lemoni();
  const { code, variantId } = await anyCode('marousi');
  const page = await open(t, { tokens: await login(seed.owner) });
  await go(page, '/admin/scan');
  t.step('choose Marousi in the header');
  await pickHeaderShop(page, l.marousi);
  const body = await text(page);
  expect(body.includes('Marousi'), 'selected shop on the scan screen', 'Marousi', 'not shown');
  const m0 = await onHand(variantId, l.marousi);
  const k0 = await onHand(variantId, l.kifisia);
  await pickMode(page, 'sell');
  await scanTyped(page, code);
  await see(page, /Sold 1/, 10_000);
  await sleep(500);
  eq([await onHand(variantId, l.marousi), await onHand(variantId, l.kifisia)], [m0 - 1, k0], 'Marousi and Kifisia after selling with Marousi selected');
  t.step('reload');
  await page.reload({ waitUntil: 'networkidle' });
  const kept = await page.locator(SHOP_LABEL()).first().inputValue();
  eq(kept, l.marousi, 'selected shop after a reload');
});

test('shop context', 'several shops with "All shops": the scan screen says which shop it uses', async (t) => {
  const page = await open(t, { tokens: await login(seed.owner), storage: { 'custock.shop': 'all' } });
  await go(page, '/admin/scan');
  const body = await text(page);
  const shown = ['Kifisia', 'Marousi', 'Glyfada'].filter((n) => body.includes(n));
  expect(shown.length >= 1, 'a shop named on the scan screen with All shops selected', 'the shop scans go to', 'no shop named');
});

test('shop context', 'a scan never lands in a shop the person cannot act in', async (t) => {
  const l = await lemoni();
  const tokens = await mariaTwoShops();
  const { code, variantId } = await anyCode('glyfada');
  const page = await open(t, { tokens });
  await go(page, '/admin/scan');
  t.step('choose Glyfada, where maria is only a viewer');
  await pickHeaderShop(page, l.glyfada);
  const modes = await modesShown(page);
  expect(!modes.includes(L('scanner.mode.sell')) && !modes.includes(L('scanner.mode.receive')) && !modes.includes(L('scanner.mode.count')), 'stock modes in a view only shop', 'only Look up', JSON.stringify(modes));
  const g0 = await onHand(variantId, l.glyfada);
  await pickMode(page, 'sell');
  await scanTyped(page, code);
  await sleep(1500);
  eq(await onHand(variantId, l.glyfada), g0, 'Glyfada stock after maria scanned there');
  const id = crypto.randomUUID();
  const r = await api(`/v1/orgs/${l.orgId}/movements`, { method: 'POST', token: tokens, body: { movements: [{ id, shopId: l.glyfada, variantId, qtyDelta: -1, kind: 'sale', occurredAt: Date.now() }] } });
  const refused = r.status === 403 || (r.json?.rejected ?? []).some((x) => x.id === id);
  expect(refused, 'api sale in a view only shop', 'refused', `${r.status} ${JSON.stringify(r.json).slice(0, 120)}`);
});

test('shop context', 'count mode: a staff member counts only in their shop', async (t) => {
  const l = await lemoni();
  const kat = await login(seed.staffMar);
  const other = await api(`/v1/orgs/${l.orgId}/shops/${l.kifisia}/counts`, { method: 'POST', token: kat, body: { kind: 'partial' } });
  expect(other.status === 403, 'Marousi staff opening a count in Kifisia', '403', other.status);
  const { code } = await anyCode('marousi');
  const page = await open(t, { tokens: kat });
  await go(page, '/admin/scan?mode=count');
  await pickMode(page, 'count');
  await scanTyped(page, code);
  await sleep(1500);
  const c = one('SELECT shop_id FROM stock_counts ORDER BY started_at DESC LIMIT 1');
  eq(c.shop_id, l.marousi, 'shop of the count Katerina started by scanning');
});

test('shop context', 'transfer mode: from the selected shop, it is not a destination, only the destination receives', async (t) => {
  const l = await lemoni();
  const { code, variantId } = await anyCode('kifisia');
  const page = await open(t, { tokens: await login(seed.owner) });
  await go(page, '/admin/scan');
  await pickHeaderShop(page, l.kifisia);
  await pickMode(page, 'transfer');
  await scanTyped(page, code);
  await sleep(800);
  const dest = await page.locator(`[aria-label="${L('scanner.pickShop')}"] button`).allInnerTexts();
  expect(!dest.some((d) => d.includes('Kifisia')) && dest.some((d) => d.includes('Marousi')), 'destinations', 'Marousi and Glyfada, not Kifisia', JSON.stringify(dest));
  await page.locator(`[aria-label="${L('scanner.pickShop')}"] button`).filter({ hasText: 'Marousi' }).click();
  await page.getByRole('button', { name: /Send 1 item to Marousi/ }).click();
  await sleep(1500);
  const tr = one('SELECT id, from_shop_id AS f, to_shop_id AS t, status FROM transfers ORDER BY created_at DESC LIMIT 1');
  eq([tr.f, tr.t], [l.kifisia, l.marousi], 'transfer shops');
  const maria = await login(seed.managerKif);
  const wrong = await api(`/v1/orgs/${l.orgId}/transfers/${tr.id}/receive`, { method: 'POST', token: maria, body: { lines: [{ variantId, qtyReceived: 1 }] } });
  expect(wrong.status === 403, 'receiving a transfer at the sending shop', '403', wrong.status);
});

test('shop context', 'offline sales keep their shop even after switching shop', async (t) => {
  const l = await lemoni();
  const { code, variantId } = await anyCode('marousi');
  const m0 = await onHand(variantId, l.marousi);
  const g0 = await onHand(variantId, l.glyfada);
  const page = await open(t, { tokens: await login(seed.owner), device: 'phone' });
  await go(page, '/admin/scan');
  await pickHeaderShop(page, l.marousi);
  await pickMode(page, 'sell');
  await page.waitForTimeout(2500);
  const ctx = t.contexts[t.contexts.length - 1];
  await ctx.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await scanTyped(page, code);
  await see(page, /not synced yet|No signal/, 10_000);
  t.step('switch to Glyfada, then back online');
  await pickHeaderShop(page, l.glyfada);
  await ctx.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await see(page, /synced/, 15_000);
  await sleep(800);
  eq([await onHand(variantId, l.marousi), await onHand(variantId, l.glyfada)], [m0 - 1, g0], 'Marousi and Glyfada after the offline sale synced');
});

test('shop context', 'super admin in a business with several shops picks one the same way', async (t) => {
  const l = await lemoni();
  const sa = await superAdmin();
  const { code, variantId } = await anyCode('glyfada');
  const page = await open(t, { tokens: sa.tokens, storage: { 'custock.org': l.orgId } });
  await go(page, '/admin/scan');
  await pickHeaderShop(page, l.glyfada);
  expect((await text(page)).includes('Glyfada'), 'selected shop on the scan screen', 'Glyfada', 'not shown');
  const g0 = await onHand(variantId, l.glyfada);
  await pickMode(page, 'sell');
  await scanTyped(page, code);
  await see(page, /Sold 1/, 10_000);
  await sleep(500);
  eq(await onHand(variantId, l.glyfada), g0 - 1, 'Glyfada after the super admin sold one');
});

test('shop context', 'a viewer gets Scan in the navigation with Look up only', async (t) => {
  const page = await open(t, { tokens: await login(seed.viewer) });
  await go(page, '/admin');
  const nav = await page.locator('nav').first().innerText();
  expect(nav.includes(L('nav.scan')), 'Scan in the viewer navigation', 'shown', 'hidden');
  await go(page, '/admin/scan');
  const modes = await modesShown(page);
  expect(modes.length <= 1 && !modes.some((m) => m !== L('scanner.mode.lookup')), 'viewer scan modes', 'Look up only', JSON.stringify(modes));
});
