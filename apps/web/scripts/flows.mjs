// clicks through the main write flows against the running api, as the owner:
// create a product, receive stock someone waits for, publish a post, count, transfer,
// then checks the dev outbox and the audit log. prints one line per step.
//   node scripts/flows.mjs <outDir>

// start the api with CUSTOCK_DEV=1 CUSTOCK_SEED=1 first: sample logins and the dev outbox need both.

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2] ?? 'screenshots/flows';
const base = process.env.WEB_URL ?? 'http://localhost:3000';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en' });
await ctx.addCookies([{ name: 'locale', value: 'en', url: base }]);
const page = await ctx.newPage();
const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror ${e.message}`));
page.on('response', (r) => { if (r.url().includes('/api/v1/') && r.status() >= 400) problems.push(`${r.status()} ${r.request().method()} ${r.url().replace(base, '')}`); });

const results = [];
async function step(name, fn) {
  try {
    await fn();
    results.push(`ok    ${name}`);
  } catch (e) {
    results.push(`FAIL  ${name}: ${String(e.message).split('\n')[0].slice(0, 160)}`);
    await page.screenshot({ path: join(out, `fail-${name.replace(/\W+/g, '-')}.png`), fullPage: true }).catch(() => {});
  }
}
const toast = () => page.locator('.toast').first();

await step('sign in as owner', async () => {
  await page.goto(`${base}/admin/login`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Eleni/ }).click();
  await page.waitForURL(`${base}/admin`, { timeout: 15000 });
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(800);
});

await step('create a product', async () => {
  await page.goto(`${base}/admin/stock/new`, { waitUntil: 'networkidle' });
  const name = `Flow test olive paste ${Date.now() % 100000}`;
  await page.locator('input.field').first().fill(name);
  await page.getByLabel('Price with VAT').fill('4,50');
  await page.getByRole('button', { name: 'Make our own label code' }).click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Create product' }).click();
  await page.waitForURL(/\/admin\/stock\/[^/]+$/, { timeout: 15000 });
  await page.getByRole('heading', { name }).waitFor({ timeout: 10000 });
  await page.screenshot({ path: join(out, 'product-created.png'), fullPage: true });
});

await step('receive stock people wait for', async () => {
  await page.goto(`${base}/admin/stock?filter=waiting`, { waitUntil: 'networkidle' });
  await page.locator('main .list a[href^="/admin/stock/"]').first().click();
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Receive' }).first().click();
  const sheet = page.getByRole('dialog');
  await sheet.waitFor();
  const shopSelect = sheet.locator('select').first();
  // pick the shop where people wait, if the badge shows it
  const options = await shopSelect.locator('option').allTextContents();
  if (options.includes('Kifisia')) await shopSelect.selectOption({ label: 'Kifisia' });
  await sheet.getByLabel('Quantity').fill('6');
  await sheet.getByRole('button', { name: /Receive 6/ }).click();
  await toast().waitFor({ timeout: 10000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(out, 'received.png'), fullPage: true });
});

await step('publish a post', async () => {
  await page.goto(`${base}/admin/posts/new`, { waitUntil: 'networkidle' });
  await page.getByLabel('Title').fill('Flow test: fresh pistachios are in');
  await page.getByLabel('What do you want to tell them?').fill('Picked last week on Aegina. Come and taste.');
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: /^(Publish|Submit for approval)$/ }).click();
  await page.waitForURL(/\/admin\/posts\/[^/]+$/, { timeout: 15000 });
  await page.screenshot({ path: join(out, 'post.png'), fullPage: true });
});

await step('run jobs and see the outbox', async () => {
  await page.goto(`${base}/admin/dev-outbox`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Run jobs now' }).click();
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: 'Refresh' }).click();
  await page.waitForTimeout(1000);
  const n = await page.locator('main li').count();
  if (!n) throw new Error('outbox is empty after publish and receive');
  await page.screenshot({ path: join(out, 'outbox.png'), fullPage: true });
  results.push(`      outbox shows ${n} messages`);
});

await step('count stock', async () => {
  await page.goto(`${base}/admin/stock/counts`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Start a count' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Start counting' }).click();
  await page.waitForURL(/\/admin\/stock\/counts\/[^/]+$/, { timeout: 15000 });
  await page.getByRole('button', { name: 'Add product' }).click();
  await page.getByRole('dialog').locator('button.row').first().click();
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: 'Send for review' }).click();
  await page.getByRole('button', { name: 'Apply differences' }).click({ timeout: 10000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(out, 'count.png'), fullPage: true });
});

await step('transfer between shops', async () => {
  await page.goto(`${base}/admin/stock/transfers`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'New transfer' }).first().click();
  const sheet = page.getByRole('dialog');
  await sheet.getByRole('button', { name: 'Add product' }).click();
  await page.getByRole('dialog').last().locator('button.row').first().click();
  await page.waitForTimeout(400);
  await page.getByRole('dialog').getByRole('button', { name: 'Save draft' }).click();
  await page.waitForURL(/\/admin\/stock\/transfers\/[^/]+$/, { timeout: 15000 });
  await page.getByRole('button', { name: 'Send' }).click();
  await toast().waitFor({ timeout: 10000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(out, 'transfer.png'), fullPage: true });
});

await step('audit log has entries', async () => {
  await page.goto(`${base}/admin/audit`, { waitUntil: 'networkidle' });
  const n = await page.locator('main .row').count();
  if (n < 3) throw new Error(`only ${n} audit rows`);
  await page.screenshot({ path: join(out, 'audit.png'), fullPage: true });
});

console.log(results.join('\n'));
console.log(problems.length ? `problems:\n  ${[...new Set(problems)].slice(0, 15).join('\n  ')}` : 'no api errors');
await browser.close();
