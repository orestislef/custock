// what the big business hunt found: long lists stopped at their first page (200 products and
// customers, 50 posts) with a count that called it the whole list, a busy shop's products showed no
// history, a long word without spaces pushed pages sideways, and every page shipped all three
// languages and the server's texts.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { L, eq, expect, go, lemoni, login, ok, open, overflow, see, seed, sleep, test } from '../lib.mjs';
import cfg from '../e2e.config.mjs';

const stamp = () => Date.now().toString(36);
const locales = join(cfg.repo, 'packages', 'i18n', 'src', 'locales');
const json = (lc, ns) => JSON.parse(readFileSync(join(locales, lc, `${ns}.json`), 'utf8'));

async function manyProducts(n, prefix) {
  const l = await lemoni();
  const owner = await login(seed.owner);
  for (let i = 0; i < n; i++) {
    await ok(`/v1/orgs/${l.orgId}/products`, { method: 'POST', token: owner, body: { name: `${prefix} ${String(i).padStart(3, '0')}`, priceMinor: 100 + i, uom: 'piece' } });
  }
}

test('stock', 'a long catalog loads more as you scroll, and the count says when it is not all yet', async (t) => {
  const prefix = `E2E Paged ${stamp()}`;
  await manyProducts(105, prefix);
  for (const device of ['phone', 'desktop']) {
    t.step(device);
    const page = await open(t, { device, tokens: await login(seed.owner) });
    await go(page, '/admin/stock');
    await page.locator('input[type=search]').first().fill(prefix);
    await see(page, L('list.countMore', { count: 100 }), 15_000);
    t.step('scroll to the end');
    await page.getByRole('button', { name: L('list.more'), exact: true }).last().scrollIntoViewIfNeeded();
    await see(page, L('stock.count', { count: 105 }), 15_000);
    expect(!(await page.getByRole('button', { name: L('list.more'), exact: true }).count()), 'no more button once everything is shown');
    await page.context().close();
  }
});

test('posts', 'the posts list shows every post, not only the first 50', async (t) => {
  const l = await lemoni();
  const owner = await login(seed.owner);
  const prefix = `E2E Many ${stamp()}`;
  for (let i = 0; i < 55; i++) {
    await ok(`/v1/orgs/${l.orgId}/posts`, { method: 'POST', token: owner, body: {
      kind: 'news', defaultLocale: 'en', translations: { en: { title: `${prefix} ${i}`, body: 'E2E body text' } }, channels: ['feed'],
      audience: { scopes: [{ scopeType: 'shop', scopeId: l.kifisia }] },
    } });
  }
  const page = await open(t, { device: 'phone', tokens: owner });
  await go(page, '/admin/posts?status=draft');
  await see(page, `${prefix} 54`);
  const cards = page.locator('main li', { hasText: prefix });
  for (let i = 0; i < 20 && (await cards.count()) < 55; i++) {
    const more = page.getByRole('button', { name: L('list.more'), exact: true });
    if (await more.count()) await more.last().scrollIntoViewIfNeeded();
    await sleep(500);
  }
  eq(await cards.count(), 55, 'drafts shown after scrolling');
  await see(page, `${prefix} 0`);
});

test('stock', "a product's history shows its own movements even when the shop is busy with others", async (t) => {
  const l = await lemoni();
  const owner = await login(seed.owner);
  const name = `E2E Quiet ${stamp()}`;
  const quiet = await ok(`/v1/orgs/${l.orgId}/products`, { method: 'POST', token: owner, body: { name, priceMinor: 300, uom: 'piece' } });
  const busy = await ok(`/v1/orgs/${l.orgId}/products`, { method: 'POST', token: owner, body: { name: `${name} busy`, priceMinor: 300, uom: 'piece' } });
  const move = (v, qtyDelta, kind) => ({ id: crypto.randomUUID(), shopId: l.kifisia, variantId: v, qtyDelta, kind, occurredAt: Date.now() });
  await ok(`/v1/orgs/${l.orgId}/movements`, { method: 'POST', token: owner, body: { movements: [move(quiet.variants[0].id, 4, 'receive')] } });
  // then 40 movements of another product, so the shop's latest 30 are all someone else's
  await ok(`/v1/orgs/${l.orgId}/movements`, { method: 'POST', token: owner, body: { movements: Array.from({ length: 40 }, () => move(busy.variants[0].id, 1, 'receive')) } });
  const page = await open(t, { tokens: owner });
  await go(page, `/admin/stock/${quiet.id}`);
  await see(page, L('product.history'));
  const history = page.locator('section', { has: page.getByRole('heading', { name: L('product.history'), exact: true }) });
  await history.getByText(L('common:movement.receive'), { exact: true }).first().waitFor({ timeout: 10_000 });
  eq(await history.getByText(L('product.noHistory'), { exact: true }).count(), 0, 'empty history rows');
});

test('layout', 'a 200 letter name or title without spaces wraps instead of pushing the page sideways', async (t) => {
  const l = await lemoni();
  const owner = await login(seed.owner);
  const word = 'Υπερμακρυλέξηχωρίςκενάγιαναδούμεαναδιπλώνεταισωστά'.repeat(5).slice(0, 200);
  const p = await ok(`/v1/orgs/${l.orgId}/products`, { method: 'POST', token: owner, body: { name: word, priceMinor: 100, uom: 'piece' } });
  const post = await ok(`/v1/orgs/${l.orgId}/posts`, { method: 'POST', token: owner, body: {
    kind: 'news', defaultLocale: 'en', translations: { en: { title: word, body: `${word} ${word}` } }, channels: ['feed'],
    audience: { scopes: [{ scopeType: 'shop', scopeId: l.kifisia }] },
  } });
  for (const device of ['phone', 'desktop']) {
    const page = await open(t, { device, tokens: owner });
    for (const path of [`/admin/stock/${p.id}`, `/admin/stock/${p.id}/edit`, '/admin/posts?status=draft', `/admin/posts/${post.id}`, '/admin/stock']) {
      t.step(`${device} ${path.slice(0, 40)}`);
      await go(page, path);
      if (path === '/admin/stock') {
        await page.locator('input[type=search]').first().fill(word.slice(0, 30));
        await see(page, L('stock.count', { count: 1 }), 15_000);
      }
      await sleep(400);
      const o = await overflow(page);
      expect(!o.scroll, `${path} on a ${device} does not scroll sideways`, 'no sideways scroll', o.items.join(', '));
    }
    await page.context().close();
  }
});

// texts only the server uses (emails, pushes), long enough not to appear by chance
const serverOnly = (() => {
  const browser = JSON.stringify([json('en', 'web'), json('en', 'common')]);
  const out = [];
  const walk = (o) => { for (const v of Object.values(o)) { if (typeof v === 'string') { if (v.length >= 40 && !v.includes('{{') && !browser.includes(v)) out.push(v); } else if (v && typeof v === 'object') walk(v); } };
  walk(json('en', 'server'));
  return out.slice(0, 8);
})();
// one text of each language that every page's language file carries
const marker = (lc) => json(lc, 'web').list.more;

async function scriptsOf(page, path) {
  const bodies = [];
  page.on('response', (r) => { if (r.url().endsWith('.js')) bodies.push(r.text().catch(() => '')); });
  await go(page, path);
  await sleep(500);
  return (await Promise.all(bodies)).join('\n');
}

test('i18n', 'a page ships only the reader language and none of the server texts; the switch loads the next one', async (t) => {
  expect(serverOnly.length >= 3, 'server only texts found for the check');
  const l = await lemoni();
  const links = await ok(`/v1/orgs/${l.orgId}/join-links`, { token: await login(seed.owner) });
  for (const [path, lc] of [[`/j/${links[0].code}`, 'el'], ['/admin/login', 'en']]) {
    t.step(`${path} in ${lc}`);
    const page = await open(t, { locale: lc, serviceWorkers: 'block' });
    const js = await scriptsOf(page, path);
    const shipped = ['en', 'el', 'ru'].filter((x) => js.includes(marker(x)));
    eq(shipped.join(','), lc, `languages in the scripts of ${path}`);
    const leaked = serverOnly.filter((s) => js.includes(s));
    eq(leaked.length, 0, `server texts in the scripts of ${path}`);
    await page.context().close();
  }

  t.step('switch on the sign in page');
  const page = await open(t, { locale: 'en', serviceWorkers: 'block' });
  const later = [];
  page.on('response', (r) => { if (r.url().endsWith('.js')) later.push(r.text().catch(() => '')); });
  await go(page, '/admin/login');
  await see(page, L('login.lead'));
  const select = page.locator(`select[aria-label="${L('locale.label')}"]`).first();
  await select.selectOption('el');
  await see(page, L('login.lead', {}, 'el'), 15_000);
  let js = (await Promise.all(later)).join('\n');
  expect(js.includes(marker('el')), 'Greek file loaded on the switch');
  expect(!js.includes(marker('ru')), 'Russian still not loaded');
  await page.locator(`select[aria-label="${L('locale.label', {}, 'el')}"]`).first().selectOption('ru');
  await see(page, L('login.lead', {}, 'ru'), 15_000);
  t.step('and back, without a reload');
  await page.locator(`select[aria-label="${L('locale.label', {}, 'ru')}"]`).first().selectOption('en');
  await see(page, L('login.lead'), 15_000);
  js = (await Promise.all(later)).join('\n');
  expect(js.includes(marker('ru')), 'Russian file loaded on the second switch');
});
