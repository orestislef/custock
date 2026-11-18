import { L, expect, go, login, open, path, permissionWords, seed, test } from '../lib.mjs';

// every admin page, and the nav entry that leads to it (null: reached from a button on another page)
const PAGES = [
  ['/admin/stock', '/admin/stock'], ['/admin/scan', '/admin/scan'], ['/admin/customers', '/admin/customers'],
  ['/admin/posts', '/admin/posts'], ['/admin/reports', '/admin/reports'], ['/admin/team', '/admin/team'],
  ['/admin/join-links', '/admin/join-links'], ['/admin/settings', '/admin/settings'], ['/admin/audit', '/admin/audit'],
  ['/admin/stock/counts', '/admin/stock/counts'], ['/admin/stock/transfers', '/admin/stock/transfers'],
  ['/admin/stock/new', null], ['/admin/posts/new', null], ['/admin/team/roles', null], ['/admin/stock/categories', null],
];
// the page that holds the button for a page without its own nav entry
const PARENT = { '/admin/stock/new': '/admin/stock', '/admin/posts/new': '/admin/posts', '/admin/team/roles': '/admin/team', '/admin/stock/categories': '/admin/stock' };

const ROLES = [
  ['owner', seed.owner], ['admin', seed.admin], ['manager', seed.managerKif], ['staff', seed.staffKif], ['viewer', seed.viewer],
];

async function navLinks(page) {
  return page.evaluate((base) => [...document.querySelectorAll('nav a[href]')].map((a) => new URL(a.href).pathname.replace(base, '')), '/custock');
}

for (const [role, email] of ROLES) {
  test('roles', `${role}: navigation shows only pages that open, the rest go Home`, async (t) => {
    const tokens = await login(email);
    const page = await open(t, { tokens });
    await go(page, '/admin');
    // the stock section lists its own pages (counts, transfers) once it is open
    const links = new Set(await navLinks(page));
    if (links.has('/admin/stock')) { await go(page, '/admin/stock'); for (const x of await navLinks(page)) links.add(x); }
    const problems = [];
    for (const [p, nav] of PAGES) {
      let allowed = nav ? links.has(nav) : false;
      if (!nav) {
        await go(page, PARENT[p]);
        const hrefs = await page.evaluate((base) => [...document.querySelectorAll('a[href]')].map((a) => new URL(a.href).pathname.replace(base, '')), '/custock');
        allowed = hrefs.includes(p);
      }
      t.step(`${p} (${allowed ? 'shown' : 'hidden'})`);
      await go(page, p);
      await page.waitForTimeout(400);
      const landed = path(page);
      if (allowed && landed !== p) problems.push(`${p} is offered but goes to ${landed}`);
      if (!allowed && landed !== '/admin') problems.push(`${p} is not offered but opens (${landed})`);
    }
    expect(problems.length === 0, `${role} pages`, 'offered pages open, others go Home', problems.join('; '));
  });

  test('roles', `${role}: no permission wording on any page they can open (en)`, async (t) => {
    const tokens = await login(email);
    const page = await open(t, { tokens });
    await go(page, '/admin');
    const links = [...new Set(await navLinks(page))];
    const found = [];
    for (const p of ['/admin', ...links]) {
      // the role editor is where owners and admins manage rights, so it may name them
      if (/\/admin\/team\/roles/.test(p)) continue;
      await go(page, p);
      const w = await permissionWords(page, 'en');
      if (w.length) found.push(`${p}: ${w.join(', ')}`);
    }
    expect(found.length === 0, `${role} wording`, 'no words about rights', found.join(' | '));
  });
}

for (const [role, email, locale] of [['manager', seed.managerKif, 'el'], ['staff', seed.staffMar, 'ru'], ['viewer', seed.viewer, 'el']]) {
  test('roles', `${role}: no permission wording in ${locale}`, async (t) => {
    const tokens = await login(email);
    const page = await open(t, { tokens, locale });
    await go(page, '/admin');
    const links = [...new Set(await navLinks(page))];
    const found = [];
    for (const p of ['/admin', ...links]) {
      await go(page, p);
      const w = await permissionWords(page, locale);
      if (w.length) found.push(`${p}: ${w.join(', ')}`);
    }
    expect(found.length === 0, `${role} wording in ${locale}`, 'no words about rights', found.join(' | '));
  });
}

test('roles', 'staff: the phone tab bar lists only their sections', async (t) => {
  const tokens = await login(seed.staffKif);
  const page = await open(t, { tokens, device: 'phone' });
  await go(page, '/admin');
  const tabs = await page.evaluate(() => {
    const bar = [...document.querySelectorAll('nav')].find((n) => getComputedStyle(n).position === 'fixed');
    return bar ? [...bar.querySelectorAll('a, button')].map((a) => a.textContent.trim()).filter(Boolean) : [];
  });
  expect(tabs.length >= 2, 'tab bar', 'present', JSON.stringify(tabs));
  for (const name of [L('nav.team'), L('nav.audit'), L('nav.settings')]) expect(!tabs.includes(name), `staff tab ${name}`, 'hidden', 'shown');
});
