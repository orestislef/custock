// the small test runner and the helpers every test file uses. tests run one after the other on one
// throwaway database, so a later test may rely on what an earlier one created only inside its own
// file. every failure keeps the page, the steps, expected and actual, and a screenshot.

import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import cfg from './e2e.config.mjs';
import { dbFile } from './env.mjs';

const require = createRequire(join(cfg.repo, 'package.json'));
const { chromium } = require('playwright');
const Database = require('better-sqlite3');

export const WEB = `http://localhost:${cfg.webPort}${cfg.basePath}`;
export const API = `http://127.0.0.1:${cfg.apiPort}`;
const shots = join(cfg.results, 'shots');
mkdirSync(shots, { recursive: true });

// ---------------------------------------------------------------- texts, the way the app shows them

const loc = (l, ns) => JSON.parse(readFileSync(join(cfg.build, 'pkgs', 'i18n', 'src', 'locales', l, `${ns}.json`), 'utf8'));
// read on first use: the run may rebuild the snapshot after this file is imported
let TEXTS = null;
const texts = () => (TEXTS ??= Object.fromEntries(['en', 'el', 'ru'].map((l) => [l, { web: loc(l, 'web'), common: loc(l, 'common'), server: loc(l, 'server') }])));
const plural = { en: new Intl.PluralRules('en'), el: new Intl.PluralRules('el'), ru: new Intl.PluralRules('ru') };

export function L(key, vars = {}, locale = 'en') {
  const [ns, path] = key.includes(':') ? key.split(':') : ['web', key];
  // keys may themselves hold dots (perm.stock.sell), so try the longest match at each level
  const get = (p) => {
    const walk = (o, parts) => {
      if (!parts.length) return o;
      if (o == null || typeof o !== 'object') return undefined;
      for (let n = parts.length; n >= 1; n--) {
        const k = parts.slice(0, n).join('.');
        if (k in o) { const v = walk(o[k], parts.slice(n)); if (v !== undefined) return v; }
      }
      return undefined;
    };
    return walk(texts()[locale][ns], p.split('.'));
  };
  let v = vars.count != null ? get(`${path}_${plural[locale].select(vars.count)}`) ?? get(`${path}_other`) ?? get(path) : get(path);
  if (typeof v !== 'string') throw new Error(`no text ${key} in ${locale}`);
  return v.replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars[k] ?? ''));
}
export const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const rx = (key, vars, locale) => new RegExp(esc(L(key, vars, locale)), 'i');

// ---------------------------------------------------------------- api and database

export async function api(path, { method = 'GET', body, token, headers = {} } = {}) {
  let res;
  for (let i = 0; ; i++) {
    try {
      res = await fetch(`${API}${path}`, {
    method,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${typeof token === 'string' ? token : token.accessToken}` } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      break;
    } catch (e) {
      if (i >= 3) throw e;
      await sleep(700);
    }
  }
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json };
}

export async function ok(path, opts) {
  const r = await api(path, opts);
  if (r.status >= 300) throw new Fail(`api ${opts?.method ?? 'GET'} ${path}`, '2xx', `${r.status} ${JSON.stringify(r.json).slice(0, 300)}`);
  return r.json;
}

const tokenCache = new Map();
export async function login(email, password = cfg.password, { fresh = false } = {}) {
  if (!fresh && tokenCache.has(email)) return tokenCache.get(email);
  const t = await ok('/v1/auth/login', { method: 'POST', body: { email, password } });
  tokenCache.set(email, t);
  return t;
}
export const forget = (email) => tokenCache.delete(email);

export function db() {
  return new Database(dbFile, { readonly: true, fileMustExist: true });
}
export function q(sql, params = {}) {
  const d = db();
  try { return d.prepare(sql).all(params); } finally { d.close(); }
}
export function one(sql, params = {}) {
  return q(sql, params)[0];
}

// the newest outbox rows for an address, straight from the database (account emails have no org)
export function outboxFor(to, { since = 0, channel = 'email' } = {}) {
  return q('SELECT * FROM dev_outbox WHERE to_address = @to AND channel = @ch AND created_at >= @since ORDER BY created_at DESC, rowid DESC', { to, ch: channel, since });
}
export async function waitOutbox(to, opts = {}, ms = 15_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const rows = outboxFor(to, opts);
    if (rows.length) return rows;
    await sleep(300);
  }
  throw new Fail(`outbox for ${to}`, 'a message', 'nothing arrived');
}
export function linkIn(row, part) {
  const text = `${row.body ?? ''}\n${row.html ?? ''}`;
  const m = text.match(new RegExp(`https?://[^\\s"'<>]*${esc(part)}[^\\s"'<>]*`));
  return m ? m[0].replace(/&amp;/g, '&') : null;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const seed = {
  owner: 'eleni@example.com', admin: 'nikos@example.com', managerKif: 'maria@example.com', managerGly: 'giorgos@example.com',
  staffKif: 'dimitris@example.com', staffMar: 'katerina@example.com', viewer: 'sofia@example.com', customer: 'anna@example.com',
};

let ctxCache = null;
export async function lemoni() {
  if (ctxCache) return ctxCache;
  const t = await login(seed.owner);
  const me = await ok('/v1/me/context', { token: t });
  const org = me.orgs.find((o) => o.slug === 'lemoni') ?? me.orgs[0];
  const shops = await ok(`/v1/orgs/${org.orgId}/shops?all=1`, { token: t });
  const byName = Object.fromEntries(shops.map((s) => [s.name.toLowerCase(), s.id]));
  ctxCache = { orgId: org.orgId, shops, kifisia: byName.kifisia, marousi: byName.marousi, glyfada: byName.glyfada };
  return ctxCache;
}
export async function levels(productId, token) {
  const { orgId } = await lemoni();
  const p = await ok(`/v1/orgs/${orgId}/products/${productId}`, { token: token ?? (await login(seed.owner)) });
  return p;
}
export async function onHand(variantId, shopId) {
  const r = one('SELECT on_hand FROM stock_levels WHERE variant_id = @v AND shop_id = @s', { v: variantId, s: shopId });
  return r ? r.on_hand : 0;
}

// ---------------------------------------------------------------- failures

export class Fail extends Error {
  constructor(what, expected, actual) {
    super(`${what}: expected ${expected}, got ${actual}`);
    this.what = what;
    this.expected = String(expected);
    this.actual = String(actual);
  }
}
// a check this machine cannot make (for example a browser permission state headless chrome lacks)
export class Skip extends Error {}
export function skip(why) { throw new Skip(why); }

export function expect(cond, what, expected = 'true', actual = 'false') {
  if (!cond) throw new Fail(what, expected, actual);
}
export function eq(actual, expected, what) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Fail(what, JSON.stringify(expected), JSON.stringify(actual));
}

// ---------------------------------------------------------------- browser

let browser = null;
export async function launchBrowser() {
  browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  return browser;
}
export async function closeBrowser() { await browser?.close(); }

// errors seen in pages, for the layout report
export const pageProblems = [];
const EXPECTED_FAIL = [/\/v1\/client-errors/, /favicon/, /\/v1\/push\/key/, /status=40[134]/];

// a context like a desktop or a phone. ios gives an iphone safari user agent.
export async function open(t, { device = 'desktop', ios = false, locale = 'en', scheme = 'light', tokens = null, permissions = [], storage = {} } = {}) {
  const phone = device === 'phone';
  const ctx = await browser.newContext({
    viewport: phone ? cfg.phone : cfg.desktop,
    deviceScaleFactor: phone ? 2 : 1,
    isMobile: phone,
    hasTouch: phone,
    userAgent: ios ? cfg.iphoneUA : undefined,
    colorScheme: scheme,
    locale,
    permissions,
    serviceWorkers: 'allow',
  });
  await ctx.addCookies([{ name: 'locale', value: locale, url: `http://localhost:${cfg.webPort}` }]);
  await ctx.addInitScript(({ tk, st }) => {
    if (sessionStorage.getItem('e2e.init')) return;
    sessionStorage.setItem('e2e.init', '1');
    if (tk) localStorage.setItem('custock.tokens', JSON.stringify(tk));
    for (const [k, v] of Object.entries(st)) localStorage.setItem(k, v);
  }, { tk: tokens, st: storage });
  const page = await ctx.newPage();
  page.problems = [];
  page.on('pageerror', (e) => page.problems.push(`pageerror ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) page.problems.push(`console ${m.text().slice(0, 200)}`); });
  page.on('response', (r) => {
    if (r.status() >= 500 || (r.status() >= 400 && !EXPECTED_FAIL.some((x) => x.test(r.url())) && !r.url().includes('/v1/'))) page.problems.push(`http ${r.status()} ${r.url().replace(/\?.*$/, '')}`);
  });
  t.contexts.push(ctx);
  t.page = page;
  return page;
}

export async function go(page, path, { wait = 'networkidle' } = {}) {
  await page.goto(`${WEB}${path}`, { waitUntil: wait, timeout: 45_000 }).catch((e) => { if (!/ERR_INTERNET_DISCONNECTED|interrupted/.test(e.message)) throw e; });
  await page.waitForTimeout(250);
}

// wait until a visible element shows the text (hidden select options and closed sheets do not count)
export async function see(page, what, ms = 10_000) {
  const loc = (typeof what === 'string' ? page.getByText(what) : page.getByText(what)).filter({ visible: true }).first();
  try {
    await loc.waitFor({ state: 'visible', timeout: ms });
  } catch {
    throw new Fail('text on the page', String(what), 'not visible');
  }
  return loc;
}

export const path = (page) => new URL(page.url()).pathname.replace(cfg.basePath, '') || '/';
export const text = (page) => page.evaluate(() => document.body.innerText);

export async function shot(page, name) {
  const file = join(shots, `${name.replace(/[^\w.-]+/g, '-').slice(0, 90)}.png`);
  await page.screenshot({ path: file, fullPage: false }).catch(() => {});
  return file;
}

// words that talk about rights. none of them may show to people working in a business
export const PERMISSION_WORDS = {
  en: [/permission/i, /read[- ]only/i, /not allowed/i, /ask your manager/i, /you (do not|don't|cannot|can't) have access/i, /no access/i, /forbidden/i, /not authori[sz]ed/i],
  el: [/δικαίωμα/i, /δικαιώματα/i, /μόνο ανάγνωση/i, /δεν επιτρέπεται/i, /ρωτήστε τον υπεύθυνο/i, /χωρίς πρόσβαση/i, /δεν έχετε πρόσβαση/i],
  ru: [/разрешени/i, /прав доступа/i, /только чтение/i, /только для чтения/i, /не разрешено/i, /спросите менеджера/i, /нет доступа/i],
};
export async function permissionWords(page, locale = 'en') {
  const body = await text(page);
  return PERMISSION_WORDS[locale].filter((r) => r.test(body)).map((r) => body.match(r)?.[0]);
}

export async function overflow(page) {
  return page.evaluate(() => {
    const w = document.documentElement.clientWidth;
    const wide = [...document.querySelectorAll('body *')].filter((el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      if (s.position === 'fixed' || r.width === 0) return false;
      let p = el.parentElement;
      while (p) { const ps = getComputedStyle(p); if (/(auto|scroll|hidden)/.test(ps.overflowX)) return false; p = p.parentElement; }
      return r.right > w + 1;
    });
    return { scroll: document.documentElement.scrollWidth > w + 1, items: wide.slice(0, 3).map((e) => `${e.tagName.toLowerCase()}.${String(e.className).slice(0, 40)}`) };
  });
}

// the floating tab bar on phones must never cover the end of the page
export async function underTabBar(page) {
  return page.evaluate(async () => {
    const bar = [...document.querySelectorAll('nav, [role=tablist]')].find((n) => getComputedStyle(n).position === 'fixed' && n.getBoundingClientRect().top > innerHeight / 2);
    if (!bar) return null;
    window.scrollTo(0, document.documentElement.scrollHeight);
    await new Promise((r) => setTimeout(r, 300));
    const top = bar.getBoundingClientRect().top;
    const main = document.querySelector('main') ?? document.body;
    const items = [...main.querySelectorAll('button, a, input, select, textarea, p, li, h2, h3')].filter((e) => {
      const r = e.getBoundingClientRect();
      return r.height > 0 && r.width > 0 && getComputedStyle(e).visibility !== 'hidden' && !bar.contains(e);
    });
    const last = items.reduce((m, e) => Math.max(m, e.getBoundingClientRect().bottom), 0);
    window.scrollTo(0, 0);
    return last > top + 1 ? Math.round(last - top) : 0;
  });
}

export async function a11y(page) {
  return page.evaluate(() => {
    const visible = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return (r.width > 0 || r.height > 0) && s.visibility !== 'hidden' && s.display !== 'none'; };
    const imgs = [...document.querySelectorAll('img')].filter((i) => !i.hasAttribute('alt') && visible(i)).map((i) => (i.getAttribute('src') ?? '').slice(0, 60));
    const named = (el) => {
      if (el.getAttribute('aria-label')?.trim()) return true;
      const by = el.getAttribute('aria-labelledby');
      if (by && by.split(/\s+/).some((id) => document.getElementById(id)?.textContent?.trim())) return true;
      if (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent?.trim()) return true;
      if (el.closest('label')?.textContent?.trim()) return true;
      if (el.getAttribute('title')?.trim()) return true;
      if (el.getAttribute('placeholder')?.trim()) return true;
      return false;
    };
    const inputs = [...document.querySelectorAll('input, select, textarea')]
      .filter((e) => e.type !== 'hidden' && e.type !== 'file' && (visible(e) || e.tagName === 'SELECT'))
      .filter((e) => !named(e))
      .map((e) => `${e.tagName.toLowerCase()}[${e.type ?? ''}]${e.name ? ` name=${e.name}` : ''}`);
    return { imgs, inputs };
  });
}

// what a screen reader gets: form controls in chrome's own accessibility tree that have no name.
// this is the tree assistive tech reads, so a label that only looks tied but is not shows up here
export async function unnamedControls(page) {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { nodes } = await cdp.send('Accessibility.getFullAXTree');
    const roles = new Set(['textbox', 'searchbox', 'combobox', 'spinbutton', 'checkbox', 'switch', 'radio', 'slider', 'listbox', 'button', 'link']);
    return nodes
      .filter((n) => !n.ignored && roles.has(n.role?.value) && !(n.name?.value ?? '').trim())
      .map((n) => `${n.role.value}${n.value?.value ? ` (${String(n.value.value).slice(0, 20)})` : ''}`);
  } finally {
    await cdp.detach().catch(() => {});
  }
}

// buttons in an open sheet footer keep room between them
export async function sheetGaps(page) {
  return page.evaluate(() => {
    const out = [];
    for (const f of document.querySelectorAll('[data-sheet-footer]')) {
      const bs = [...f.querySelectorAll('button')].filter((b) => b.getBoundingClientRect().width > 0);
      for (let i = 1; i < bs.length; i++) {
        const a = bs[i - 1].getBoundingClientRect(), b = bs[i].getBoundingClientRect();
        const sameRow = Math.abs(a.top - b.top) < 4;
        const gap = sameRow ? b.left - a.right : b.top - a.bottom;
        if (gap < 8) out.push(`${bs[i - 1].textContent?.trim()} | ${bs[i].textContent?.trim()}: ${Math.round(gap)}px`);
      }
    }
    return out;
  });
}

// ---------------------------------------------------------------- the runner

const tests = [];
export function test(group, name, fn) { tests.push({ group, name, fn }); }

export async function runAll({ only } = {}) {
  const results = [];
  for (const tc of tests) {
    if (only && !only.some((o) => `${tc.group} ${tc.name}`.toLowerCase().includes(o.toLowerCase()))) continue;
    const t = { contexts: [], page: null, steps: [], step(s) { this.steps.push(s); } };
    const started = Date.now();
    let res = { group: tc.group, name: tc.name, ok: true };
    try {
      await Promise.race([
        tc.fn(t),
        new Promise((_, rej) => setTimeout(() => rej(new Fail('time', `under ${cfg.testTimeoutMs / 1000}s`, 'timed out')), cfg.testTimeoutMs)),
      ]);
    } catch (e) {
      if (e instanceof Skip) {
        res = { ...res, ok: true, skipped: true, actual: e.message };
        console.log(`SKIP  ${tc.group} / ${tc.name}: ${e.message}`);
        for (const c of t.contexts) await c.close().catch(() => {});
        res.ms = Date.now() - started;
        results.push(res);
        continue;
      }
      const shotFile = t.page ? await shot(t.page, `${tc.group}-${tc.name}`) : null;
      res = {
        ...res, ok: false,
        page: t.page ? path(t.page) : '',
        steps: t.steps.join(' > '),
        expected: e.expected ?? '',
        actual: e.actual ?? String(e.message ?? e).split('\n')[0].slice(0, 300),
        what: e.what ?? '',
        screenshot: shotFile ? shotFile.replace(cfg.repo, '').replace(/\\/g, '/').replace(/^\//, '') : '',
      };
    }
    for (const c of t.contexts) {
      for (const p of c.pages()) if (p.problems?.length) pageProblems.push({ test: `${tc.group} ${tc.name}`, page: path(p), problems: [...new Set(p.problems)].slice(0, 5) });
      await c.close().catch(() => {});
    }
    res.ms = Date.now() - started;
    results.push(res);
    console.log(`${res.ok ? 'PASS' : 'FAIL'}  ${tc.group} / ${tc.name}${res.ok ? '' : `\n      ${res.what}: expected ${res.expected}, got ${res.actual}`}`);
  }
  return results;
}

export function writeReport(results) {
  const pass = results.filter((r) => r.ok && !r.skipped).length;
  const skipped = results.filter((r) => r.skipped).length;
  const lines = [`# end to end results`, '', `${pass} passed, ${results.length - pass - skipped} failed, ${skipped} skipped, ${results.length} total`, '', '| result | group | test |', '|---|---|---|'];
  for (const r of results) lines.push(`| ${r.skipped ? 'skip' : r.ok ? 'pass' : 'FAIL'} | ${r.group} | ${r.name}${r.skipped ? ` (${r.actual})` : ''} |`);
  lines.push('', '## failures', '');
  for (const r of results.filter((x) => !x.ok)) {
    lines.push(`### ${r.group} / ${r.name}`, `- page: ${r.page}`, `- steps: ${r.steps}`, `- check: ${r.what}`, `- expected: ${r.expected}`, `- actual: ${r.actual}`, `- screenshot: ${r.screenshot}`, '');
  }
  lines.push('## page errors seen during the run', '');
  for (const p of pageProblems) lines.push(`- ${p.test} (${p.page}): ${p.problems.join('; ')}`);
  writeFileSync(join(cfg.results, 'report.md'), lines.join('\n') + '\n');
  writeFileSync(join(cfg.results, 'results.json'), JSON.stringify({ results, pageProblems }, null, 2));
}
