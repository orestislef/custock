// landscape iphones: the dynamic island and the rounded corners take the left or right edge. every
// frame keeps its content clear of them, portrait and wide screens stay as they were, and a tap
// never leaves a focus ring behind while the keyboard still gets exactly one.
import { L, expect, go, login, open, seed, skip, test } from '../lib.mjs';
import { superAdmin } from '../helpers.mjs';

// an iphone 15 pro in landscape: 852 x 393 points, 59 points of safe area on each side
const LANDSCAPE = { width: 852, height: 393 };
const INSETS = { top: 0, left: 59, bottom: 21, right: 59 };

async function withInsets(page, insets) {
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets });
  } catch {
    skip('this chromium cannot emulate safe areas (Emulation.setSafeAreaInsetsOverride)');
  }
  return cdp;
}

// the browser really applies the emulated insets to env()
async function insetsApplied(page) {
  return page.evaluate(() => {
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;padding-left:env(safe-area-inset-left);visibility:hidden';
    document.body.append(d);
    const v = parseFloat(getComputedStyle(d).paddingLeft);
    d.remove();
    return v;
  });
}

// visible text, controls and images that reach into the side safe areas. content inside a sideways
// scrolling row may pass under the edges while it scrolls, like on ios, so it does not count
async function intoSafeArea(page, left, right) {
  return page.evaluate(({ left, right }) => {
    const maxX = innerWidth - right;
    const scrolls = (el) => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        if (/(auto|scroll)/.test(getComputedStyle(p).overflowX) && p.scrollWidth > p.clientWidth + 1) return true;
      }
      return false;
    };
    const shown = (el) => {
      const s = getComputedStyle(el);
      if (s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) === 0) return false;
      if (el.closest('[aria-hidden="true"], .skip-link, [inert]')) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
    };
    const ownText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    const out = [];
    for (const el of document.querySelectorAll('body *')) {
      const control = el.matches('button, a[href], input, select, textarea, img, [role=button], [role=switch]');
      if (!control && !ownText(el)) continue;
      if (!shown(el) || scrolls(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.left < left - 1 || r.right > maxX + 1) {
        const label = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('alt') || '').trim().replace(/\s+/g, ' ').slice(0, 28);
        out.push(`${el.tagName.toLowerCase()} "${label}" ${Math.round(r.left)}..${Math.round(r.right)}`);
      }
    }
    return [...new Set(out)].slice(0, 12);
  }, { left, right });
}

async function sweep(t, page, paths) {
  const found = [];
  for (const p of paths) {
    t.step(p);
    await go(page, p);
    await page.waitForTimeout(400);
    const bad = await intoSafeArea(page, INSETS.left, INSETS.right);
    if (bad.length) found.push(`${p}: ${bad.join(', ')}`);
  }
  return found;
}

async function landscape(t, tokens) {
  const page = await open(t, { device: 'phone', ios: true, tokens, viewport: LANDSCAPE });
  await withInsets(page, INSETS);
  await go(page, '/admin/login');
  if ((await insetsApplied(page)) < INSETS.left - 1) skip('the emulated safe area did not reach env() in this browser');
  return page;
}

test('safe areas', 'landscape: super admin pages stay clear of the island', async (t) => {
  const sa = await superAdmin();
  const page = await landscape(t, sa.tokens);
  const found = await sweep(t, page, ['/admin/platform', '/admin/platform/audit', '/admin/platform/policies', '/admin/platform/errors', '/admin/platform/server']);
  expect(found.length === 0, 'text or controls under the dynamic island or the corners', 'none', found.join('; '));
});

test('safe areas', 'landscape: business pages stay clear of the island', async (t) => {
  const page = await landscape(t, await login(seed.owner));
  const found = await sweep(t, page, ['/admin', '/admin/stock', '/admin/customers', '/admin/settings', '/admin/audit', '/admin/scan']);
  expect(found.length === 0, 'text or controls under the dynamic island or the corners', 'none', found.join('; '));
});

test('safe areas', 'landscape: customer and sign in pages stay clear of the island', async (t) => {
  const page = await landscape(t, null);
  const found = await sweep(t, page, ['/', '/admin/login', '/admin/forgot', '/s/lemoni', '/s/lemoni/offers', '/s/lemoni/news', '/j/kif7q2', '/p/5200044170102', '/nothing-here']);
  expect(found.length === 0, 'text or controls under the dynamic island or the corners', 'none', found.join('; '));
});

test('safe areas', 'portrait and desktop keep their normal side padding', async (t) => {
  const phone = await open(t, { device: 'phone', ios: true, tokens: await login(seed.owner) });
  await withInsets(phone, { top: 47, left: 0, bottom: 34, right: 0 });
  await go(phone, '/admin');
  const p = await phone.evaluate(() => { const s = getComputedStyle(document.querySelector('main')); return [parseFloat(s.paddingLeft), parseFloat(s.paddingRight)]; });
  expect(p[0] === 16 && p[1] === 16, 'portrait phone main padding', '16px each side', `${p[0]}px / ${p[1]}px`);
  const desk = await open(t, { tokens: await login(seed.owner) });
  await go(desk, '/admin');
  const d = await desk.evaluate(() => { const s = getComputedStyle(document.querySelector('main')); return [parseFloat(s.paddingLeft), parseFloat(s.paddingRight)]; });
  expect(d[0] === 32 && d[1] === 32, 'desktop main padding', '32px each side', `${d[0]}px / ${d[1]}px`);
});

// outlines drawn on the focused control and the few elements around it
async function rings(page) {
  return page.evaluate(() => {
    const out = [];
    for (let el = document.activeElement, i = 0; el && el !== document.body && i < 4; el = el.parentElement, i++) {
      const s = getComputedStyle(el);
      if (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) out.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}`);
    }
    return out;
  });
}

test('focus', 'a tap leaves no ring on selects, switches and buttons', async (t) => {
  const page = await open(t, { device: 'phone', ios: true, tokens: await login(seed.owner) });
  await go(page, '/admin');
  await page.getByRole('button', { name: L('admin.account') }).filter({ visible: true }).first().tap();
  const dialog = page.locator('[role=dialog]').last();
  await dialog.waitFor({ state: 'visible' });
  await page.waitForTimeout(500);
  const found = [];
  const select = dialog.locator('.picker select').first();
  if (await select.count()) {
    await select.tap();
    await page.waitForTimeout(150);
    const r = await rings(page);
    if (r.length) found.push(`language select: ${r.join(', ')}`);
    await page.keyboard.press('Escape').catch(() => {});
  }
  await go(page, '/admin/settings');
  for (const loc of [page.locator('.switch input').first(), page.locator('.seg button').first(), page.locator('main .btn').first()]) {
    if (!(await loc.count()) || !(await loc.isVisible().catch(() => false))) continue;
    await loc.tap().catch(() => {});
    await page.waitForTimeout(150);
    const r = await rings(page);
    if (r.length) found.push(r.join(', '));
  }
  expect(found.length === 0, 'focus rings left behind after a tap', 'none', found.join('; '));
});

test('focus', 'the keyboard gets exactly one ring, tight to the control', async (t) => {
  const page = await open(t, { tokens: await login(seed.owner) });
  await go(page, '/admin/settings');
  const seen = [];
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab');
    const r = await rings(page);
    const tag = await page.evaluate(() => { const a = document.activeElement; return a ? `${a.tagName.toLowerCase()}${a.closest('.picker') ? ' in picker' : ''}` : ''; });
    if (r.length !== 1 && !/^input/.test(tag)) seen.push(`${tag}: ${r.length} rings`);
  }
  expect(seen.length === 0, 'keyboard focus rings', 'exactly one per focused control', [...new Set(seen)].join('; '));
});

// controls a finger has to hit: at least 44 points tall or wide where it matters. links inside a
// sentence and the hidden native input of a switch (the visible track is the target) do not count
async function smallTargets(page) {
  return page.evaluate(() => {
    const out = [];
    const shown = (el) => { const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return s.visibility !== 'hidden' && s.display !== 'none' && r.width > 0 && r.height > 0 && !el.closest('[aria-hidden="true"], .skip-link, [inert]'); };
    for (const el of document.querySelectorAll('button, a[href], [role=button], [role=tab], .picker, .switch')) {
      if (!shown(el)) continue;
      if (el.closest('.picker') && el !== el.closest('.picker')) continue;
      const inline = el.tagName === 'A' && getComputedStyle(el).display === 'inline' && el.parentElement && /^(P|LI|SPAN|SMALL)$/.test(el.parentElement.tagName);
      if (inline) continue;
      const r = el.getBoundingClientRect();
      if (r.height < 43.5 && r.width < 43.5) {
        const label = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24);
        out.push(`${el.tagName.toLowerCase()} "${label}" ${Math.round(r.width)}x${Math.round(r.height)}`);
      } else if (r.height < 28) {
        const label = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24);
        out.push(`${el.tagName.toLowerCase()} "${label}" ${Math.round(r.width)}x${Math.round(r.height)} (too short)`);
      }
    }
    return [...new Set(out)].slice(0, 10);
  });
}

// text cut off without an ellipsis, and a row's label and value overlapping each other
async function clipped(page) {
  return page.evaluate(() => {
    const out = [];
    // labels only screen readers get (1px boxes) and the rolling digits of a number are cut on purpose
    const onPurpose = (el) => {
      if (el.closest('.tally, [aria-hidden="true"]')) return true;
      for (let e = el; e && e !== document.body; e = e.parentElement) { const r = e.getBoundingClientRect(); if (r.width <= 1 || r.height <= 1) return true; }
      return false;
    };
    for (const el of document.querySelectorAll('main *, header *')) {
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden' || onPurpose(el)) continue;
      if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
      if (s.overflowX === 'hidden' && el.scrollWidth > el.clientWidth + 1 && s.textOverflow !== 'ellipsis' && !s.webkitLineClamp?.match(/\d/)) out.push(`cut "${el.textContent.trim().slice(0, 24)}"`);
    }
    for (const row of document.querySelectorAll('.row')) {
      const kids = [...row.children].filter((k) => { const r = k.getBoundingClientRect(); return r.width > 0 && r.height > 0 && k.textContent.trim(); });
      for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) {
        const a = kids[i].getBoundingClientRect(); const b = kids[j].getBoundingClientRect();
        const w = Math.min(a.right, b.right) - Math.max(a.left, b.left); const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (w > 2 && h > 2) out.push(`overlap "${kids[i].textContent.trim().slice(0, 16)}" / "${kids[j].textContent.trim().slice(0, 16)}"`);
      }
    }
    return [...new Set(out)].slice(0, 10);
  });
}

const VISUAL_STAFF = ['/admin', '/admin/stock', '/admin/scan', '/admin/customers', '/admin/posts', '/admin/posts/new', '/admin/reports', '/admin/team', '/admin/team/roles', '/admin/join-links', '/admin/settings', '/admin/audit', '/admin/stock/counts', '/admin/stock/transfers', '/admin/stock/new', '/admin/stock/categories'];
const VISUAL_PUBLIC = ['/', '/admin/login', '/admin/forgot', '/s/lemoni', '/s/lemoni/offers', '/s/lemoni/news', '/s/lemoni/me', '/j/kif7q2', '/p/5200044170102'];
const VISUAL_PLATFORM = ['/admin/platform', '/admin/platform/audit', '/admin/platform/policies', '/admin/platform/errors', '/admin/platform/server', '/admin/platform/api'];

async function visualSweep(t, page, paths) {
  const found = [];
  for (const p of paths) {
    t.step(p);
    await go(page, p);
    await page.waitForTimeout(400);
    const small = await smallTargets(page);
    const cut = await clipped(page);
    if (small.length) found.push(`${p} small: ${small.join(', ')}`);
    if (cut.length) found.push(`${p}: ${cut.join(', ')}`);
  }
  return found;
}

test('visual', 'phone: staff pages have finger sized controls and no cut or colliding text', async (t) => {
  const page = await open(t, { device: 'phone', ios: true, tokens: await login(seed.owner) });
  const found = await visualSweep(t, page, VISUAL_STAFF);
  expect(found.length === 0, 'small targets or cut text', 'none', found.join('; '));
});

test('visual', 'phone: customer and super admin pages too', async (t) => {
  const pub = await open(t, { device: 'phone', ios: true });
  const found = await visualSweep(t, pub, VISUAL_PUBLIC);
  const sa = await superAdmin();
  const plat = await open(t, { device: 'phone', ios: true, tokens: sa.tokens });
  found.push(...(await visualSweep(t, plat, VISUAL_PLATFORM)));
  expect(found.length === 0, 'small targets or cut text', 'none', found.join('; '));
});

test('visual', 'iphone safari engine: the same checks on staff and customer pages', async (t) => {
  const page = await open(t, { device: 'phone', ios: true, engine: 'webkit', tokens: await login(seed.owner) });
  const found = await visualSweep(t, page, VISUAL_STAFF.slice(0, 8));
  const pub = await open(t, { device: 'phone', ios: true, engine: 'webkit' });
  found.push(...(await visualSweep(t, pub, ['/s/lemoni', '/s/lemoni/offers', '/admin/login'])));
  expect(found.length === 0, 'small targets or cut text in webkit', 'none', found.join('; '));
});
