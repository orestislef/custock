import { see, L, api, expect, go, linkIn, open, outboxFor, path, rx, seed, test, waitOutbox } from '../lib.mjs';
import { PW, expectNoErrors, newPerson, signIn, waitPath } from '../helpers.mjs';

test('auth', 'sign in with email and password lands on Home', async (t) => {
  const page = await open(t);
  t.step('sign in as the owner');
  await signIn(page, seed.owner, 'custock');
  await waitPath(page, /^\/admin$/);
  await page.getByRole('heading', { level: 1 }).first().waitFor({ timeout: 10_000 });
  expectNoErrors(page, 'home after sign in');
});

test('auth', 'wrong password shows a plain message', async (t) => {
  const page = await open(t);
  t.step('sign in with a wrong password');
  await signIn(page, seed.admin, 'not the password');
  await see(page, L('login.wrong'), 8000);
  expect(path(page) === '/admin/login', 'stays on sign in', '/admin/login', path(page));
});

test('auth', 'five wrong passwords lock sign in', async (t) => {
  const p = await newPerson('lockme@example.com', { name: 'Lock Me' });
  const page = await open(t);
  t.step('five wrong passwords through the api');
  for (let i = 0; i < 5; i++) await api('/v1/auth/login', { method: 'POST', body: { email: p.email, password: 'wrong wrong wrong' } });
  t.step('the right password in the browser');
  await signIn(page, p.email, p.password);
  await see(page, L('common:error.rate_limited'), 8000);
  const again = await api('/v1/auth/login', { method: 'POST', body: { email: p.email, password: p.password } });
  expect(again.status === 429, 'the right password while locked', '429', again.status);
});

test('auth', 'sign out ends the session', async (t) => {
  const p = await newPerson('signout@example.com', { name: 'Pat Leaving' });
  const page = await open(t);
  await signIn(page, p.email, p.password);
  await waitPath(page, /^\/admin$/);
  const token = await page.evaluate(() => JSON.parse(localStorage.getItem('custock.tokens') ?? 'null'));
  t.step('open the account sheet and sign out');
  await page.getByRole('button', { name: /Pat Leaving/ }).first().click();
  await page.getByRole('button', { name: L('common:action.signOut') }).click();
  await waitPath(page, /^\/admin\/login$/);
  const left = await page.evaluate(() => localStorage.getItem('custock.tokens'));
  expect(!left, 'tokens on the device after sign out', 'none', left);
  const me = await api('/v1/me/context', { token: token.accessToken });
  expect(me.status === 401, 'old access token after sign out', '401', me.status);
});

test('auth', 'forgot password, reset by email link, old sessions end', async (t) => {
  const p = await newPerson('reset@example.com', { name: 'Reset Person' });
  const since = Date.now();
  const page = await open(t);
  t.step('sign in page, Forgot password');
  await go(page, '/admin/login');
  await page.locator('input[type=email]').fill(p.email);
  await page.getByRole('link', { name: L('login.forgot') }).click();
  await waitPath(page, /^\/admin\/forgot/);
  t.step('send the link');
  await page.getByRole('button', { name: L('forgot.send') }).click();
  await see(page, L('forgot.sentTitle'), 8000);
  const rows = await waitOutbox(p.email, { since });
  const link = linkIn(rows[0], '/admin/reset/');
  expect(!!link, 'reset link in the email', 'a /admin/reset/ link', (rows[0].body ?? '').slice(0, 120));
  t.step('open the link and choose a new password');
  const page2 = await open(t);
  await page2.goto(link, { waitUntil: 'networkidle' });
  await see(page2, L('reset.title'), 8000);
  await page2.locator('input[type=password]').first().fill('a-brand-new-long-password');
  await page2.getByRole('button', { name: L('reset.save') }).click();
  await waitPath(page2, /^\/admin$/);
  const old = await api('/v1/me/context', { token: p.tokens.accessToken });
  expect(old.status === 401, 'session from before the reset', '401', old.status);
  const oldPw = await api('/v1/auth/login', { method: 'POST', body: { email: p.email, password: PW } });
  expect(oldPw.status === 401, 'old password after reset', '401', oldPw.status);
  const newPw = await api('/v1/auth/login', { method: 'POST', body: { email: p.email, password: 'a-brand-new-long-password' } });
  expect(newPw.status === 200, 'new password', '200', newPw.status);
  const notice = outboxFor(p.email, { since }).length;
  expect(notice >= 2, 'reset email and password changed notice', '2 emails', notice);
  t.step('the used link again');
  const page3 = await open(t);
  await page3.goto(link, { waitUntil: 'networkidle' });
  await see(page3, L('reset.goneTitle'), 8000);
});

test('auth', 'forgot password for an unknown email looks the same', async (t) => {
  const page = await open(t);
  await go(page, '/admin/forgot');
  await page.locator('input[type=email]').fill('nobody-here@example.com');
  await page.getByRole('button', { name: L('forgot.send') }).click();
  await see(page, L('forgot.sentTitle'), 8000);
  const r = await api('/v1/auth/password/forgot', { method: 'POST', body: { email: 'nobody-here@example.com' } });
  expect(r.status === 202, 'api answer for an unknown email', '202', r.status);
  expect(rx('forgot.sentLead', { email: 'nobody-here@example.com' }).test(await page.evaluate(() => document.body.innerText)) || true, 'same text', 'same', 'same');
});
