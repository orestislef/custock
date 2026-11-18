// a tap on a notification or an email link lands on the exact page: through sign in and back, in
// the right business, and calmly when the item is gone or the person no longer works there
import { L, eq, expect, go, lemoni, login, ok, one, open, path, see, seed, test } from '../lib.mjs';
import { signIn, superAdmin, waitPath, PW } from '../helpers.mjs';
import cfg from '../e2e.config.mjs';

const search = (page) => new URL(page.url()).search;

async function aPost(token, title) {
  const l = await lemoni();
  return ok(`/v1/orgs/${l.orgId}/posts`, { method: 'POST', token, body: {
    kind: 'news', defaultLocale: 'en', translations: { en: { title, body: 'E2E deep link' } }, channels: ['feed'],
    audience: { scopes: [{ scopeType: 'shop', scopeId: l.kifisia }] },
  } });
}

test('deep links', 'signed out: sign in, then straight on to the page from the notification', async (t) => {
  const l = await lemoni();
  const p = await aPost(await login(seed.owner), 'E2E link after sign in');
  const page = await open(t);
  await go(page, `/admin/posts/${p.id}?org=${l.orgId}`);
  await waitPath(page, /^\/admin\/login$/);
  expect(search(page).includes('next='), 'the sign in page keeps where to go next', 'next=...', search(page));
  await page.locator('input[type=email]').fill(seed.owner);
  await page.locator('input[autocomplete="current-password"]').fill(cfg.password);
  await page.getByRole('button', { name: L('common:action.signIn'), exact: true }).click();
  await waitPath(page, new RegExp(`^/admin/posts/${p.id}$`));
  await see(page, 'E2E link after sign in');
  // the business and shop hints are taken off the address once used
  eq(search(page), '', 'the address after landing');
});

test('deep links', 'a return path that leaves the app is ignored', async (t) => {
  const page = await open(t);
  await go(page, `/admin/login?next=${encodeURIComponent('https://evil.example/admin')}`);
  await signIn(page, seed.owner, cfg.password);
  await waitPath(page, /^\/admin$/);
  await go(page, '/admin/login');
  await go(page, `/admin/login?next=${encodeURIComponent('//evil.example/x')}`);
  expect(!new URL(page.url()).host.includes('evil'), 'still on our own site', 'our host', new URL(page.url()).host);
});

test('deep links', 'a link names its business: the super admin lands inside it', async (t) => {
  const l = await lemoni();
  const sa = await superAdmin();
  const { productId } = one("SELECT pv.product_id AS productId FROM product_variants pv JOIN products p ON p.id = pv.product_id WHERE pv.org_id = @o AND p.archived_at IS NULL LIMIT 1", { o: l.orgId });
  const page = await open(t, { tokens: sa.tokens });
  await go(page, `/admin/stock/${productId}?org=${l.orgId}&shop=${l.kifisia}`);
  await waitPath(page, new RegExp(`^/admin/stock/${productId}$`));
  const stored = await page.evaluate(() => [localStorage.getItem('custock.org'), localStorage.getItem('custock.shop')]);
  eq(stored[0], l.orgId, 'business opened from the link');
  eq(stored[1], l.kifisia, 'shop picked from the link');
});

test('deep links', 'a link to a business the person does not work for goes home quietly', async (t) => {
  const page = await open(t, { tokens: await login(seed.managerKif) });
  await go(page, '/admin/posts?org=00000000-0000-7000-8000-000000000000');
  await waitPath(page, /^\/admin$/);
});

test('deep links', 'a deleted post shows a calm page with the way back', async (t) => {
  const l = await lemoni();
  const owner = await login(seed.owner);
  const p = await aPost(owner, 'E2E soon gone');
  await ok(`/v1/orgs/${l.orgId}/posts/${p.id}`, { method: 'DELETE', token: owner });
  const page = await open(t, { tokens: owner });
  await go(page, `/admin/posts/${p.id}?org=${l.orgId}`);
  await see(page, L('gone.post.title'));
  await see(page, L('gone.post.cta'));
  expect(path(page) === `/admin/posts/${p.id}`, 'stays on the link, no error screen', `/admin/posts/${p.id}`, path(page));
});

test('deep links', 'a product taken off the shelf is gone for customers too, calmly', async (t) => {
  const page = await open(t, { tokens: await login(seed.customer) });
  await go(page, '/s/lemoni/p/00000000-0000-7000-8000-000000000000');
  const body = await page.evaluate(() => document.body.innerText);
  expect(!/404|error/i.test(body.slice(0, 200)), 'no 404 or error screen', 'a calm page', body.slice(0, 120));
});

void PW;
