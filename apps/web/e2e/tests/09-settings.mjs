import { see, L, eq, expect, go, lemoni, login, ok, one, open, seed, sleep, test, text } from '../lib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import cfg from '../e2e.config.mjs';

const require = createRequire(join(cfg.repo, 'package.json'));
const sharp = require('sharp');

async function pngFile(name, color) {
  const dir = join(cfg.results, 'files');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, name);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" rx="96" fill="${color}"/><circle cx="256" cy="256" r="120" fill="#fff"/></svg>`;
  writeFileSync(file, await sharp(Buffer.from(svg)).png().toBuffer());
  return file;
}

test('settings', 'logo upload shows in settings and on the shop page', async (t) => {
  const l = await lemoni();
  const before = one('SELECT logo_file_id AS f FROM organizations WHERE id = @o', { o: l.orgId })?.f;
  const page = await open(t, { tokens: await login(seed.owner) });
  await go(page, '/admin/settings');
  const file = await pngFile('logo.png', '#2F7D5B');
  await page.locator('input[type=file][accept*="png"]').first().setInputFiles(file);
  await see(page, L('settings.logo.saved'), 15_000);
  const after = one('SELECT logo_file_id AS f FROM organizations WHERE id = @o', { o: l.orgId })?.f;
  expect(after && after !== before, 'logo on the business', 'a new file', String(after));
  const img = page.locator(`img[alt="${L('settings.logo.alt', { org: 'Lemoni' })}"]`);
  await img.waitFor({ timeout: 8000 });
  const loaded = await img.evaluate((i) => i.complete && i.naturalWidth > 0);
  expect(loaded, 'logo image in settings', 'loaded', 'broken');
  const shop = await open(t, { device: 'phone' });
  await go(shop, '/s/lemoni');
  const headerLogo = await shop.evaluate(() => [...document.querySelectorAll('header img, img')].some((i) => /logo|files|uploads/.test(i.src) && i.naturalWidth > 0));
  expect(headerLogo, 'logo on the shop page', 'shown', 'not shown');
});

test('settings', 'profile photo upload shows on the account', async (t) => {
  const page = await open(t, { tokens: await login(seed.managerKif) });
  await go(page, '/admin');
  await page.getByRole('button', { name: /Maria Ioannou/ }).first().click();
  await page.waitForTimeout(500);
  const file = await pngFile('face.png', '#B0234F');
  await page.locator('input[type=file][accept="image/*"]').first().setInputFiles(file);
  await see(page, L('profile.saved'), 15_000);
  const u = one("SELECT avatar_file_id AS f FROM users WHERE email = @e", { e: seed.managerKif });
  expect(!!u?.f, 'avatar on the account', 'a file', 'none');
});

test('settings', 'catalog switch in settings changes what visitors see', async (t) => {
  const l = await lemoni();
  const page = await open(t, { tokens: await login(seed.owner) });
  await go(page, '/admin/settings');
  await page.getByRole('button', { name: L('settings.catalogMode.subscribers'), exact: true }).or(page.getByRole('radio', { name: L('settings.catalogMode.subscribers'), exact: true })).first().click();
  await sleep(1000);
  eq(one('SELECT customer_catalog AS c FROM organizations WHERE id = @o', { o: l.orgId }).c, 'subscribers', 'catalog after picking Followers');
  await page.getByRole('button', { name: L('settings.catalogMode.public'), exact: true }).or(page.getByRole('radio', { name: L('settings.catalogMode.public'), exact: true })).first().click();
  await sleep(1000);
  eq(one('SELECT customer_catalog AS c FROM organizations WHERE id = @o', { o: l.orgId }).c, 'public', 'catalog after picking Everyone');
});

test('settings', 'per shop setting select saves', async (t) => {
  const l = await lemoni();
  const page = await open(t, { tokens: await login(seed.owner) });
  await go(page, '/admin/settings');
  const sel = page.locator('main select').filter({ has: page.locator('option') }).nth(0);
  const selects = await page.locator('main select').count();
  expect(selects >= 1, 'per shop selects', 'at least one', selects);
  const options = await sel.locator('option').evaluateAll((o) => o.map((x) => x.value));
  const pick = options.find((v) => v && v !== (options[0] ?? '')) ?? options[0];
  await sel.selectOption(pick);
  await sleep(1200);
  await page.reload({ waitUntil: 'networkidle' });
  eq(await page.locator('main select').nth(0).inputValue(), pick, 'per shop setting after reload');
  void l;
});

test('settings', 'language switch persists across reloads', async (t) => {
  const page = await open(t, { tokens: await login(seed.staffKif) });
  await go(page, '/admin');
  await page.getByRole('button', { name: /Dimitris Kostas/ }).first().click();
  await page.waitForTimeout(400);
  await page.locator(`select[aria-label="${L('locale.label')}"]`).last().selectOption('el');
  await page.waitForTimeout(1500);
  await page.reload({ waitUntil: 'networkidle' });
  const body = await text(page);
  expect(body.includes(L('nav.home', {}, 'el')), 'Greek after reload', L('nav.home', {}, 'el'), body.slice(0, 80));
  const u = one('SELECT locale FROM users WHERE email = @e', { e: seed.staffKif });
  eq(u.locale, 'el', 'language on the account');
});
