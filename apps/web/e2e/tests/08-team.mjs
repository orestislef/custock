import { see, L, api, eq, expect, go, lemoni, login, ok, one, open, seed, sleep, test, text } from '../lib.mjs';
import { PW, newPerson, openSheet, primary } from '../helpers.mjs';

const st = {};

test('team', 'invite staff: with mail off the link is shown to share', async (t) => {
  const page = await open(t, { tokens: await login(seed.owner) });
  await go(page, '/admin/team');
  const sheet = await openSheet(page, page.getByRole('button', { name: L('team.invite') }).first());
  await sheet.locator('input[type=email]').fill('invited-staff@example.com');
  const where = sheet.locator(`select[aria-label="${L('team.where')}"]`);
  const opts = await where.locator('option').allInnerTexts();
  const kif = opts.findIndex((o) => o.includes('Kifisia'));
  if (kif >= 0) await where.selectOption({ index: kif });
  await sheet.getByRole('button', { name: /Staff/ }).first().click();
  await sheet.getByRole('button', { name: L('team.send') }).click();
  await see(page, L('team.linkReady'), 10_000);
  const body = await sheet.innerText();
  const link = body.match(/https?:\/\/\S+\/invite\/\S+/)?.[0];
  expect(!!link, 'invite link in the sheet', 'a link', body.replace(/\n/g, ' ').slice(0, 160));
  st.link = link;
  const inv = one("SELECT id FROM invites WHERE email = 'invited-staff@example.com'");
  expect(!!inv, 'invite saved', 'a row', 'none');
});

test('team', 'the invited person registers from the link and lands in the business', async (t) => {
  expect(!!st.link, 'link from the previous test', 'a link', 'none');
  const page = await open(t);
  await page.goto(st.link, { waitUntil: 'networkidle' });
  await page.getByPlaceholder(L('invite.namePlaceholder')).fill('Ivy Invited');
  await page.locator('input[type=password]').first().fill(PW);
  await page.locator('button[type=submit]').click();
  await page.waitForURL(/\/admin$/, { timeout: 15_000 });
  st.tokens = await ok('/v1/auth/login', { method: 'POST', body: { email: 'invited-staff@example.com', password: PW } });
  const me = await ok('/v1/me/context', { token: st.tokens });
  const org = me.orgs.find((o) => o.slug === 'lemoni');
  expect(org?.roleNames.includes('staff') && org.shops.some((s) => s.name === 'Kifisia'), 'role and shop', 'staff in Kifisia', JSON.stringify({ r: org?.roleNames, s: org?.shops?.map((s) => s.name) }));
});

test('team', 'roles editor: a new role with chosen permissions', async (t) => {
  const page = await open(t, { tokens: await login(seed.owner) });
  await go(page, '/admin/team/roles/new');
  await page.locator('main input.field').first().fill('E2E Cashier');
  for (const p of ['stock.sell', 'products.view', 'stock.view']) {
    const sw = page.getByRole('switch', { name: L(`common:perm.${p}`) });
    if (await sw.count()) { if (!(await sw.first().isChecked())) await sw.first().click(); }
  }
  await page.getByRole('button', { name: L('roles.save') }).click();
  await see(page, L('roles.saved'), 8000);
  const l = await lemoni();
  const roles = await ok(`/v1/orgs/${l.orgId}/roles`, { token: await login(seed.owner) });
  const r = roles.find((x) => x.name === 'E2E Cashier');
  expect(r && ['stock.sell', 'products.view', 'stock.view'].every((p) => r.permissions.includes(p)), 'saved role', 'stock.sell, products.view, stock.view', JSON.stringify(r?.permissions));
});

test('team', 'remove a member from the business', async (t) => {
  const p = await newPerson('remove-me@example.com', { name: 'Rory Removed' });
  const page = await open(t, { tokens: await login(seed.owner) });
  await go(page, '/admin/team');
  const sheet = await openSheet(page, page.getByText('Rory Removed').filter({ visible: true }).first());
  await sheet.getByRole('button', { name: L('team.remove') }).click();
  await sheet.getByRole('button', { name: L('team.removeConfirm', { name: 'Rory Removed' }) }).click();
  await sleep(1200);
  const m = one("SELECT m.status FROM memberships m JOIN users u ON u.id = m.user_id WHERE u.email = 'remove-me@example.com'");
  eq(m?.status, 'removed', 'membership after removal');
  const l = await lemoni();
  const r = await api(`/v1/orgs/${l.orgId}/products`, { token: p.tokens });
  expect([401, 403, 404].includes(r.status), 'removed person using the business api', '401, 403 or 404', r.status);
  await go(page, '/admin/team');
  expect(!(await text(page)).includes('Rory Removed') || /Former member/.test(await text(page)), 'team list after removal', 'gone or former member', 'still active');
});
