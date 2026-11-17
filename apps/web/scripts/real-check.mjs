// walks the admin against the real api: signs in through the login page as each sample person,
// opens every section, and reports console errors and failed api calls.
//   node scripts/real-check.mjs <outDir>

// start the api with CUSTOCK_DEV=1 CUSTOCK_SEED=1 first: sample logins and the dev outbox need both.

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2] ?? 'screenshots/tmp/real';
const base = process.env.WEB_URL ?? 'http://localhost:3000';
mkdirSync(out, { recursive: true });

const people = (process.env.PEOPLE ?? 'Maria Ioannou,Eleni Papadopoulou,Dimitris Kostas,Sofia Alexiou').split(',');
const sections = (process.env.SECTIONS ?? '/admin,/admin/stock,/admin/stock/new,/admin/stock/counts,/admin/stock/transfers,/admin/customers,/admin/posts,/admin/posts/new,/admin/reports,/admin/team,/admin/team/roles,/admin/settings,/admin/join-links,/admin/audit,/admin/dev-outbox').split(',');

const browser = await chromium.launch();
for (const person of people) {
  const phone = process.env.VIEW === 'phone';
  const lang = process.env.LANG_CODE ?? 'en';
  const ctx = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 860 }, deviceScaleFactor: Number(process.env.DPR ?? (phone ? 2 : 1)), colorScheme: process.env.SCHEME ?? 'light', locale: lang });
  await ctx.addCookies([{ name: 'locale', value: lang, url: base }]);
  const page = await ctx.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console ${m.text().slice(0, 160)}`); });
  page.on('response', (r) => { if (r.url().includes('/api/v1/') && r.status() >= 400) problems.push(`${r.status()} ${r.url().replace(base, '')}`); });

  await page.goto(`${base}/admin/login`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: new RegExp(person) }).click();
  await page.waitForURL(`${base}/admin`, { timeout: 15000 });
  await page.waitForTimeout(800);
  const slug = person.split(' ')[0].toLowerCase();
  for (const s of sections) {
    await page.goto(base + s, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(out, `${slug}${s.replace(/\//g, '-')}.png`), fullPage: !phone });
  }
  // open the first product and the first customer
  await page.goto(`${base}/admin/stock`, { waitUntil: 'networkidle' });
  const firstProduct = page.locator('main :is(.list, .table) a[href^="/admin/stock/"]').first();
  if (await firstProduct.count()) {
    await firstProduct.click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(out, `${slug}-product.png`), fullPage: true });
  }
  await page.goto(`${base}/admin/customers`, { waitUntil: 'networkidle' });
  const firstCustomer = page.locator('a[href^="/admin/customers/"]').first();
  if (await firstCustomer.count()) {
    await firstCustomer.click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(out, `${slug}-customer.png`), fullPage: true });
  }
  console.log(`${person}: ${problems.length ? '\n  ' + [...new Set(problems)].slice(0, 12).join('\n  ') : 'no problems'}`);
  await ctx.close();
}
await browser.close();
