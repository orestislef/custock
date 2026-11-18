import { L, a11y, expect, go, login, open, overflow, pageProblems, seed, sheetGaps, shot, test, text, underTabBar } from '../lib.mjs';
import { openSheet, superAdmin } from '../helpers.mjs';

const STAFF_PAGES = ['/admin', '/admin/stock', '/admin/scan', '/admin/customers', '/admin/posts', '/admin/posts/new', '/admin/reports', '/admin/team', '/admin/team/roles', '/admin/join-links', '/admin/settings', '/admin/audit', '/admin/stock/counts', '/admin/stock/transfers', '/admin/stock/new', '/admin/stock/categories'];
const PUBLIC_PAGES = ['/', '/admin/login', '/admin/forgot', '/s/lemoni', '/s/lemoni/offers', '/s/lemoni/news', '/s/lemoni/me', '/j/kif7q2', '/p/5200044170102'];

async function sweep(t, page, pages, { checkBar = true } = {}) {
  const found = { overflow: [], bar: [], imgs: [], inputs: [] };
  for (const p of pages) {
    t.step(p);
    await go(page, p);
    await page.waitForTimeout(500);
    const o = await overflow(page);
    if (o.scroll) found.overflow.push(`${p} (${o.items.join(', ')})`);
    if (checkBar) {
      const covered = await underTabBar(page);
      if (covered) found.bar.push(`${p} (${covered}px under the bar)`);
    }
    const a = await a11y(page);
    if (a.imgs.length) found.imgs.push(`${p}: ${a.imgs.join(', ')}`);
    if (a.inputs.length) found.inputs.push(`${p}: ${a.inputs.join(', ')}`);
  }
  return found;
}

test('layout', 'phone: owner pages have no sideways scroll', async (t) => {
  const page = await open(t, { tokens: await login(seed.owner), device: 'phone' });
  const f = await sweep(t, page, STAFF_PAGES);
  t.found = f;
  expect(f.overflow.length === 0, 'pages wider than the phone', 'none', f.overflow.join('; '));
});

test('layout', 'phone: nothing hides under the tab bar', async (t) => {
  const page = await open(t, { tokens: await login(seed.owner), device: 'phone' });
  const f = await sweep(t, page, STAFF_PAGES);
  expect(f.bar.length === 0, 'content under the floating tab bar at the end of the page', 'none', f.bar.join('; '));
});

test('layout', 'phone: every image has alt text and every field has a name (staff)', async (t) => {
  const page = await open(t, { tokens: await login(seed.owner), device: 'phone' });
  const f = await sweep(t, page, STAFF_PAGES, { checkBar: false });
  expect(f.imgs.length === 0, 'images without alt', 'none', f.imgs.join('; '));
  expect(f.inputs.length === 0, 'fields without an accessible name', 'none', f.inputs.join('; '));
});

test('layout', 'phone: customer and public pages', async (t) => {
  const page = await open(t, { device: 'phone' });
  const f = await sweep(t, page, PUBLIC_PAGES);
  const all = [...f.overflow.map((x) => `overflow ${x}`), ...f.bar.map((x) => `under bar ${x}`), ...f.imgs.map((x) => `no alt ${x}`), ...f.inputs.map((x) => `no name ${x}`)];
  expect(all.length === 0, 'customer pages', 'no overflow, nothing under the bar, alt texts, named fields', all.join('; '));
});

test('layout', 'phone: super admin pages', async (t) => {
  const sa = await superAdmin();
  const page = await open(t, { tokens: sa.tokens, device: 'phone' });
  const f = await sweep(t, page, ['/admin/platform', '/admin/platform/errors', '/admin/platform/api', '/admin/platform/server', '/admin/platform/audit'], { checkBar: false });
  const all = [...f.overflow, ...f.imgs, ...f.inputs];
  expect(all.length === 0, 'super admin pages on a phone', 'no overflow, alt texts, named fields', all.join('; '));
});

test('layout', 'sheet buttons keep room between them', async (t) => {
  const page = await open(t, { tokens: await login(seed.owner), device: 'phone' });
  const found = [];
  await go(page, '/admin/team');
  await openSheet(page, page.getByRole('button', { name: L('team.invite') }).first());
  found.push(...(await sheetGaps(page)).map((g) => `invite: ${g}`));
  await go(page, '/admin/stock/counts');
  const start = page.getByRole('button', { name: /Start a count/ }).first();
  if (await start.isVisible().catch(() => false)) { await openSheet(page, start); found.push(...(await sheetGaps(page)).map((g) => `count: ${g}`)); }
  const sa = await superAdmin();
  const p2 = await open(t, { tokens: sa.tokens, device: 'phone' });
  await go(p2, '/admin/platform');
  await openSheet(p2, p2.getByRole('button', { name: L('platform.newBusiness') }).first());
  found.push(...(await sheetGaps(p2)).map((g) => `new business: ${g}`));
  expect(found.length === 0, 'buttons closer than 8px', 'none', found.join('; '));
});

test('layout', 'dark mode spot check: dark surfaces, readable text', async (t) => {
  const page = await open(t, { tokens: await login(seed.owner), device: 'phone', scheme: 'dark' });
  const bad = [];
  for (const p of ['/admin', '/admin/stock', '/admin/settings']) {
    await go(page, p);
    await shot(page, `dark${p.replace(/\//g, '-')}`);
    const c = await page.evaluate(() => {
      const bg = getComputedStyle(document.body).backgroundColor;
      const h = document.querySelector('h1');
      return { bg, ink: h ? getComputedStyle(h).color : '' };
    });
    const lum = (s) => { const m = s.match(/\d+/g)?.map(Number) ?? [255, 255, 255]; return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255; };
    if (lum(c.bg) > 0.3 || (c.ink && lum(c.ink) < 0.6)) bad.push(`${p} bg ${c.bg} title ${c.ink}`);
  }
  expect(bad.length === 0, 'dark mode colors', 'dark background, light titles', bad.join('; '));
});

for (const locale of ['el', 'ru']) {
  test('layout', `${locale}: main screens are translated, no raw keys or English left`, async (t) => {
    const page = await open(t, { tokens: await login(seed.owner), locale, device: 'phone' });
    const bad = [];
    for (const p of ['/admin', '/admin/stock', '/admin/scan', '/admin/customers', '/admin/posts', '/admin/settings']) {
      await go(page, p);
      const body = await text(page);
      // email addresses (name.surname@...) are not keys
      const keys = [...body.matchAll(/\b[a-z]+(?:\.[a-z][A-Za-z]+){1,3}\b/g)]
        .filter((m) => body[m.index + m[0].length] !== '@' && !/\.(gr|com|dev|app|png|jpg|webp)\b/.test(m[0])).map((m) => m[0]);
      if (keys.length) bad.push(`${p}: keys ${[...new Set(keys)].slice(0, 3).join(', ')}`);
      for (const en of [L('nav.stock'), L('nav.customers'), L('nav.settings'), 'Needs you', 'At a glance']) {
        if (body.split('\n').some((line) => line.trim() === en)) bad.push(`${p}: English "${en}"`);
      }
    }
    expect(bad.length === 0, `${locale} texts`, 'all translated', bad.join('; '));
  });
}

test('layout', 'no page errors or failed requests during the whole run', async () => {
  const real = pageProblems.filter((p) => p.problems.some((x) => /pageerror|http 5|console/.test(x)));
  expect(real.length === 0, 'page errors seen by earlier tests', 'none', real.slice(0, 6).map((p) => `${p.test} ${p.page}: ${p.problems.join(' / ').slice(0, 160)}`).join(' | '));
});
