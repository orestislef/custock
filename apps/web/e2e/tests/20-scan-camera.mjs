// the camera in real use, with a stand-in reader that sees what the test puts in front of it, a
// picture at a time, with positions: a shelf label (barcode and qr code) held still, the reader
// handing them over in turns, taken away and shown again, a neighbour outside the white frame, and
// two products one after the other. the database says what was sold.
import { L, WEB, eq, expect, go, lemoni, login, ok, onHand, open, seed, sleep, test } from '../lib.mjs';

// a stand-in BarcodeDetector: window.__reads lists what is in front of the camera, positions as a
// share of the picture. alternate: hand over one code per picture, in turns, like the live reader.
async function fakeCamera(page) {
  await page.addInitScript(() => {
    window.__reads = [];
    window.__alternate = false;
    let n = 0;
    class FakeDetector {
      static async getSupportedFormats() { return ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'itf', 'code_128', 'code_39', 'qr_code', 'data_matrix']; }
      async detect(v) {
        const w = v.videoWidth;
        const h = v.videoHeight;
        let reads = (window.__reads || []).map((r) => ({ rawValue: r.raw, format: r.format, boundingBox: { x: r.cx * w - 20, y: r.cy * h - 8, width: 40, height: 16 } }));
        if (window.__alternate && reads.length > 1) reads = [reads[n++ % reads.length]];
        return reads;
      }
    }
    window.BarcodeDetector = FakeDetector;
  });
}

const show = (page, reads, alternate = false) => page.evaluate(([r, a]) => { window.__reads = r; window.__alternate = a; }, [reads, alternate]);

// the mode chip, waited for and checked: a scan in the wrong mode would open the product instead
async function useMode(page, mode) {
  const chip = page.getByRole('button', { name: L(`scanner.mode.${mode}`), exact: true }).or(page.getByRole('radio', { name: L(`scanner.mode.${mode}`), exact: true })).first();
  await chip.waitFor({ state: 'visible', timeout: 15_000 });
  await chip.click();
  await page.waitForFunction((label) => [...document.querySelectorAll('button,[role=radio]')].some((b) => b.textContent?.trim() === label && (b.getAttribute('aria-pressed') === 'true' || b.getAttribute('aria-checked') === 'true')), L(`scanner.mode.${mode}`), { timeout: 5000 });
}

async function cameraOn(page) {
  const go = page.getByRole('button', { name: L('scanner.useCamera') });
  if (await go.isVisible().catch(() => false)) await go.click();
  await page.locator('.scan-frame').waitFor({ state: 'visible', timeout: 15_000 });
}

// the owner, in Kifisia: other tests change the managers' roles while this one runs.
// products of its own, with 20 in stock at Kifisia: the other tests run at the same time and sell
// the shared ones, which would throw the numbers off
const ean = (twelve) => {
  const sum = [...twelve].reduce((n, d, i) => n + Number(d) * (i % 2 ? 3 : 1), 0);
  return twelve + ((10 - (sum % 10)) % 10);
};
async function ownProducts(l, n) {
  const owner = await login(seed.owner);
  const out = [];
  for (let i = 0; i < n; i++) {
    const code = ean('5209' + String(Date.now()).slice(-7) + i);
    const p = await ok(`/v1/orgs/${l.orgId}/products`, { method: 'POST', token: owner, body: { name: `E2E camera ${code}`, priceMinor: 300, barcode: code } });
    const variantId = p.variants[0].id;
    await ok(`/v1/orgs/${l.orgId}/movements`, { method: 'POST', token: owner, body: { movements: [{ id: crypto.randomUUID(), shopId: l.kifisia, variantId, qtyDelta: 20, kind: 'receive', occurredAt: Date.now() }] } });
    out.push({ code, variantId });
  }
  return out;
}

test('stock', 'camera: a shelf label held still sells one, shown again sells one more, neighbours and the other code do not count', async (t) => {
  const l = await lemoni();
  const [a, b, c] = await ownProducts(l, 3);
  const page = await open(t, { tokens: await login(seed.owner), permissions: ['camera'], storage: { 'custock.shop': l.kifisia } });
  await fakeCamera(page);
  await go(page, '/admin/scan?mode=sell');
  await useMode(page, 'sell');
  await cameraOn(page);
  const startA = await onHand(a.variantId, l.kifisia);
  const startC = await onHand(c.variantId, l.kifisia);
  const label = [
    { raw: a.code, format: 'ean_13', cx: 0.5, cy: 0.52 },
    { raw: `${WEB}/p/${a.code}`, format: 'qr_code', cx: 0.6, cy: 0.5 },
  ];

  t.step('the label held still for 4 seconds, the reader handing over barcode and qr in turns');
  await show(page, label, true);
  await sleep(4000);
  eq(await onHand(a.variantId, l.kifisia), startA - 1, 'one sold, not one per picture');

  t.step('taken away for 2.5 seconds and shown again');
  await show(page, []);
  await sleep(2500);
  await show(page, label);
  await sleep(2500);
  eq(await onHand(a.variantId, l.kifisia), startA - 2, 'a second one sold');

  t.step('a neighbour at the edge of the picture, outside the white frame');
  await show(page, [{ raw: c.code, format: 'ean_13', cx: 0.04, cy: 0.06 }]);
  await sleep(2500);
  eq(await onHand(c.variantId, l.kifisia), startC, 'nothing sold from outside the frame');

  t.step('two different products one after the other, quickly');
  const startB = await onHand(b.variantId, l.kifisia);
  await show(page, []);
  await sleep(1800);
  await show(page, [{ raw: a.code, format: 'ean_13', cx: 0.5, cy: 0.52 }]);
  await sleep(500);
  await show(page, [{ raw: b.code, format: 'ean_13', cx: 0.5, cy: 0.52 }]);
  await sleep(2500);
  eq(await onHand(a.variantId, l.kifisia), startA - 3, 'the first sold');
  eq(await onHand(b.variantId, l.kifisia), startB - 1, 'the second sold too, not lost behind the first');

  t.step('one more of the same with +, no scan; a quick double tap is still one');
  await page.locator(`button[aria-label^="${L('scanner.sellOneMore', { name: '' }).trim()}"]`).first().dblclick();
  await sleep(1500);
  const after = (await onHand(a.variantId, l.kifisia)) + (await onHand(b.variantId, l.kifisia));
  eq(after, startA - 3 + startB - 1 - 1, 'one more sold from the list');
});

test('stock', 'camera: in receive mode a label held still is one, the list does not run up', async (t) => {
  const l = await lemoni();
  const [a] = await ownProducts(l, 1);
  const page = await open(t, { tokens: await login(seed.owner), permissions: ['camera'], storage: { 'custock.shop': l.kifisia } });
  await fakeCamera(page);
  await go(page, '/admin/scan?mode=receive');
  await useMode(page, 'receive');
  await cameraOn(page);
  await show(page, [
    { raw: a.code, format: 'ean_13', cx: 0.5, cy: 0.52 },
    { raw: `${WEB}/p/${a.code}`, format: 'qr_code', cx: 0.6, cy: 0.5 },
  ], true);
  await sleep(4000);
  const cta = page.getByRole('button', { name: new RegExp(L('scanner.receiveCta', { count: 1 }).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) });
  expect(await cta.isVisible().catch(() => false), 'receive list', 'shows 1 to receive', await page.locator('main').innerText().catch(() => ''));
});
