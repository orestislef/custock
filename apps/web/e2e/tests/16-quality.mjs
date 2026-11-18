// quality on every screen, in greek and russian: no english left over, no raw text keys, nothing
// clipped or wider than a 320px phone, and the axe rules for names, contrast and aria, in light and
// dark. every finding of the run is written to results/quality-findings.json.

import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import cfg from '../e2e.config.mjs';
import { Fail, go, login, ok, one, open, seed, test, lemoni } from '../lib.mjs';
import { superAdmin } from '../helpers.mjs';

const require = createRequire(join(cfg.repo, 'package.json'));
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const RULES = [
  'color-contrast', 'button-name', 'link-name', 'label', 'select-name', 'image-alt', 'input-button-name',
  'aria-allowed-attr', 'aria-required-attr', 'aria-valid-attr-value', 'aria-valid-attr', 'aria-hidden-focus',
  'aria-required-children', 'aria-required-parent', 'aria-roles', 'aria-toggle-field-name', 'aria-command-name',
  'nested-interactive', 'list', 'listitem', 'duplicate-id-aria', 'html-has-lang', 'html-lang-valid',
  'document-title', 'heading-order', 'empty-heading', 'scrollable-region-focusable', 'role-img-alt', 'svg-img-alt',
];

const all = [];
const out = join(cfg.results, 'quality-findings.json');

// every english text that greek or russian says differently: if one of them shows on a greek or
// russian page, it is a left over
function englishOnly(locale) {
  const read = (l, ns) => JSON.parse(readFileSync(join(cfg.build, 'pkgs', 'i18n', 'src', 'locales', l, `${ns}.json`), 'utf8'));
  const flat = (o, pre = '', acc = {}) => {
    for (const [k, v] of Object.entries(o)) {
      const key = pre ? `${pre}.${k}` : k;
      if (v && typeof v === 'object') flat(v, key, acc);
      else if (typeof v === 'string') acc[key] = v;
    }
    return acc;
  };
  const set = new Set();
  for (const ns of ['web', 'common', 'server']) {
    const en = flat(read('en', ns));
    const other = flat(read(locale, ns));
    for (const [k, v] of Object.entries(en)) {
      if (v.includes('{{') || v.trim().length < 3 || !/[A-Za-z]{2}/.test(v)) continue;
      if (other[k] === v) continue;
      set.add(v.trim());
    }
  }
  // brand and format words that stay the same in every language
  for (const w of ['Custock', 'Lemoni', 'Email', 'OK', 'QR', 'EAN-13', 'Code 128', 'PNG', 'CSV', 'URL', 'API']) set.delete(w);
  return [...set];
}
const ENGLISH = {};

async function check(page, where, locale, { width, scheme }) {
  ENGLISH[locale] ??= englishOnly(locale);
  const found = await page.evaluate(({ en }) => {
    const english = new Set(en);
    const visible = (e) => {
      if (!e) return false;
      const s = getComputedStyle(e);
      if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const leftovers = new Set();
    const keys = new Set();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const t = (n.textContent ?? '').trim();
      if (!t || !visible(n.parentElement)) continue;
      if (n.parentElement.closest('script, style, code, pre, [data-quality-skip]')) continue;
      if (english.has(t)) leftovers.add(t);
      if (/^[a-z][a-zA-Z]+(\.[a-zA-Z_][a-zA-Z0-9_]*){1,}$/.test(t) && !/\.(com|gr|app|dev|org|net|io|png|jpg|webp|json)$/.test(t)) keys.add(t);
    }
    for (const el of document.querySelectorAll('[aria-label], [placeholder], [title], img[alt]')) {
      if (!visible(el) && el.tagName !== 'INPUT') continue;
      for (const a of ['aria-label', 'placeholder', 'title', 'alt']) {
        const v = el.getAttribute(a)?.trim();
        if (v && english.has(v)) leftovers.add(`${v} (${a})`);
      }
    }
    // text cut inside its own box: wider than the box, with nothing that says so (no ellipsis)
    const clipped = [];
    for (const el of document.querySelectorAll('button, a, [role=tab], [role=button], label, th, h1, h2, h3, .chip, .row-title, .row-sub, .btn')) {
      if (!visible(el)) continue;
      const s = getComputedStyle(el);
      if (s.textOverflow === 'ellipsis' || el.closest('[data-quality-skip]')) continue;
      // screen reader only text is clipped on purpose
      if (el.clientWidth <= 1 || s.clipPath !== 'none' || s.clip !== 'auto') continue;
      if (el.scrollWidth > el.clientWidth + 2 && /(hidden|clip)/.test(s.overflowX)) clipped.push(`${el.tagName.toLowerCase()} "${(el.textContent ?? '').trim().slice(0, 40)}"`);
    }
    // a label squeezed by a long value or picker beside it, down to a letter or two per line
    for (const el of document.querySelectorAll('.row-title')) {
      const text = (el.textContent ?? '').trim();
      if (!visible(el) || text.length < 6 || el.closest('[data-quality-skip]')) continue;
      if (el.getBoundingClientRect().width < 56) clipped.push(`squeezed "${text.slice(0, 40)}"`);
    }
    const w = document.documentElement.clientWidth;
    const wide = document.documentElement.scrollWidth > w + 1;
    return { leftovers: [...leftovers].slice(0, 15), keys: [...keys].slice(0, 10), clipped: clipped.slice(0, 10), wide };
  }, { en: ENGLISH[locale] });
  // through the devtools protocol, so the page's content security policy does not block it
  if (!(await page.evaluate(() => typeof window.axe !== 'undefined'))) await page.evaluate(`${AXE};void 0`);
  const axe = await page.evaluate(async (rules) => {
    // eslint-disable-next-line no-undef
    const r = await axe.run(document, { runOnly: { type: 'rule', values: rules }, resultTypes: ['violations'] });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.slice(0, 4).map((n) => `${n.target.join(' ')}${n.any?.[0]?.message ? `: ${n.any[0].message.slice(0, 120)}` : ''}`) }));
  }, RULES);
  const f = { where, locale, width, scheme, ...found, axe };
  const bad = f.leftovers.length || f.keys.length || f.clipped.length || f.wide || f.axe.length;
  if (bad) all.push(f);
  writeFileSync(out, JSON.stringify(all, null, 2));
  return bad ? f : null;
}

async function sweep(t, { tokens, locale, device, width, scheme = 'light', pages }) {
  const page = await open(t, { tokens, locale, device, scheme, viewport: width ? { width, height: 800 } : null });
  const bad = [];
  for (const p of pages) {
    t.step(p);
    await go(page, p);
    await page.waitForTimeout(500);
    const f = await check(page, p, locale, { width: width ?? (device === 'phone' ? 390 : 1280), scheme });
    if (f) bad.push(f);
  }
  if (bad.length) {
    const summary = bad.map((b) => `${b.where}: ${[
      b.leftovers.length && `english ${b.leftovers.join(' | ')}`,
      b.keys.length && `keys ${b.keys.join(' ')}`,
      b.clipped.length && `clipped ${b.clipped.join(' | ')}`,
      b.wide && 'wider than the screen',
      b.axe.length && `axe ${b.axe.map((a) => `${a.id}(${a.nodes.length})`).join(' ')}`,
    ].filter(Boolean).join('; ')}`).join(' || ');
    throw new Fail('quality findings', 'none', summary.slice(0, 1500));
  }
}

async function staffPages() {
  const { orgId } = await lemoni();
  const owner = await login(seed.owner);
  const products = await ok(`/v1/orgs/${orgId}/products?limit=1`, { token: owner });
  const customers = await ok(`/v1/orgs/${orgId}/customers?limit=1`, { token: owner });
  const posts = await ok(`/v1/orgs/${orgId}/posts`, { token: owner });
  const roles = await ok(`/v1/orgs/${orgId}/roles`, { token: owner });
  const links = await ok(`/v1/orgs/${orgId}/join-links`, { token: owner });
  const p = products.items[0]?.id, c = customers.items[0]?.id, post = posts.items?.[0]?.id, role = roles.find((r) => r.key === 'manager' || /manager/i.test(r.name))?.id;
  const b = '/admin/lemoni';
  return {
    a: [b, `${b}/stock`, `${b}/stock/${p}`, `${b}/stock/${p}/edit`, `${b}/stock/new`, `${b}/stock/counts`, `${b}/stock/transfers`, `${b}/stock/categories`, `${b}/scan`],
    b: [`${b}/customers`, `${b}/customers/${c}`, `${b}/posts`, `${b}/posts/new`, ...(post ? [`${b}/posts/${post}`] : []), `${b}/reports`, `${b}/team`, `${b}/team/roles`, ...(role ? [`${b}/team/roles/${role}`] : [])],
    c: [`${b}/join-links`, ...(links[0] ? [`${b}/print/${links[0].id}`] : []), `${b}/settings`, `${b}/audit`, `/admin/print/label/${p}`.replace('/admin/', `${b}/`)],
    product: p,
  };
}

const publicPages = async () => {
  const link = one('SELECT code FROM join_links WHERE disabled_at IS NULL LIMIT 1');
  const code = one("SELECT code FROM barcodes WHERE code LIKE '520%' LIMIT 1") ?? one('SELECT code FROM barcodes LIMIT 1');
  return ['/', '/admin/login', '/admin/forgot', ...(link ? [`/j/${link.code}`] : []), ...(code ? [`/p/${code.code}`] : []), '/invite/not-a-token', '/unsubscribe/not-a-token', '/admin/reset/not-a-token', '/nothing-here'];
};

for (const locale of ['el', 'ru']) {
  for (const part of ['a', 'b', 'c']) {
    test('quality', `${locale} staff pages ${part}, desktop`, async (t) => {
      const pages = (await staffPages())[part];
      await sweep(t, { tokens: await login(seed.owner), locale, device: 'desktop', pages });
    });
    test('quality', `${locale} staff pages ${part}, 320px phone`, async (t) => {
      const pages = (await staffPages())[part];
      await sweep(t, { tokens: await login(seed.owner), locale, device: 'phone', width: 320, pages });
    });
  }
  test('quality', `${locale} customer app, 320px phone`, async (t) => {
    const { product } = await staffPages();
    await sweep(t, { tokens: await login(seed.customer), locale, device: 'phone', width: 320, pages: ['/s/lemoni', '/s/lemoni/offers', '/s/lemoni/news', '/s/lemoni/me', `/s/lemoni/p/${product}`] });
  });
  test('quality', `${locale} public pages, 320px phone`, async (t) => {
    await sweep(t, { tokens: null, locale, device: 'phone', width: 320, pages: await publicPages() });
  });
  test('quality', `${locale} super admin, desktop and phone`, async (t) => {
    const sa = await superAdmin();
    const org = (await lemoni()).orgId;
    const pages = ['/admin/platform', `/admin/platform/${org}`, '/admin/platform/policies', '/admin/platform/errors', '/admin/platform/api', '/admin/platform/server', '/admin/platform/audit'];
    await sweep(t, { tokens: sa.tokens, locale, device: 'desktop', pages });
    await sweep(t, { tokens: sa.tokens, locale, device: 'phone', width: 320, pages });
  });
}

for (const scheme of ['light', 'dark']) {
  test('quality', `dark and light contrast, ${scheme}, staff and customer`, async (t) => {
    const s = await staffPages();
    await sweep(t, { tokens: await login(seed.owner), locale: 'en', device: 'phone', scheme, pages: [s.a[0], s.a[1], s.a[2], s.b[2], s.b[5], s.c[2]] });
    await sweep(t, { tokens: await login(seed.customer), locale: 'en', device: 'phone', scheme, pages: ['/s/lemoni', '/s/lemoni/me'] });
  });
}
