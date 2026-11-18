// cases from the bug hunt in the super admin, people and settings area. each one was wrong once.

import { L, eq, expect, go, lemoni, login, ok, one, open, overflow, seed, see, sleep, test, api } from '../lib.mjs';
import { superAdmin } from '../helpers.mjs';

test('settings', 'the business name, language for customers and time zone can be changed in settings', async (t) => {
  const l = await lemoni();
  const page = await open(t, { device: 'phone', tokens: await login(seed.owner) });
  await go(page, '/admin/settings');
  await see(page, L('settings.business.title'));
  const zone = page.getByRole('combobox', { name: L('settings.business.timezone') });
  await zone.selectOption('Asia/Nicosia');
  await sleep(800);
  eq(one('SELECT timezone AS z FROM organizations WHERE id = @o', { o: l.orgId })?.z, 'Asia/Nicosia', 'time zone saved');
  await page.getByRole('combobox', { name: L('settings.business.language') }).selectOption('ru');
  await sleep(800);
  eq(one('SELECT default_locale AS d FROM organizations WHERE id = @o', { o: l.orgId })?.d, 'ru', 'language for customers saved');
  // back to how the seed had it, other tests read these
  await zone.selectOption('Europe/Athens');
  await page.getByRole('combobox', { name: L('settings.business.language') }).selectOption('el');
  await sleep(800);
  eq(one('SELECT timezone AS z FROM organizations WHERE id = @o', { o: l.orgId })?.z, 'Europe/Athens', 'time zone back');
});

test('settings', 'the business settings stay hidden for a shop manager', async (t) => {
  const page = await open(t, { device: 'phone', tokens: await login(seed.managerKif) });
  await go(page, '/admin/settings');
  const shown = await page.getByRole('combobox', { name: L('settings.business.timezone') }).count() + await page.getByText(L('settings.business.name'), { exact: true }).count();
  eq(shown, 0, 'business group for a shop manager');
});

test('platform', 'the errors filter fits a phone in russian and greek', async (t) => {
  const sa = await superAdmin();
  for (const locale of ['ru', 'el']) {
    const page = await open(t, { device: 'phone', locale, tokens: sa.tokens });
    await go(page, '/admin/platform/errors');
    await page.locator('.seg').first().waitFor({ timeout: 10_000 });
    const box = await page.locator('.seg').first().evaluate((el) => {
      const r = el.getBoundingClientRect();
      const last = el.lastElementChild.getBoundingClientRect();
      return { right: r.right, lastRight: last.right, width: document.documentElement.clientWidth };
    });
    expect(box.lastRight <= box.width + 1, `last segment inside the screen (${locale})`, `<= ${box.width}`, String(Math.round(box.lastRight)));
    const o = await overflow(page);
    expect(!o.scroll, `no sideways scroll (${locale})`, 'none', o.items.join(', '));
  }
});

test('platform', 'a switched off feature makes no failing calls on the owner home', async (t) => {
  const l = await lemoni();
  const admin = (await superAdmin()).tokens;
  await ok(`/v1/platform/businesses/${l.orgId}/controls`, { method: 'PATCH', token: admin, body: { disabledFeatures: ['posts'] } });
  try {
    const page = await open(t, { device: 'phone', tokens: await login(seed.owner) });
    const refused = [];
    page.on('response', (res) => { if (res.status() === 403 && res.url().includes('/v1/')) refused.push(res.url()); });
    await go(page, '/admin');
    await sleep(800);
    eq(refused.length, 0, `refused calls on home: ${refused.join(', ')}`);
    const posts = await page.getByRole('link', { name: L('nav.posts') }).count().catch(() => 0);
    eq(posts, 0, 'Posts in the navigation');
  } finally {
    await ok(`/v1/platform/businesses/${l.orgId}/controls`, { method: 'PATCH', token: admin, body: { disabledFeatures: [] } });
  }
});

test('team', 'inviting the same person again leaves one open invite', async () => {
  const l = await lemoni();
  const token = await login(seed.owner);
  const roles = await ok(`/v1/orgs/${l.orgId}/roles`, { token });
  const staff = roles.find((r) => r.name === 'Staff' || r.templateKey === 'staff');
  const body = { email: 'again@example.com', roleId: staff.id, scopeType: 'shop', scopeId: l.kifisia };
  const a = await api(`/v1/orgs/${l.orgId}/invites`, { method: 'POST', token, body });
  const b = await api(`/v1/orgs/${l.orgId}/invites`, { method: 'POST', token, body });
  eq(a.status, 201, 'first invite');
  eq(b.status, 201, 'second invite');
  const open1 = (await ok(`/v1/orgs/${l.orgId}/invites`, { token })).filter((i) => i.email === 'again@example.com');
  eq(open1.length, 1, 'open invites for the same person');
  const oldToken = String(a.json.link).split('/').pop();
  eq((await api(`/v1/invites/${oldToken}`)).status, 410, 'the first link');
});
