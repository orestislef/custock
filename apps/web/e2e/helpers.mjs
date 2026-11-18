// shared steps: people made from invites, the super admin, quick lookups in the seeded business.

import { cli } from './env.mjs';
import { L, Fail, api, esc, expect, go, lemoni, login, ok, one, path, seed } from './lib.mjs';

// new passwords take no spaces (core validate.ts passwordProblem)
export const PW = 'correct-horse-battery';

// a brand new person, invited by the owner and registered from the link (never a seeded account)
export async function newPerson(email, { role = 'staff', shop = 'kifisia', name = 'Test Person', password = PW, scope } = {}) {
  const l = await lemoni();
  const owner = await login(seed.owner);
  const roles = await ok(`/v1/orgs/${l.orgId}/roles`, { token: owner });
  const r = roles.find((x) => x.templateKey === role);
  const sc = scope ?? (role === 'admin' || role === 'viewer' ? { scopeType: 'org', scopeId: l.orgId } : { scopeType: 'shop', scopeId: l[shop] });
  const inv = await ok(`/v1/orgs/${l.orgId}/invites`, { method: 'POST', token: owner, body: { email, roleId: r.id, ...sc, locale: 'en' } });
  const token = inv.link.split('/invite/')[1];
  const reg = await ok('/v1/invites/register', { method: 'POST', body: { token, displayName: name, password, locale: 'en' } });
  return { tokens: reg, email, password, inviteLink: inv.link };
}

// the super admin of the run: an account made by create-business, then the business goes away again
let sa = null;
export async function superAdmin() {
  if (sa) return sa;
  const email = 'root@example.com';
  const exists = one('SELECT id FROM users WHERE email = @e', { e: email });
  if (!exists) {
    const made = cli(['create-business', '--name', 'Bootstrap', '--slug', 'bootstrap', '--owner-email', email, '--owner-name', 'Root Admin', '--set-password'], { CUSTOCK_NEW_PASSWORD: PW });
    if (made.code !== 0) throw new Fail('create-business for the super admin', 'exit 0', made.out.slice(0, 300));
    const grant = cli(['make-superadmin', '--email', email]);
    if (grant.code !== 0) throw new Fail('make-superadmin', 'exit 0', grant.out.slice(0, 300));
    const del = cli(['delete-business', '--slug', 'bootstrap', '--confirm', 'bootstrap']);
    if (del.code !== 0) throw new Fail('delete the bootstrap business', 'exit 0', del.out.slice(0, 300));
  }
  sa = { email, tokens: await login(email, PW, { fresh: true }) };
  return sa;
}

export async function signIn(page, email, password) {
  await go(page, '/admin/login');
  await page.locator('input[type=email]').fill(email);
  await page.locator('input[autocomplete="current-password"]').fill(password);
  await page.getByRole('button', { name: L('common:action.signIn'), exact: true }).click();
}

export async function waitPath(page, re, ms = 15_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (re.test(path(page))) return true;
    await page.waitForTimeout(200);
  }
  throw new Fail('page after the step', String(re), path(page));
}

export async function variantByCode(code) {
  const v = one('SELECT b.variant_id AS v, pv.product_id AS p FROM barcodes b JOIN product_variants pv ON pv.id = b.variant_id WHERE b.code = @c OR b.code_norm = @c', { c: code });
  if (!v) throw new Fail(`barcode ${code}`, 'a variant', 'none');
  return { variantId: v.v, productId: v.p };
}

export async function anyCode(shop = 'kifisia') {
  const l = await lemoni();
  const r = one(
    `SELECT b.code, b.variant_id AS v FROM barcodes b JOIN stock_levels s ON s.variant_id = b.variant_id
      JOIN product_variants pv ON pv.id = b.variant_id JOIN products p ON p.id = pv.product_id
      WHERE s.shop_id = @s AND s.on_hand > 5 AND length(b.code) = 13 AND p.uom = 'piece' AND b.pack_qty = 1 AND p.name NOT LIKE 'E2E%' ORDER BY b.code LIMIT 1`, { s: l[shop] });
  return { code: r.code, variantId: r.v };
}

export function expectNoErrors(page, what) {
  const errs = (page.problems ?? []).filter((p) => p.startsWith('pageerror') || p.startsWith('http 5'));
  expect(errs.length === 0, what, 'no page errors', errs.slice(0, 2).join(' | '));
}
export { api };

// a click right after load can land before react is ready, so press until the sheet is open
export async function openSheet(page, trigger, tries = 6) {
  for (let i = 0; i < tries; i++) {
    await trigger.click();
    const open = await page.getByRole('dialog').last().waitFor({ state: 'visible', timeout: 1500 }).then(() => true, () => false);
    if (open) { await page.waitForTimeout(350); return page.getByRole('dialog').last(); }
  }
  throw new Fail('sheet after the click', 'open', 'never opened');
}
// the main button at the bottom of the open sheet
export const primary = (page) => page.locator('[data-sheet-footer] button').last();
// the number shown right after a label on the page
export async function numberAfter(page, label) {
  const body = await page.evaluate(() => document.body.innerText);
  const m = body.match(new RegExp(`${esc(label)}\\s*\\n\\s*([\\d.,]+)`));
  return m ? Number(m[1].replace(/[.,]/g, '')) : null;
}
