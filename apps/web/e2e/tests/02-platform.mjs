import { see, L, api, eq, expect, go, linkIn, ok, one, open, path, q, rx, test, text } from '../lib.mjs';
import { PW, expectNoErrors, numberAfter, openSheet, primary, superAdmin, waitPath } from '../helpers.mjs';

const st = {};

test('platform', 'super admin made on the command line lands on All businesses', async (t) => {
  const sa = await superAdmin();
  const page = await open(t, { tokens: sa.tokens });
  await go(page, '/admin');
  await waitPath(page, /^\/admin\/platform$/);
  await page.getByRole('heading', { name: L('platform.title') }).first().waitFor({ timeout: 10_000 });
  const body = await text(page);
  expect(!/Bootstrap/.test(body), 'the bootstrap business is gone', 'not listed', 'listed');
  const me = await ok('/v1/me/context', { token: sa.tokens });
  eq(me.platformRole, 'superadmin', 'platform role');
  expectNoErrors(page, 'all businesses');
});

test('platform', 'overview numbers match the api', async (t) => {
  const sa = await superAdmin();
  const o = await ok('/v1/platform/overview', { token: sa.tokens });
  const page = await open(t, { tokens: sa.tokens });
  await go(page, '/admin/platform');
  eq(await numberAfter(page, L('platform.stat.businesses')), o.businesses, 'businesses on the overview');
  eq(await numberAfter(page, L('platform.stat.shops')), o.shops, 'shops on the overview');
  eq(await numberAfter(page, L('platform.stat.products')), o.products, 'products on the overview');
});

test('platform', 'create a business from the New business sheet', async (t) => {
  const sa = await superAdmin();
  const page = await open(t, { tokens: sa.tokens });
  await go(page, '/admin/platform');
  t.step('New business');
  const sheet = await openSheet(page, page.getByRole('button', { name: L('platform.newBusiness') }).first());
  // every field is found by its label: screen readers name them the same way
  await sheet.getByLabel(L('platform.new.name'), { exact: true }).fill('QA Shop');
  expect(await sheet.getByLabel(L('platform.new.slug'), { exact: true }).count() === 1, 'web address field by its label', '1', '0');
  await sheet.getByLabel(L('platform.new.shop'), { exact: true }).fill('QA Main');
  await sheet.getByLabel(L('platform.new.ownerEmail'), { exact: true }).fill('qa-owner@example.com');
  await page.waitForTimeout(600);
  t.step('Create');
  await primary(page).click();
  await see(page, L('platform.new.doneTitle'), 10_000);
  const link = await sheet.locator('text=/\\/invite\\//').first().innerText().catch(() => '');
  const org = one("SELECT id, slug FROM organizations WHERE name = 'QA Shop'");
  expect(!!org, 'business in the database', 'QA Shop', 'missing');
  st.orgId = org.id;
  st.slug = org.slug;
  st.link = link.trim() || null;
  if (!st.link) {
    const row = one("SELECT body, html FROM dev_outbox WHERE to_address = 'qa-owner@example.com' ORDER BY created_at DESC");
    st.link = row ? linkIn(row, '/invite/') : null;
  }
  expect(!!st.link, 'owner invite link shown or queued', 'a link', 'none');
});

test('platform', 'owner invite accepted by a new person', async (t) => {
  expect(!!st.link, 'invite link from the previous test', 'a link', 'none');
  const page = await open(t);
  await page.goto(st.link, { waitUntil: 'networkidle' });
  await page.getByPlaceholder(L('invite.namePlaceholder')).fill('Quinn Owner');
  await page.locator('input[type=password]').first().fill(PW);
  await page.getByRole('button', { name: L('invite.join', { org: 'QA Shop' }) }).click();
  await waitPath(page, /^\/admin$/);
  await see(page, 'QA Shop', 10_000);
  const tk = await ok('/v1/auth/login', { method: 'POST', body: { email: 'qa-owner@example.com', password: PW } });
  st.owner = tk;
  const me = await ok('/v1/me/context', { token: tk });
  const org = me.orgs.find((o) => o.orgId === st.orgId);
  expect(org && org.roleNames.includes('owner'), 'role in the new business', 'owner', JSON.stringify(org?.roleNames));
});

test('platform', 'super admin invite makes a second super admin', async (t) => {
  const sa = await superAdmin();
  const page = await open(t, { tokens: sa.tokens });
  await go(page, '/admin/platform');
  const sheet = await openSheet(page, page.getByRole('button', { name: L('platform.admins.invite') }));
  await sheet.locator('input[type=email]').fill('second-root@example.com');
  await primary(page).click();
  // the confirm step asks once more
  const confirm = page.getByRole('button', { name: L('platform.admins.inviteConfirm') });
  if (await confirm.isVisible().catch(() => false)) await confirm.click();
  await page.waitForTimeout(1500);
  const row = one("SELECT body, html FROM dev_outbox WHERE to_address = 'second-root@example.com' ORDER BY created_at DESC");
  const link = row ? linkIn(row, '/platform-invite/') : null;
  expect(!!link, 'super admin invite queued', 'a /platform-invite/ link', 'none');
  const page2 = await open(t);
  await page2.goto(link, { waitUntil: 'networkidle' });
  await page2.getByPlaceholder(L('invite.namePlaceholder')).fill('Second Root');
  await page2.locator('input[type=password]').first().fill(PW);
  await page2.locator('button[type=submit]').click();
  await waitPath(page2, /^\/admin\/platform/);
  const tk = await ok('/v1/auth/login', { method: 'POST', body: { email: 'second-root@example.com', password: PW } });
  const me = await ok('/v1/me/context', { token: tk });
  eq(me.platformRole, 'superadmin', 'role of the invited person');
});

test('platform', 'switched off features disappear for the owner', async (t) => {
  const sa = await superAdmin();
  expect(!!st.owner, 'owner from the earlier test', 'tokens', 'none');
  await ok(`/v1/platform/businesses/${st.orgId}/controls`, { method: 'PATCH', token: sa.tokens, body: { disabledFeatures: ['posts', 'reports'] } });
  try {
    const page = await open(t, { tokens: st.owner });
    await go(page, '/admin');
    const nav = await page.locator('nav').first().innerText();
    expect(!nav.includes(L('nav.posts')), 'Posts in the navigation', 'hidden', 'shown');
    expect(!nav.includes(L('nav.reports')), 'Reports in the navigation', 'hidden', 'shown');
    t.step('open /admin/posts directly');
    await go(page, '/admin/posts');
    await waitPath(page, /^\/admin$/);
    const r = await api(`/v1/orgs/${st.orgId}/posts`, { token: st.owner });
    expect(r.status === 403, 'posts api for a switched off feature', '403', r.status);
  } finally {
    await ok(`/v1/platform/businesses/${st.orgId}/controls`, { method: 'PATCH', token: sa.tokens, body: { disabledFeatures: [] } });
  }
});

test('platform', 'a paused business shows its staff the paused screen', async (t) => {
  const sa = await superAdmin();
  await ok(`/v1/platform/businesses/${st.orgId}/controls`, { method: 'PATCH', token: sa.tokens, body: { status: 'suspended' } });
  try {
    const page = await open(t, { tokens: st.owner });
    t.step('owner opens Home while the business is paused');
    await go(page, '/admin');
    await see(page, L('platform.paused.title'), 10_000);
  } finally {
    await ok(`/v1/platform/businesses/${st.orgId}/controls`, { method: 'PATCH', token: sa.tokens, body: { status: 'active' } });
  }
});

test('platform', 'a paused business has no public pages', async (t) => {
  const sa = await superAdmin();
  await ok(`/v1/platform/businesses/${st.orgId}/controls`, { method: 'PATCH', token: sa.tokens, body: { status: 'suspended' } });
  try {
    const page = await open(t);
    t.step('a visitor opens the shop page');
    await go(page, `/s/${st.slug}`);
    await see(page, L('platform.unavailable.title'), 10_000);
    const r = await api(`/v1/public/orgs/${st.slug}`);
    expect(r.status >= 400, 'public business api while paused', 'refused', r.status);
  } finally {
    await ok(`/v1/platform/businesses/${st.orgId}/controls`, { method: 'PATCH', token: sa.tokens, body: { status: 'active' } });
  }
});

test('platform', 'platform pause shows a banner and turns new signups away', async (t) => {
  const sa = await superAdmin();
  await ok('/v1/platform/settings', { method: 'PATCH', token: sa.tokens, body: { pause_signups: true } });
  try {
    const page = await open(t, { tokens: sa.tokens });
    await go(page, '/admin/platform');
    await page.getByText(L('platform.banner.paused', { list: L('platform.switch.pause_signups.short') })).first().waitFor({ timeout: 10_000 });
    const r = await api('/v1/public/join/kif7q2', { method: 'POST', body: { name: 'Paused Person', email: 'paused@example.com', locale: 'en', emailNews: true, push: false, over15: true } });
    expect(r.status >= 400, 'join while signups are paused', 'refused', r.status);
  } finally {
    await ok('/v1/platform/settings', { method: 'PATCH', token: sa.tokens, body: { pause_signups: false } });
  }
});

test('platform', 'storage meter counts an upload', async (t) => {
  const sa = await superAdmin();
  const before = (await ok('/v1/platform/overview', { token: sa.tokens })).storage;
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');
  const slot = await ok(`/v1/orgs/${st.orgId}/uploads/presign`, { method: 'POST', token: st.owner, body: { purpose: 'logo', mime: 'image/png', bytes: png.length } });
  // the signed slot points at the web's /custock/api, which forwards to the api like the proxy does
  const put = await fetch(slot.uploadUrl, { method: 'PUT', headers: slot.headers, body: png });
  expect(put.ok, 'upload into the signed slot', '2xx', put.status);
  const after = (await ok('/v1/platform/overview', { token: sa.tokens })).storage;
  expect(after.bytesUsed >= before.bytesUsed + png.length, 'bytes used after the upload', `>= ${before.bytesUsed + png.length}`, after.bytesUsed);
  expect(after.writesThisMonth >= before.writesThisMonth + 1, 'uploads this month', `>= ${before.writesThisMonth + 1}`, after.writesThisMonth);
  const page = await open(t, { tokens: sa.tokens });
  await go(page, '/admin/platform');
  await see(page, L('platform.storage.stored'), 8000);
  const box = await page.getByText(L('platform.storage.stored')).first().locator('..').innerText();
  expect(!/^\s*0 B/.test(box.split('\n').slice(-1)[0] ?? ''), 'stored amount on screen', 'more than 0 B', box.replace(/\n/g, ' '));
});

test('platform', 'errors screen shows a forced client error', async (t) => {
  const sa = await superAdmin();
  const msg = `e2e forced error ${Math.random().toString(36).replace(/[^a-z]/g, '').slice(0, 8)}`;
  const r = await api('/v1/client-errors', { method: 'POST', body: { source: 'error', message: msg, path: '/admin/stock', browser: 'chrome', os: 'windows', build: 'e2e' } });
  expect(r.status < 300, 'client error accepted', '2xx', r.status);
  const page = await open(t, { tokens: sa.tokens });
  await go(page, '/admin/platform/errors');
  await see(page, msg, 10_000);
  const staff = await api('/v1/platform/errors', { token: st.owner });
  expect(staff.status === 403, 'errors api for an owner', '403', staff.status);
});

test('platform', 'API docs and This server load', async (t) => {
  const sa = await superAdmin();
  const page = await open(t, { tokens: sa.tokens });
  await go(page, '/admin/platform/api');
  await see(page, /\d+ endpoints/, 10_000);
  await go(page, '/admin/platform/server');
  await see(page, L('platform.dev.server.title'), 10_000);
  await see(page, 'e2e', 10_000);
  const owner = await api('/v1/platform/server', { token: st.owner });
  expect(owner.status === 403, 'server info for an owner', '403', owner.status);
  expectNoErrors(page, 'developer screens');
});

test('platform', 'full delete removes the business, its people and its photos', async (t) => {
  const sa = await superAdmin();
  const page = await open(t, { tokens: sa.tokens });
  await go(page, `/admin/platform/${st.orgId}`);
  const sheet = await openSheet(page, page.getByRole('button', { name: L('platform.delete.button') }));
  await sheet.locator('input').first().fill(st.slug);
  await primary(page).click();
  await waitPath(page, /^\/admin\/platform$/);
  const left = q('SELECT name FROM sqlite_master WHERE type = \'table\'').map((r) => r.name)
    // the platform audit keeps one row about the delete on purpose
    .filter((tb) => tb !== 'platform_audit' && tb !== 'error_events')
    .filter((tb) => { try { return one(`SELECT 1 AS x FROM "${tb}" WHERE org_id = @o LIMIT 1`, { o: st.orgId }); } catch { return false; } });
  expect(left.length === 0, 'rows of the deleted business', 'none', left.join(', '));
  const owner = one("SELECT deleted_at, email FROM users WHERE email = 'qa-owner@example.com' OR (email IS NULL AND display_name IS NULL AND deleted_at IS NOT NULL) ORDER BY deleted_at DESC");
  expect(!owner || owner.deleted_at || owner.email === null, 'owner account after delete', 'closed', JSON.stringify(owner));
  const loginAgain = await api('/v1/auth/login', { method: 'POST', body: { email: 'qa-owner@example.com', password: PW } });
  expect(loginAgain.status === 401, 'owner sign in after delete', '401', loginAgain.status);
  const files = one('SELECT COUNT(*) AS n FROM files WHERE org_id = @o', { o: st.orgId }).n;
  eq(files, 0, 'photo rows left');
});

test('platform', 'a super admin opens a business and works in it', async (t) => {
  const sa = await superAdmin();
  const me = await ok('/v1/me/context', { token: sa.tokens });
  const lem = me.orgs.find((o) => o.slug === 'lemoni');
  expect(!!lem, 'Lemoni in the super admin context', 'listed', 'missing');
  const page = await open(t, { tokens: sa.tokens });
  await go(page, `/admin/platform/${lem.orgId}`);
  await page.getByRole('button', { name: L('platform.detail.open') }).or(page.getByRole('link', { name: L('platform.detail.open') })).first().click();
  await waitPath(page, /^\/admin$/);
  await see(page, L('platform.access'), 10_000);
  await go(page, '/admin/stock');
  await see(page, /Thyme honey|honey/i, 10_000);
  expect(rx('nav.stock').test(await page.locator('nav').first().innerText()), 'stock in the navigation', 'shown', 'hidden');
});
