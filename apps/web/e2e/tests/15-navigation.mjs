// addresses and the way back: the business is in the address of every staff page, old short
// addresses still open, reload and browser back keep the page, two businesses in two tabs stay
// apart, deep pages have a visible back link to their parent, and a signed in person never sees
// the front door or the sign in page flash.
import { L, eq, expect, go, lemoni, login, ok, one, open, rawPath, see, seed, test } from '../lib.mjs';
import { superAdmin, waitPath } from '../helpers.mjs';

const anyProduct = (orgId) => one(
  'SELECT p.id, p.name FROM products p WHERE p.org_id = @o AND p.archived_at IS NULL ORDER BY p.name LIMIT 1', { o: orgId },
);

async function waitRaw(page, re, ms = 15_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (re.test(rawPath(page))) return;
    await page.waitForTimeout(200);
  }
  expect(false, 'address after the step', String(re), rawPath(page));
}

// records whether a guest page (front door, sign in) was ever visible in this tab
const watchGuest = () => {
  const check = () => {
    const g = document.querySelector('[data-guest]');
    if (g && getComputedStyle(g).visibility !== 'hidden') sessionStorage.setItem('e2e.guestSeen', location.pathname);
    requestAnimationFrame(check);
  };
  requestAnimationFrame(check);
};

test('navigation', '/admin opens the business in the address', async (t) => {
  const page = await open(t, { tokens: await login(seed.owner) });
  await go(page, '/admin');
  await waitRaw(page, /^\/admin\/lemoni$/);
});

test('navigation', 'old short addresses go on to the same page in the business', async (t) => {
  const l = await lemoni();
  const p = anyProduct(l.orgId);
  const page = await open(t, { tokens: await login(seed.owner) });
  await go(page, `/admin/stock/${p.id}`);
  await waitRaw(page, new RegExp(`^/admin/lemoni/stock/${p.id}$`));
  await see(page, p.name);
});

test('navigation', 'reload on a deep page keeps the page and the business', async (t) => {
  const l = await lemoni();
  const p = anyProduct(l.orgId);
  const page = await open(t, { tokens: await login(seed.owner) });
  await go(page, `/admin/lemoni/stock/${p.id}`);
  await see(page, p.name);
  await page.reload({ waitUntil: 'networkidle' });
  await waitRaw(page, new RegExp(`^/admin/lemoni/stock/${p.id}$`));
  await see(page, p.name);
});

test('navigation', 'browser back from a product returns to the list it was opened from', async (t) => {
  const l = await lemoni();
  const p = anyProduct(l.orgId);
  const page = await open(t, { tokens: await login(seed.owner) });
  await go(page, '/admin/lemoni/stock');
  await page.locator(`a[href$="/stock/${p.id}"]`).first().click();
  await waitRaw(page, new RegExp(`^/admin/lemoni/stock/${p.id}$`));
  await page.goBack({ waitUntil: 'networkidle' });
  await waitRaw(page, /^\/admin\/lemoni\/stock$/);
});

test('navigation', 'two businesses in two tabs stay apart, also after a reload', async (t) => {
  const sa = await superAdmin();
  const second = one("SELECT slug FROM organizations WHERE slug <> 'lemoni' AND slug <> 'bootstrap' ORDER BY created_at LIMIT 1");
  let slug = second?.slug;
  if (!slug) {
    const made = await ok('/v1/platform/businesses', { method: 'POST', token: sa.tokens, body: { name: 'Second Tab Shop', slug: 'second-tab', shopName: 'Main', ownerEmail: 'second-tab-owner@example.com', locale: 'en' } });
    slug = made.slug ?? 'second-tab';
  }
  const a = await open(t, { tokens: sa.tokens });
  await go(a, '/admin/lemoni/stock');
  await waitRaw(a, /^\/admin\/lemoni\/stock$/);
  const b = await a.context().newPage();
  await go(b, `/admin/${slug}/stock`);
  await waitRaw(b, new RegExp(`^/admin/${slug}/stock$`));
  await a.reload({ waitUntil: 'networkidle' });
  await waitRaw(a, /^\/admin\/lemoni\/stock$/);
  await see(a, 'Lemoni');
});

test('navigation', 'deep pages on a phone have a back link to their parent, 44px tall', async (t) => {
  const l = await lemoni();
  const p = anyProduct(l.orgId);
  const page = await open(t, { device: 'phone', ios: true, tokens: await login(seed.owner) });
  for (const [where, parent] of [[`/admin/lemoni/stock/${p.id}`, L('stock.title')], ['/admin/lemoni/posts/new', L('posts.title')], ['/admin/lemoni/team/roles', L('team.title')]]) {
    await go(page, where);
    const back = page.getByRole('link', { name: new RegExp(parent, 'i') }).filter({ visible: true }).first();
    await back.waitFor({ state: 'visible', timeout: 10_000 });
    const box = await back.boundingBox();
    expect((box?.height ?? 0) >= 43.5, `back link on ${where} is tall enough`, '44', String(box?.height));
  }
});

test('navigation', 'All businesses is the root: the Custock name, no back arrow', async (t) => {
  const sa = await superAdmin();
  const page = await open(t, { tokens: sa.tokens });
  await go(page, '/admin/lemoni');
  await go(page, '/admin/platform');
  await see(page, L('platform.title'));
  const backs = await page.locator('header a[aria-label^="Back"]').count();
  eq(backs, 0, 'back arrows in the platform header');
});

test('navigation', 'signed in: the front door goes straight into the app, without showing it', async (t) => {
  const page = await open(t, { tokens: await login(seed.owner) });
  await page.addInitScript(watchGuest);
  await go(page, '/');
  await waitRaw(page, /^\/admin\/lemoni$/);
  eq(await page.evaluate(() => sessionStorage.getItem('e2e.guestSeen')), null, 'a guest page seen on the way');
  // reopening the tab: a new tab of the same browser
  const again = await page.context().newPage();
  await again.addInitScript(watchGuest);
  await go(again, '/');
  await waitRaw(again, /^\/admin\/lemoni$/);
  eq(await again.evaluate(() => sessionStorage.getItem('e2e.guestSeen')), null, 'a guest page seen after reopening');
});

test('navigation', 'signed in: the sign in page goes into the app and keeps ?next=', async (t) => {
  const l = await lemoni();
  const p = anyProduct(l.orgId);
  const page = await open(t, { tokens: await login(seed.owner) });
  await page.addInitScript(watchGuest);
  await go(page, `/admin/login?next=${encodeURIComponent(`/admin/lemoni/stock/${p.id}`)}`);
  await waitRaw(page, new RegExp(`^/admin/lemoni/stock/${p.id}$`));
  eq(await page.evaluate(() => sessionStorage.getItem('e2e.guestSeen')), null, 'the sign in page seen on the way');
  await page.reload({ waitUntil: 'networkidle' });
  await waitRaw(page, new RegExp(`^/admin/lemoni/stock/${p.id}$`));
});

test('navigation', 'signed out: the front door and the sign in page show as usual', async (t) => {
  const page = await open(t);
  await go(page, '/');
  await see(page, L('landing.signIn'));
  await go(page, '/admin/login');
  await waitPath(page, /^\/admin\/login$/);
  await page.locator('input[type=email]').waitFor({ state: 'visible' });
});

test('navigation', 'a product opened from the news goes back to the news', async (t) => {
  const l = await lemoni();
  const p = anyProduct(l.orgId);
  const page = await open(t, { tokens: await login(seed.customer) });
  await go(page, `/s/lemoni/p/${p.id}?from=news`);
  const href = await page.locator('a[href$="/s/lemoni/news"]').first().getAttribute('href').catch(() => null);
  expect(!!href, 'a back link to the news', '/s/lemoni/news', String(href));
});

test('navigation', 'a business with one shop shows no Transfers, a typed address goes to Stock', async (t) => {
  const sa = await superAdmin();
  if (!one("SELECT id FROM organizations WHERE slug = 'one-shop-e2e'")) {
    await ok('/v1/platform/businesses', { method: 'POST', token: sa.tokens, body: { name: 'One Shop E2E', slug: 'one-shop-e2e', shopName: 'Only', ownerEmail: 'one-shop-owner@example.com', locale: 'en' } });
  }
  for (const device of ['desktop', 'phone']) {
    const page = await open(t, { device, tokens: sa.tokens });
    await go(page, '/admin/one-shop-e2e/stock');
    await waitRaw(page, /^\/admin\/one-shop-e2e\/stock$/);
    await page.waitForTimeout(500);
    const links = await page.locator('a[href*="/stock/transfers"]').count();
    eq(links, 0, `Transfers links on ${device}`);
    await go(page, '/admin/one-shop-e2e/stock/transfers');
    await waitRaw(page, /^\/admin\/one-shop-e2e\/stock$/);
  }
});
