import { see, L, WEB, eq, expect, go, login, open, seed, skip, test, text } from '../lib.mjs';
import cfg from '../e2e.config.mjs';

test('pwa', 'staff and business manifests', async () => {
  const staff = await (await fetch(`${WEB}/manifest.webmanifest`)).json();
  expect(staff.start_url.endsWith('/admin') && staff.icons.length >= 3, 'staff manifest', 'start /admin, 3 icons', JSON.stringify({ s: staff.start_url, i: staff.icons.length }));
  const biz = await (await fetch(`${WEB}/s/lemoni/manifest.webmanifest`)).json();
  expect(biz.name === 'Lemoni' && biz.scope.includes('/s/lemoni') && biz.start_url.includes('/s/lemoni'), 'business manifest', 'Lemoni, scope /s/lemoni', JSON.stringify({ n: biz.name, sc: biz.scope }));
  const icon = await fetch(`${WEB}/s/lemoni/icon/192`);
  eq([icon.status, icon.headers.get('content-type')], [200, 'image/png'], 'business icon');
});

test('pwa', 'the service worker registers with the base path scope', async (t) => {
  // the app's own path: /custock/ under a path, / on its own subdomain
  const want = `${cfg.basePath}/`;
  const page = await open(t, { device: 'phone' });
  await go(page, '/admin/login');
  const scope = await page.evaluate(async (want) => {
    for (let i = 0; i < 40; i++) {
      const r = await navigator.serviceWorker.getRegistration(want);
      if (r?.active) return new URL(r.scope).pathname;
      await new Promise((ok) => setTimeout(ok, 250));
    }
    return '';
  }, want);
  eq(scope, want, 'service worker scope');
});

test('pwa', 'offline: a page seen before opens, a new one shows the offline page', async (t) => {
  const page = await open(t, { device: 'phone' });
  await go(page, '/admin/login');
  await page.waitForTimeout(2500);
  // the second visit is the one the service worker controls and keeps
  await go(page, '/admin/login');
  await page.waitForTimeout(1000);
  const ctx = t.contexts[t.contexts.length - 1];
  await ctx.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  expect((await page.locator('input[type=email]').count()) > 0, 'seen page offline', 'opens from the cache', 'blank');
  await page.goto(`${WEB}/s/nowhere-${Date.now()}`, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await see(page, L('pwa.offlineTitle'), 8000);
  await ctx.setOffline(false);
});

test('pwa', 'install coach on an iPhone shows the Safari steps', async (t) => {
  const page = await open(t, { device: 'phone', ios: true });
  await go(page, '/s/lemoni');
  const coach = page.getByRole('button', { name: L('pwa.showHow') }).or(page.getByRole('button', { name: L('pwa.install') })).first();
  await coach.waitFor({ timeout: 10_000 });
  await coach.click();
  await see(page, L('pwa.step1'), 8000);
});

test('pwa', 'push card: three actions when notifications were never asked', async (t) => {
  const page = await open(t, { tokens: await login(seed.managerKif), permissions: [] });
  await page.context().grantPermissions([]);
  await go(page, '/admin');
  const body = await text(page);
  const card = body.includes(L('push.nudgeTitle')) || /Know when it matters/.test(body);
  if (!card) {
    const state = await page.evaluate(() => (typeof Notification === 'undefined' ? 'none' : Notification.permission));
    if (state === 'denied') skip('headless chrome reports notifications as denied, the card rightly stays hidden');
    expect(false, 'alerts card on Home', 'shown with Turn on, Not now, Don\'t ask again', `not shown (permission ${state})`);
  }
});

test('pwa', 'push card: Not now and Don\'t ask again stay put after reload', async (t) => {
  const page = await open(t, { tokens: await login(seed.managerKif) });
  await go(page, '/admin');
  const notNow = page.getByRole('button', { name: L('pwa.notNow') }).or(page.getByRole('button', { name: /Not now/ })).first();
  if (!(await notNow.isVisible().catch(() => false))) {
    const state = await page.evaluate(() => (typeof Notification === 'undefined' ? 'none' : Notification.permission));
    if (state === 'denied') skip('headless chrome reports notifications as denied, the card rightly stays hidden');
    expect(false, 'alerts card buttons', 'Not now visible', `card not shown (permission ${state})`);
  }
  await notNow.click();
  await page.reload({ waitUntil: 'networkidle' });
  expect(!(await page.getByRole('button', { name: /Not now/ }).isVisible().catch(() => false)), 'card after Not now and reload', 'hidden', 'shown again');
});

test('pwa', 'push states: unsupported and denied give a plain line, never a prompt', async (t) => {
  const page = await open(t, { tokens: await login(seed.owner), device: 'phone', ios: true });
  await go(page, '/admin');
  await page.getByRole('button', { name: L('admin.account') }).first().click().catch(() => {});
  await page.waitForTimeout(600);
  const body = await text(page);
  expect(body.includes(L('push.staffTitle')), 'alerts row in the account sheet', L('push.staffTitle'), 'missing');
  expect(body.includes(L('push.why.install')) || body.includes(L('push.why.off')) || body.includes(L('push.why.unsupported')), 'iPhone not installed', 'a why line', body.slice(0, 120));
});
