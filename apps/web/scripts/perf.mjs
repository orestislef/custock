// speed of the built web on a big business, on a throttled phone and on a desktop.
//   node apps/web/scripts/perf.mjs <build dir> <database file>
// the build dir is an e2e snapshot (node apps/web/e2e/build.mjs with E2E_BUILD_DIR and an empty
// E2E_BASE_PATH), the database comes from `pnpm --filter @custock/api big-db <file>`.
// prints the bundle sizes, first loads and a few interactions as markdown and json.

import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const build = resolve(process.argv[2] ?? 'e2e-build-big');
const dbFile = resolve(process.argv[3] ?? '');
if (!existsSync(dbFile)) throw new Error('give the database file made by big-db');
const API = Number(process.env.PERF_API_PORT ?? 8861);
const WEB = Number(process.env.PERF_WEB_PORT ?? 3861);
const web = `http://127.0.0.1:${WEB}`;
const api = `http://127.0.0.1:${API}`;
const node = process.execPath;
const procs = [];

function start(args, cwd, env) {
  const p = spawn(node, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  p.stdout.on('data', () => {});
  p.stderr.on('data', () => {});
  procs.push(p);
  return p;
}
async function wait(url) {
  for (let i = 0; i < 240; i++) {
    try { if ((await fetch(url)).status < 500) return; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${url} did not answer`);
}

function bundle() {
  const dir = join(build, 'web', '.next', 'static', 'chunks');
  const files = [];
  const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (f.endsWith('.js')) files.push(p); } };
  walk(dir);
  const sized = files.map((f) => { const b = readFileSync(f); return { file: basename(f), raw: b.length, gz: gzipSync(b).length }; }).sort((a, b) => b.raw - a.raw);
  return { count: sized.length, totalRaw: sized.reduce((a, x) => a + x.raw, 0), totalGz: sized.reduce((a, x) => a + x.gz, 0), top: sized.slice(0, 5) };
}

async function login(email) {
  const r = await fetch(`${api}/v1/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'custock' }) });
  if (!r.ok) throw new Error(`login ${email} ${r.status}`);
  return r.json();
}

async function context(browser, phone, tokens, orgId) {
  const ctx = await browser.newContext(phone
    ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'el-GR' }
    : { viewport: { width: 1280, height: 800 }, locale: 'el-GR' });
  if (tokens) {
    await ctx.addInitScript(([t, o]) => {
      localStorage.setItem('custock.tokens', JSON.stringify({ accessToken: t.accessToken, refreshToken: t.refreshToken, expiresAt: Date.now() + 10 * 60_000 }));
      if (o) localStorage.setItem('custock.org', o);
    }, [tokens, orgId]);
  }
  return ctx;
}

async function throttle(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  // slow 4g and a mid range phone
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
}

async function load(page, path, ready) {
  const t0 = Date.now();
  await page.goto(`${web}${path}`, { waitUntil: 'load', timeout: 120_000 });
  await page.locator(ready).first().waitFor({ state: 'visible', timeout: 60_000 });
  const readyMs = Date.now() - t0;
  const res = await page.evaluate(() => {
    const entries = performance.getEntriesByType('resource');
    const nav = performance.getEntriesByType('navigation')[0];
    const js = entries.filter((e) => e.initiatorType === 'script' || e.name.endsWith('.js'));
    return {
      jsBytes: js.reduce((a, e) => a + (e.transferSize || e.encodedBodySize || 0), 0),
      jsFiles: js.length,
      htmlBytes: nav ? nav.transferSize || nav.encodedBodySize : 0,
      allBytes: entries.reduce((a, e) => a + (e.transferSize || e.encodedBodySize || 0), 0) + (nav ? nav.transferSize || 0 : 0),
      load: nav ? Math.round(nav.loadEventEnd) : 0,
    };
  });
  return { path, readyMs, ...res };
}

async function main() {
  const name = basename(build);
  const standalone = join(build, 'web', '.next', 'standalone', name, 'web');
  start(['--import', 'tsx', 'src/main.ts'], join(build, 'api'), {
    CUSTOCK_DEV: '1', CUSTOCK_DB: dbFile, PORT: String(API), CUSTOCK_PUBLIC_WEB_URL: web, CUSTOCK_API_URL: `${web}/api`,
    CUSTOCK_CORS: web, CUSTOCK_STORAGE: 'local', CUSTOCK_TRANSPORT: 'outbox', CUSTOCK_TURNSTILE: 'off', CUSTOCK_SMTP_URL: '', CUSTOCK_MAIL_FROM: '', CUSTOCK_WORKER: '0',
  });
  await wait(`${api}/health`);
  start(['server.js'], standalone, { PORT: String(WEB), HOSTNAME: '127.0.0.1', NODE_ENV: 'production', CUSTOCK_API_URL: api });
  await wait(`${web}/`);

  const ownerEmail = process.env.PERF_OWNER;
  const owner = await login(ownerEmail);
  const me = await (await fetch(`${api}/v1/me/context`, { headers: { Authorization: `Bearer ${owner.accessToken}` } })).json();
  const org = me.orgs[0];
  const eleni = await login('eleni@example.com');
  const lemoni = (await (await fetch(`${api}/v1/me/context`, { headers: { Authorization: `Bearer ${eleni.accessToken}` } })).json()).orgs[0];
  const links = await (await fetch(`${api}/v1/orgs/${lemoni.orgId}/join-links`, { headers: { Authorization: `Bearer ${eleni.accessToken}` } })).json();
  const joinCode = links[0].code;
  const superadmin = await login('super@big.example.com');

  // the api behind the busy screens, warm, median of 5
  const apiTimes = [];
  const shopId = me.orgs[0].shops?.[0]?.shopId ?? (await (await fetch(`${api}/v1/orgs/${org.orgId}/shops`, { headers: { Authorization: `Bearer ${owner.accessToken}` } })).json())[0]?.id;
  const sample = (await (await fetch(`${api}/v1/orgs/${org.orgId}/products?limit=1&q=%CE%BC%CE%AD%CE%BB%CE%B9`, { headers: { Authorization: `Bearer ${owner.accessToken}` } })).json()).items?.[0]?.id;
  const calls = [
    ['products, first page', `/v1/orgs/${org.orgId}/products?limit=100`],
    ['products, search', `/v1/orgs/${org.orgId}/products?limit=100&q=%CE%BC%CE%AD%CE%BB%CE%B9`],
    ['customers, first page', `/v1/orgs/${org.orgId}/customers?limit=100`],
    ['posts, first page', `/v1/orgs/${org.orgId}/posts`],
    ['audit, first page', `/v1/orgs/${org.orgId}/audit`],
    ['one product history', `/v1/orgs/${org.orgId}/movements?limit=20&${sample ? `productId=${sample}` : ''}`],
    ['sales, 14 days', `/v1/orgs/${org.orgId}/reports/sales?days=14`],
    ['sales, 365 days', `/v1/orgs/${org.orgId}/reports/sales?days=365`],
    ['top sellers, 365 days', `/v1/orgs/${org.orgId}/reports/top-sellers?days=365`],
    ['dashboard', `/v1/orgs/${org.orgId}/reports/dashboard`],
    ['offline catalog copy, one shop', `/v1/orgs/${org.orgId}/shops/${shopId}/sync`],
    ['all businesses (super admin)', '/v1/platform/businesses', superadmin],
  ];
  for (const [what, path, who] of calls) {
    const ms = [];
    let bytes = 0;
    let status = 0;
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      const r = await fetch(`${api}${path}`, { headers: { Authorization: `Bearer ${(who ?? owner).accessToken}` } });
      const body = await r.arrayBuffer();
      ms.push(performance.now() - t0);
      bytes = body.byteLength;
      status = r.status;
    }
    ms.sort((a, b) => a - b);
    apiTimes.push({ what, ms: Math.round(ms[2]), kb: Math.round(bytes / 1024), status });
  }

  const browser = await chromium.launch();
  const out = { bundle: bundle(), loads: [], interactions: [], api: apiTimes };
  const pages = [
    ['QR join page', null, `/j/${joinCode}`, 'h1'],
    ['shop page', null, '/s/lemoni', 'h1'],
    ['sign in', null, '/admin/login', 'input[type=email]'],
    ['staff home', 'owner', `/admin/${org.slug}`, 'h1'],
    ['stock list', 'owner', `/admin/${org.slug}/stock`, 'main a[href*="/stock/0"], main tr[data-row], main .row a'],
    ['customers', 'owner', `/admin/${org.slug}/customers`, 'main h1'],
    ['all businesses', 'super', '/admin/platform', 'h1'],
  ];
  const onlyPages = process.env.PERF_ONLY ? process.env.PERF_ONLY.split(',') : null;
  for (const phone of [true, false]) {
    for (const [label, who, path, ready] of pages.filter((x) => !onlyPages || onlyPages.includes(x[0]))) {
      const tokens = who === 'owner' ? owner : who === 'super' ? superadmin : null;
      const ctx = await context(browser, phone, tokens, who === 'owner' ? org.orgId : null);
      const page = await ctx.newPage();
      if (phone) await throttle(page);
      try {
        out.loads.push({ device: phone ? 'phone' : 'desktop', label, ...(await load(page, path, ready)) });
      } catch (e) {
        out.loads.push({ device: phone ? 'phone' : 'desktop', label, path, error: String(e.message).split(String.fromCharCode(10))[0].slice(0, 120), at: page.url() });
        if (process.env.PERF_SHOTS) await page.screenshot({ path: join(process.env.PERF_SHOTS, `${phone ? 'phone' : 'desktop'}-${label.replace(/\W+/g, '-')}.png`) }).catch(() => {});
      }
      console.error(JSON.stringify(out.loads.at(-1)));
      await ctx.close();
    }
  }

  // interactions on the phone, warm (second visit)
  try {
    const ctx = await context(browser, true, owner, org.orgId);
    const page = await ctx.newPage();
    await throttle(page);
    await page.goto(`${web}/admin/${org.slug}/stock`, { waitUntil: 'load' });
    await page.locator('input[type=search]').first().waitFor({ timeout: 60_000 });
    const before = await page.locator('main').innerText();
    const t0 = Date.now();
    await page.locator('input[type=search]').first().fill('μέλι');
    await page.waitForFunction((b) => document.querySelector('main')?.innerText !== b, before, { timeout: 60_000 });
    out.interactions.push({ what: 'stock search "μέλι" until the list changed', ms: Date.now() - t0 });

    await page.goto(`${web}/admin/${org.slug}`, { waitUntil: 'load' });
    await page.locator('h1').first().waitFor();
    const t1 = Date.now();
    await page.goto(`${web}/admin/${org.slug}/customers`, { waitUntil: 'load' });
    await page.locator('main h1').first().waitFor();
    out.interactions.push({ what: 'open customers again (cached files)', ms: Date.now() - t1 });
    await ctx.close();
  } catch (e) {
    out.interactions.push({ what: 'interactions failed', ms: String(e.message).split(String.fromCharCode(10))[0].slice(0, 120) });
  }
  // a long session on the desktop: 60 moves between the busy screens through the app's own links,
  // scrolling each list to load more, then the js heap after a garbage collection
  try {
    const ctx = await context(browser, false, owner, org.orgId);
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Performance.enable');
    const heap = async () => {
      await cdp.send('HeapProfiler.collectGarbage');
      const m = (await cdp.send('Performance.getMetrics')).metrics;
      return Math.round((m.find((x) => x.name === 'JSHeapUsedSize')?.value ?? 0) / 1024 / 1024 * 10) / 10;
    };
    await page.goto(`${web}/admin/${org.slug}`, { waitUntil: 'networkidle' });
    const start = await heap();
    const tabs = ['stock', 'customers', 'posts', ''];
    const t0 = Date.now();
    for (let i = 0; i < 60; i++) {
      const to = `/admin/${org.slug}${tabs[i % tabs.length] ? `/${tabs[i % tabs.length]}` : ''}`;
      await page.locator(`a[href="${to}"]`).first().click();
      await page.waitForURL((u) => u.pathname === to, { timeout: 30_000 });
      await page.waitForLoadState('networkidle');
      await page.mouse.wheel(0, 20_000);
      await page.waitForTimeout(150);
    }
    const end = await heap();
    out.interactions.push({ what: `long session, 60 moves: heap ${start} MB at the start, ${end} MB after`, ms: Date.now() - t0 });
    await ctx.close();
  } catch (e) {
    out.interactions.push({ what: 'long session failed', ms: String(e.message).split(String.fromCharCode(10))[0].slice(0, 120) });
  }
  await browser.close();
  return out;
}

try {
  const out = await main();
  const kb = (n) => `${Math.round(n / 1024)} KB`;
  console.log(`\nbundle: ${out.bundle.count} files, ${kb(out.bundle.totalRaw)} raw, ${kb(out.bundle.totalGz)} gzip; biggest ${out.bundle.top.map((x) => `${kb(x.raw)}/${kb(x.gz)}`).join(', ')}`);
  console.log('\n| device | page | ready ms | js | js files | html |');
  console.log('|---|---|---:|---:|---:|---:|');
  for (const l of out.loads) console.log(l.error ? `| ${l.device} | ${l.label} | error: ${l.error} | | | |` : `| ${l.device} | ${l.label} | ${l.readyMs} | ${kb(l.jsBytes)} | ${l.jsFiles} | ${kb(l.htmlBytes)} |`);
  for (const i of out.interactions) console.log(`- ${i.what}: ${i.ms} ms`);
  console.log('');
  console.log('| api call | ms | KB | status |');
  console.log('|---|---:|---:|---:|');
  for (const a of out.api) console.log(`| ${a.what} | ${a.ms} | ${a.kb} | ${a.status} |`);
  console.log(`\n${JSON.stringify(out)}`);
} finally {
  for (const p of procs) { try { p.kill(); } catch {} }
}
