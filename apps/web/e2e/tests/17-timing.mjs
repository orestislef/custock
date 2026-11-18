// real life timing in the browser: the session running out halfway through a long form, two people
// saving the same product, the network dropping mid save, a slow network and a double tap, rights
// changing while a page is open, and a page of the old version after a deploy.

import { L, eq, expect, go, lemoni, login, ok, one, path, permissionWords, see, seed, sleep, test } from '../lib.mjs';
import { newPerson, waitPath } from '../helpers.mjs';
import cfg from '../e2e.config.mjs';

const stamp = () => Date.now().toString(36);
const nameInput = (page) => page.getByLabel(L('stock.form.name'), { exact: false }).first();
const createBtn = (page) => page.getByRole('button', { name: L('productForm.create'), exact: true });

test('timing', 'the session runs out halfway through a post: after signing in again the text is still there', async (t) => {
  const page = await open2(t, seed.owner);
  await go(page, '/admin/posts/new');
  const title = `E2E Typed before ${stamp()}`;
  await page.getByPlaceholder(L('composer.titlePh')).fill(title);
  await page.locator('textarea').first().fill('Everything typed here comes back.');
  await sleep(700);
  t.step('the session dies, then save');
  await page.evaluate(() => localStorage.setItem('custock.tokens', JSON.stringify({ accessToken: 'gone', refreshToken: 'gone', expiresAt: Date.now() - 1000 })));
  await page.getByRole('button', { name: L('composer.saveDraft'), exact: true }).click();
  await waitPath(page, /^\/admin\/login/);
  await page.locator('input[type=email]').fill(seed.owner);
  await page.locator('input[autocomplete="current-password"]').fill(cfg.password);
  await page.getByRole('button', { name: L('common:action.signIn'), exact: true }).click();
  await waitPath(page, /\/posts\/new$/);
  await see(page, L('draft.restored'));
  eq(await page.getByPlaceholder(L('composer.titlePh')).inputValue(), title, 'title after signing in');
  eq(await page.locator('textarea').first().inputValue(), 'Everything typed here comes back.', 'text after signing in');
  t.step('start over clears it');
  await page.getByRole('button', { name: L('draft.startOver') }).click();
  await page.waitForLoadState('networkidle');
  await sleep(400);
  eq(await page.getByPlaceholder(L('composer.titlePh')).inputValue(), '', 'title after start over');
});

test('timing', 'two people save the same product: the second is told and keeps what they typed', async (t) => {
  const l = await lemoni();
  const owner = await login(seed.owner);
  const p = await ok(`/v1/orgs/${l.orgId}/products`, { method: 'POST', token: owner, body: { name: `E2E Shared jam ${stamp()}`, priceMinor: 400, uom: 'piece' } });
  const a = await open2(t, seed.owner);
  const b = await open2(t, seed.admin);
  await go(a, `/admin/stock/${p.id}/edit`);
  await go(b, `/admin/stock/${p.id}/edit`);
  t.step('b saves first');
  await nameInput(b).fill(`${p.name} B`);
  await b.getByRole('button', { name: L('common:action.save'), exact: true }).click();
  await waitPath(b, new RegExp(`/stock/${p.id}$`));
  t.step('a saves on top');
  await nameInput(a).fill(`${p.name} A`);
  await a.getByRole('button', { name: L('common:action.save'), exact: true }).click();
  await see(a, L('productForm.conflict'));
  eq(await nameInput(a).inputValue(), `${p.name} A`, 'what a typed');
  eq(one('SELECT name FROM products WHERE id = @id', { id: p.id }).name, `${p.name} B`, 'saved name after the refused save');
  t.step('a saves again on purpose');
  await a.getByRole('button', { name: L('common:action.save'), exact: true }).click();
  await waitPath(a, new RegExp(`/stock/${p.id}$`));
  eq(one('SELECT name FROM products WHERE id = @id', { id: p.id }).name, `${p.name} A`, 'saved name after saving again');
});

test('timing', 'the network drops after the server saved a new product: trying again makes it once', async (t) => {
  const page = await open2(t, seed.owner, { serviceWorkers: 'block' });
  await go(page, '/admin/stock/new');
  const name = `E2E Dropped tea ${stamp()}`;
  await nameInput(page).fill(name);
  let dropped = false;
  await page.route('**/v1/orgs/*/products', async (route) => {
    if (route.request().method() !== 'POST' || dropped) return route.continue();
    dropped = true;
    await route.fetch(); // the server does the work, the answer never arrives
    await route.abort('connectionreset');
  });
  await createBtn(page).click();
  await see(page, L('common:error.network'));
  eq(one('SELECT count(*) AS n FROM products WHERE name = @n', { n: name }).n, 1, 'products after the dropped answer');
  t.step('try again');
  await createBtn(page).click();
  await waitPath(page, /\/stock\/[0-9a-f-]{36}$/);
  eq(one('SELECT count(*) AS n FROM products WHERE name = @n', { n: name }).n, 1, 'products after trying again');
});

test('timing', 'a slow network: the button waits, a double tap and Enter make one product', async (t) => {
  const page = await open2(t, seed.owner, { serviceWorkers: 'block' });
  await go(page, '/admin/stock/new');
  const name = `E2E Slow honey ${stamp()}`;
  await nameInput(page).fill(name);
  await page.route('**/v1/orgs/*/products', async (route) => {
    if (route.request().method() === 'POST') await sleep(1500);
    await route.continue();
  });
  const btn = createBtn(page);
  await btn.click();
  await sleep(150);
  expect(await btn.isDisabled(), 'create button while saving', 'disabled', 'enabled');
  await btn.click({ force: true, timeout: 1000 }).catch(() => {});
  await nameInput(page).press('Enter').catch(() => {});
  await waitPath(page, /\/stock\/[0-9a-f-]{36}$/);
  await sleep(1500);
  eq(one('SELECT count(*) AS n FROM products WHERE name = @n', { n: name }).n, 1, 'products made');
});

test('timing', 'a manager loses the right to post while writing one: the next step follows the new rights, no rights wording', async (t) => {
  const email = `e2e-midsession-${stamp()}@example.com`;
  const person = await newPerson(email, { role: 'manager', shop: 'kifisia', name: 'Mid Session' });
  const l = await lemoni();
  const owner = await login(seed.owner);
  const page = await open2(t, null, { tokens: person.tokens });
  await go(page, '/admin/posts/new');
  await page.getByPlaceholder(L('composer.titlePh')).fill('E2E Half written');
  t.step('the owner makes them staff');
  const m = one('SELECT m.id FROM memberships m JOIN users u ON u.id = m.user_id WHERE u.email = @e AND m.org_id = @o', { e: email, o: l.orgId }).id;
  const roles = await ok(`/v1/orgs/${l.orgId}/roles`, { token: owner });
  const staff = roles.find((r) => r.templateKey === 'staff');
  await ok(`/v1/orgs/${l.orgId}/members/${m}/assignments`, { method: 'POST', token: owner, body: { roleId: staff.id, scopeType: 'shop', scopeId: l.kifisia } });
  const manager = one("SELECT ra.id FROM role_assignments ra JOIN roles r ON r.id = ra.role_id WHERE ra.membership_id = @m AND r.template_key = 'manager'", { m }).id;
  await ok(`/v1/orgs/${l.orgId}/members/${m}/assignments/${manager}`, { method: 'DELETE', token: owner });
  t.step('they press save');
  await page.getByRole('button', { name: L('composer.saveDraft'), exact: true }).click().catch(() => {});
  const until = Date.now() + 10_000;
  while (Date.now() < until && /\/posts\/new$/.test(path(page))) await sleep(200);
  expect(!/\/posts\/new$/.test(path(page)), 'the composer after the right went', 'left', path(page));
  eq((await permissionWords(page)).join(','), '', 'rights wording on the page');
  eq(one("SELECT count(*) AS n FROM posts p JOIN post_translations tr ON tr.post_id = p.id WHERE tr.title = 'E2E Half written'").n, 0, 'posts saved without the right');
});

test('timing', 'a page of the old version after a deploy: the next screen loads the new version, no error screen', async (t) => {
  const page = await open2(t, seed.owner, { serviceWorkers: 'block' });
  await go(page, '/admin');
  await sleep(1500);
  // from here on every script file the page still has to fetch is gone from the server, as after a
  // deploy. the full reload that follows gets the new page, where they exist again
  let mode = 'deployed';
  let gone = 0;
  await page.route('**/_next/static/**', async (route) => {
    if (mode === 'deployed') {
      gone++;
      return route.fulfill({ status: 404, body: 'not found' });
    }
    return route.continue();
  });
  page.on('framenavigated', (f) => { if (f === page.mainFrame() && gone > 0) mode = 'new'; });
  const since = Date.now();
  // the first screen that needs a file it does not have yet
  let target = null;
  for (const [key, re] of [['nav.customers', /\/customers$/], ['nav.posts', /\/posts$/], ['nav.team', /\/team$/], ['nav.reports', /\/reports$/], ['nav.settings', /\/settings$/]]) {
    const link = page.getByRole('link', { name: L(key) }).first();
    if (!(await link.count())) continue;
    await link.click();
    await waitPath(page, re, 20_000);
    await page.waitForLoadState('networkidle');
    await sleep(800);
    if (gone > 0) { target = re; break; }
  }
  expect(target !== null, 'a screen that needed a file of the new version', 'one', 'none of them');
  expect(target.test(path(page)), 'page after the reload', String(target), path(page));
  // the app noticed the missing file and loaded the new version itself
  const reloaded = await page.evaluate(() => Boolean(sessionStorage.getItem('custock.reloadedForVersion')));
  expect(reloaded, 'the app reloaded for the new version', 'yes', 'no');
  const broke = await page.getByText(L('issues.boundary.title')).filter({ visible: true }).count();
  eq(broke, 0, 'error screens');
  const reported = one("SELECT count(*) AS n FROM error_events WHERE last_seen >= @s AND (title LIKE '%chunk%' OR title LIKE '%dynamically imported%')", { s: since }).n;
  eq(reported, 0, 'old version errors reported');
});

// open as a seeded person (tokens from a fresh sign in) or with the given tokens
async function open2(t, email, extra = {}) {
  const { open } = await import('../lib.mjs');
  const tokens = extra.tokens ?? (email ? await login(email) : null);
  return open(t, { ...extra, tokens });
}
