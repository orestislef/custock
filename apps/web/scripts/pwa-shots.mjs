// the home screen app on a phone, end to end against a running api in dev mode (seeded demo data,
// email codes returned instead of sent). checks the manifests, the service worker, scanning with a
// fake camera showing a real EAN-13, a sale saved offline and synced, and the customer side.
// saves phone screenshots (jpeg) on the way.
//
//   WEB_URL=http://localhost:3097/custock node scripts/pwa-shots.mjs screenshots/pwa

import { chromium } from 'playwright';
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = process.argv[2] ?? 'screenshots/pwa';
const web = (process.env.WEB_URL ?? 'http://localhost:3097/custock').replace(/\/$/, '');
const api = `${web}/api/v1`;
const CODE = '5200044170102'; // thyme honey in the seeded shop
mkdirSync(out, { recursive: true });

// ---------------------------------------------------------------- a fake camera that shows a barcode

const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const R = L.map((p) => [...p].map((b) => (b === '0' ? '1' : '0')).join(''));
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
function ean13Bits(code) {
  const d = [...code].map(Number);
  let bits = '101';
  for (let i = 1; i <= 6; i++) bits += (PARITY[d[0]][i - 1] === 'L' ? L : G)[d[i]];
  bits += '01010';
  for (let i = 7; i <= 12; i++) bits += R[d[i]];
  return bits + '101';
}

async function fakeCamera(code) {
  const W = 640, H = 480, module = 4;
  const bits = ean13Bits(code);
  const bw = bits.length * module, x0 = (W - bw) / 2;
  const bars = [...bits].map((b, i) => (b === '1' ? `<rect x="${x0 + i * module}" y="150" width="${module}" height="180" fill="#000"/>` : '')).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="#d9d4c7"/><rect x="${x0 - 40}" y="120" width="${bw + 80}" height="250" rx="8" fill="#fff"/>${bars}<text x="${W / 2}" y="356" font-family="monospace" font-size="22" text-anchor="middle">${code}</text></svg>`;
  const { data } = await sharp(Buffer.from(svg)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  // rgb to yuv 4:2:0 for chrome's y4m fake capture
  const Y = Buffer.alloc(W * H), U = Buffer.alloc((W / 2) * (H / 2)), V = Buffer.alloc((W / 2) * (H / 2));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3, r = data[i], g = data[i + 1], b = data[i + 2];
    Y[y * W + x] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    if (y % 2 === 0 && x % 2 === 0) {
      const j = (y / 2) * (W / 2) + x / 2;
      U[j] = Math.round(128 - 0.168736 * r - 0.331264 * g + 0.5 * b);
      V[j] = Math.round(128 + 0.5 * r - 0.418688 * g - 0.081312 * b);
    }
  }
  const frame = Buffer.concat([Buffer.from('FRAME\n'), Y, U, V]);
  const file = join(tmpdir(), `custock-fake-camera-${code}.y4m`);
  writeFileSync(file, Buffer.concat([Buffer.from(`YUV4MPEG2 W${W} H${H} F10:1 Ip A1:1 C420jpeg\n`), ...Array(10).fill(frame)]));
  return file;
}

// ---------------------------------------------------------------- helpers

async function post(path, body, token) {
  const res = await fetch(`${api}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${path} ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ` (${extra})` : ''}`); };

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1';

const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${await fakeCamera(CODE)}`],
});

async function phone(opts = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    colorScheme: opts.scheme ?? 'light', locale: opts.locale ?? 'en', userAgent: opts.ios ? IPHONE : undefined,
    permissions: opts.camera ? ['camera'] : [],
  });
  await ctx.addCookies([{ name: 'locale', value: opts.locale ?? 'en', url: web }]);
  if (opts.tokens) await ctx.addInitScript((tk) => localStorage.setItem('custock.tokens', JSON.stringify(tk)), opts.tokens);
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  return { ctx, page };
}

const shot = async (page, name) => {
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(out, `${name}.jpg`), type: 'jpeg', quality: 72 });
};

// ---------------------------------------------------------------- manifests and service worker

{
  const m = await (await fetch(`${web}/manifest.webmanifest`)).json();
  check('staff manifest', m.start_url.endsWith('/admin') && m.icons.length === 3);
  const o = await (await fetch(`${web}/s/lemoni/manifest.webmanifest`)).json();
  check('business manifest', o.name.length > 0 && o.scope.endsWith('/s/lemoni'), o.name);
  const icon = await fetch(`${web}/s/lemoni/icon/512?maskable=1`);
  check('business icon', icon.ok && icon.headers.get('content-type') === 'image/png');
}

// ---------------------------------------------------------------- the front door

{
  const { ctx, page } = await phone({ ios: true });
  await page.goto(web, { waitUntil: 'networkidle' });
  await shot(page, '01-landing-en');
  // the worker registers after load, with the base path as its scope
  await page.goto(`${web}/admin/login`, { waitUntil: 'networkidle' });
  const sw = await page.evaluate(async () => {
    for (let i = 0; i < 40; i++) {
      const r = await navigator.serviceWorker.getRegistration();
      if (r?.active) return r.scope;
      await new Promise((ok) => setTimeout(ok, 250));
    }
    return '';
  });
  check('service worker', sw.endsWith('/'), sw);
  // offline, a page seen before comes from the cache, an unseen one shows the offline page
  await ctx.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  check('seen page offline', (await page.locator('input[type=email]').count()) > 0);
  await page.goto(`${web}/s/nowhere-${Date.now()}`, { waitUntil: 'domcontentloaded' }).catch(() => {});
  const offlineText = await page.locator('section:not([hidden]) h1').textContent().catch(() => '');
  check('offline page', /connection/i.test(offlineText ?? ''), offlineText ?? '');
  await shot(page, '02-offline-page-en');
  await ctx.setOffline(false);
  await ctx.close();
}

// ---------------------------------------------------------------- staff: settings, scan, offline sale

const maria = await post('/auth/login', { email: 'maria@example.com', password: 'custock' });
const eleni = await post('/auth/login', { email: 'eleni@example.com', password: 'custock' });

{
  const { ctx, page } = await phone({ tokens: eleni, locale: 'el' });
  await page.goto(`${web}/admin/settings`, { waitUntil: 'networkidle' });
  await shot(page, '03-settings-shop-page-el');
  const btn = page.getByRole('button', { name: 'Να τη βλέπουν όλοι' });
  if (await btn.count()) { await btn.click(); await page.waitForTimeout(800); }
  const pub = await fetch(`${api}/public/orgs/lemoni/catalog`);
  check('catalog made public from settings', pub.ok);
  await ctx.close();
}

{
  const { ctx, page } = await phone({ tokens: maria, camera: true });
  await page.goto(`${web}/admin`, { waitUntil: 'networkidle' });
  await shot(page, '04-staff-home-en');

  await page.goto(`${web}/admin/scan?mode=sell`, { waitUntil: 'networkidle' });
  // the fake camera shows the honey's barcode: a scan sells one
  const sold = await page.getByText(/Sold 1 ×/).first().waitFor({ timeout: 20000 }).then(() => true, () => false);
  check('camera scan sells one (wasm reader)', sold);
  await shot(page, '05-scan-sell-en');

  // offline: a sale from the product sheet waits on the device and syncs when back
  await page.goto(`${web}/admin/scan?mode=lookup`, { waitUntil: 'networkidle' });
  const opened = await page.waitForURL(/\/admin\/stock\//, { timeout: 20000 }).then(() => true, () => false);
  check('scan in look up opens the product', opened);
  await page.waitForLoadState('networkidle');
  await ctx.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  const receive = page.getByRole('button', { name: /Receive/ }).first();
  if (await receive.count()) {
    await receive.click();
    const primary = page.locator('[data-sheet-footer] .btn-primary');
    await primary.click();
    // stock below zero asks once more, inline
    await page.waitForTimeout(400);
    if (await primary.count()) await primary.click();
    const queued = await page.getByText(/not synced yet/).first().waitFor({ timeout: 8000 }).then(() => true, () => false);
    check('offline delivery waits in the outbox', queued);
    await shot(page, '06-offline-outbox-en');
  } else {
    check('offline delivery waits in the outbox', false, 'no receive button');
  }
  await ctx.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  const synced = await page.getByText(/saved movement synced/).first().waitFor({ timeout: 15000 }).then(() => true, () => false);
  check('outbox syncs when back online', synced);

  await page.goto(`${web}/admin`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Account' }).click();
  await shot(page, '07-account-alerts-en');
  check('staff pages without errors', page.errors.length === 0, page.errors.slice(0, 2).join(' | '));
  await ctx.close();
}

// ---------------------------------------------------------------- customer: sign in by code, catalog, product, news, you

{
  const { ctx, page } = await phone({ ios: true, locale: 'ru' });
  await page.goto(`${web}/s/lemoni`, { waitUntil: 'networkidle' });
  await shot(page, '08-catalog-coach-ru');
  await page.goto(`${web}/s/lemoni/me`, { waitUntil: 'networkidle' });
  await page.locator('input[type=email]').fill('anna@example.com');
  await page.locator('form button[type=submit]').click();
  const devLine = page.getByText(/код \d{6}|code is \d{6}/);
  await devLine.waitFor({ timeout: 10000 });
  const code = (await devLine.textContent()).match(/\d{6}/)[0];
  await page.locator('input[autocomplete=one-time-code]').fill(code);
  await page.locator('form button[type=submit]').click();
  const signedIn = await page.getByText('anna@example.com').waitFor({ timeout: 10000 }).then(() => true, () => false);
  check('customer signs in with an email code', signedIn);
  await shot(page, '09-you-ru');
  await page.goto(`${web}/s/lemoni/news`, { waitUntil: 'networkidle' });
  await shot(page, '10-news-ru');
  await page.goto(`${web}/s/lemoni`, { waitUntil: 'networkidle' });
  await page.locator('ul.grid a').first().click();
  await page.waitForLoadState('networkidle');
  await shot(page, '11-product-ru');
  check('customer pages without errors', page.errors.length === 0, page.errors.slice(0, 2).join(' | '));
  await ctx.close();
}

// ---------------------------------------------------------------- install steps on iphone, dark

{
  const { ctx, page } = await phone({ ios: true, scheme: 'dark', locale: 'el' });
  await page.goto(`${web}/s/lemoni`, { waitUntil: 'networkidle' });
  const how = page.getByRole('button', { name: 'Δείξτε μου πώς' });
  if (await how.count()) { await how.click(); await shot(page, '12-install-steps-dark-el'); }
  check('install steps on iphone', (await how.count()) > 0);
  await ctx.close();
}

// ---------------------------------------------------------------- an invite link for a new person

{
  const roles = await (await fetch(`${api}/orgs/${(await (await fetch(`${api}/me/context`, { headers: { Authorization: `Bearer ${eleni.accessToken}` } })).json()).orgs[0].orgId}/roles`, { headers: { Authorization: `Bearer ${eleni.accessToken}` } })).json();
  const me = await (await fetch(`${api}/me/context`, { headers: { Authorization: `Bearer ${eleni.accessToken}` } })).json();
  const org = me.orgs[0];
  const staff = roles.find((r) => r.templateKey === 'staff');
  const inv = await post(`/orgs/${org.orgId}/invites`, { email: `new.${Date.now()}@example.com`, roleId: staff.id, scopeType: 'shop', scopeId: org.shops[0].shopId, locale: 'en' }, eleni.accessToken).catch((e) => ({ error: String(e) }));
  if (inv.link) {
    const { ctx, page } = await phone({});
    await page.goto(inv.link.replace(/^https?:\/\/[^/]+(\/custock)?/, web), { waitUntil: 'networkidle' });
    await shot(page, '13-invite-en');
    check('invite page shows the register form', (await page.locator('input[autocomplete=new-password]').count()) === 1);
    await ctx.close();
  } else {
    check('invite created', false, inv.error);
  }
}

await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} of ${results.length} checks passed`);
process.exit(failed ? 1 : 0);
