// screenshots of the key pages for visual review. run with the web app on :3000.
//   node scripts/shots.mjs <outDir> [filter]
// logs in to the admin by seeding the dev token for a sample person (fixture mode).

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2] ?? 'screenshots/tmp';
const filter = process.argv[3] ?? '';
const base = process.env.WEB_URL ?? 'http://localhost:3000';
mkdirSync(out, { recursive: true });

const pages = [
  { name: 'home', path: '/' },
  { name: 'join', path: '/j/kif7q2' },
  { name: 'shelf', path: '/p/5200044170102' },
  { name: 'catalog', path: '/s/lemoni' },
  { name: 'offers', path: '/s/lemoni/offers' },
  { name: 'login', path: '/admin/login' },
  { name: 'dashboard', path: '/admin', as: 'u-maria' },
  { name: 'stock', path: '/admin/stock', as: 'u-maria' },
  { name: 'product', path: '/admin/stock/p-honey', as: 'u-maria' },
  { name: 'customers', path: '/admin/customers', as: 'u-dimitris' },
  { name: 'customer', path: '/admin/customers/c-1', as: 'u-eleni' },
  { name: 'posts', path: '/admin/posts', as: 'u-nikos' },
  { name: 'composer', path: '/admin/posts/new', as: 'u-maria' },
  { name: 'team', path: '/admin/team', as: 'u-maria' },
  { name: 'roles', path: '/admin/team/roles', as: 'u-nikos' },
  { name: 'reports', path: '/admin/reports', as: 'u-eleni' },
  { name: 'settings', path: '/admin/settings', as: 'u-eleni' },
  { name: 'links', path: '/admin/join-links', as: 'u-eleni' },
];

const variants = (process.env.VARIANTS ?? 'phone-light-el,desktop-light-en,phone-dark-ru,desktop-dark-el').split(',');

const browser = await chromium.launch();
for (const v of variants) {
  const [device, scheme, locale] = v.split('-');
  const viewport = device === 'phone' ? { width: 390, height: 844 } : { width: 1280, height: 860 };
  const ctx = await browser.newContext({ viewport, colorScheme: scheme, deviceScaleFactor: device === 'phone' ? 2 : 1, locale });
  await ctx.addCookies([{ name: 'locale', value: locale, url: base }]);
  for (const p of pages) {
    if (filter && !p.name.includes(filter)) continue;
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    if (p.as) {
      await page.addInitScript((user) => {
        localStorage.setItem('custock.tokens', JSON.stringify({ accessToken: `dev.${user}`, refreshToken: `devr.${user}`, expiresAt: Date.now() + 9e5 }));
        for (const k of ['tip.dash-qr', 'tip.stock-scan', 'tip.links-label']) localStorage.removeItem(k);
      }, p.as);
    }
    await page.goto(base + p.path, { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(out, `${p.name}-${v}.png`), fullPage: device !== 'phone' });
    if (errors.length) console.log(`${p.name} ${v}: ${errors.slice(0, 3).join(' | ')}`);
    await page.close();
  }
  await ctx.close();
}
await browser.close();
console.log('done');
