// opening hours: the owner sets them in a shop's sheet in Settings, a visitor of the business's
// page sees the shop open now with until when, and closed with when it opens next. today is read in
// the business's time zone, so the test works at any hour on any machine.
import { L, expect, go, lemoni, login, ok, open, see, seed, test } from '../lib.mjs';

const TZ = 'Europe/Athens';
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const todayKey = () => DAYS[['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(new Date()))];
const emptyWeek = () => Object.fromEntries(DAYS.map((d) => [d, []]));

test('settings', 'opening hours: set in the shop sheet, a visitor sees open now, then closed with when it opens', async (t) => {
  const l = await lemoni();
  const owner = await login(seed.owner);
  // start from no hours for Kifisia, whatever earlier tests did
  await ok(`/v1/orgs/${l.orgId}/shops/${l.kifisia}`, { method: 'PATCH', token: owner, body: { hours: null } });

  const page = await open(t, { tokens: owner, storage: { 'custock.shop': 'all' } });
  await go(page, '/admin/settings');
  t.step('open Kifisia in Settings > Shops');
  await page.getByRole('button', { name: L('settings.shops.editLabel', { shop: 'Kifisia' }) }).click();
  const sheet = page.getByRole('dialog');
  await sheet.waitFor({ state: 'visible' });
  t.step('today open all day: switch on, 00:00 to 24:00');
  const today = todayKey();
  const day = sheet.locator(`[data-day="${today}"]`);
  await day.getByRole('switch').check();
  await day.locator('select').first().selectOption('00:00');
  await day.locator('select').nth(1).selectOption('24:00');
  await sheet.getByRole('button', { name: L('common:action.save'), exact: true }).click();
  await see(page, L('settings.saved'), 8000);

  t.step('a visitor of the business page sees it open');
  const visitor = await open(t, {});
  await go(visitor, '/s/lemoni');
  await see(visitor, L('common:hours.shops'), 15000);
  const kif = visitor.locator('[data-shop]').filter({ hasText: 'Kifisia' });
  await kif.locator('[data-open="true"]').waitFor({ state: 'visible', timeout: 10000 });
  const openText = await kif.innerText();
  expect(openText.includes(L('common:hours.openNow', { time: '24:00' })), 'open now line', 'open until 24:00', openText.replace(/\n/g, ' | '));

  t.step('only another day open: closed, with when it opens');
  const other = DAYS[(DAYS.indexOf(today) + 3) % 7];
  await ok(`/v1/orgs/${l.orgId}/shops/${l.kifisia}`, { method: 'PATCH', token: owner, body: { hours: { week: { ...emptyWeek(), [other]: [{ from: '10:00', to: '14:00' }] }, note: null } } });
  await go(visitor, '/s/lemoni');
  await kif.locator('[data-open="false"]').waitFor({ state: 'visible', timeout: 10000 });
  const closedText = await kif.innerText();
  expect(closedText.includes('10:00') && closedText.includes('10:00–14:00'), 'closed line and the week', 'opens at 10:00, hours 10:00–14:00', closedText.replace(/\n/g, ' | '));

  // back to the sample hours: weekdays 9 to 9, saturday 9 to 6
  const weekday = [{ from: '09:00', to: '21:00' }];
  await ok(`/v1/orgs/${l.orgId}/shops/${l.kifisia}`, { method: 'PATCH', token: owner, body: { hours: { week: { mon: weekday, tue: weekday, wed: weekday, thu: weekday, fri: weekday, sat: [{ from: '09:00', to: '18:00' }], sun: [] }, note: null } } });
});
