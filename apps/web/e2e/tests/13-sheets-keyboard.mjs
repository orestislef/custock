// sheets and the on screen keyboard on an iphone (webkit, touch, iphone user agent).
//
// what can be checked here and what cannot: playwright's webkit has no on screen keyboard, so the
// keyboard is played by a stand in visualViewport (installed before the app starts) that shrinks
// the visible area the way ios does, optionally panned by offsetTop. that checks the app's side:
// where the sheet goes, that its buttons and the focused field stay visible, that the page behind
// stays pinned and never scrolls, and that the tab bars step aside. what only a real iphone shows:
// the keyboard's own slide timing, safari's real pan of the visual viewport, rubber banding in
// standalone mode, and touch scroll chaining at the very end of a scroll area.

import { L, expect, go, login, open, seed, test } from '../lib.mjs';
import { openSheet, superAdmin } from '../helpers.mjs';

const KEYBOARD = 300;

// a stand in for window.visualViewport that the test can shrink like the ios keyboard does
function fakeViewport() {
  const real = window.visualViewport;
  const fake = new EventTarget();
  let cover = 0;
  let pan = 0;
  Object.defineProperties(fake, {
    height: { get: () => document.documentElement.clientHeight - cover },
    width: { get: () => document.documentElement.clientWidth },
    offsetTop: { get: () => pan },
    offsetLeft: { get: () => 0 },
    pageTop: { get: () => window.scrollY + pan },
    pageLeft: { get: () => 0 },
    scale: { get: () => (real ? real.scale : 1) },
  });
  Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => fake });
  // keyboard px covered at the bottom, and how far safari panned the visible area down
  window.__keyboard = (px, offset = 0) => {
    cover = px + offset;
    pan = offset;
    fake.dispatchEvent(new Event('resize'));
    fake.dispatchEvent(new Event('scroll'));
  };
}

async function iphone(t, tokens) {
  const page = await open(t, { device: 'phone', ios: true, engine: 'webkit', tokens });
  await page.addInitScript(fakeViewport);
  return page;
}

async function keyboard(page, px, offset = 0) {
  await page.evaluate(([a, b]) => window.__keyboard(a, b), [px, offset]);
  await page.waitForTimeout(400);
}

// where the open sheet, its buttons and the focused field are, against the visible area
async function layout(page) {
  return page.evaluate(() => {
    const sheet = [...document.querySelectorAll('[role=dialog]')].pop();
    const vv = window.visualViewport;
    const visibleTop = vv.offsetTop;
    const visibleBottom = vv.offsetTop + vv.height;
    const r = sheet.getBoundingClientRect();
    const buttons = [...sheet.querySelectorAll('[data-sheet-footer] button')].map((b) => b.getBoundingClientRect());
    const f = document.activeElement;
    const fr = f && sheet.contains(f) && f.matches('input, textarea, select') ? f.getBoundingClientRect() : null;
    const footer = sheet.querySelector('[data-sheet-footer]');
    return {
      visibleTop, visibleBottom,
      sheetTop: r.top, sheetBottom: r.bottom,
      buttonsBottom: buttons.length ? Math.max(...buttons.map((b) => b.bottom)) : null,
      buttonsTop: buttons.length ? Math.min(...buttons.map((b) => b.top)) : null,
      focused: fr ? { top: fr.top, bottom: fr.bottom } : null,
      footerTop: footer ? footer.getBoundingClientRect().top : null,
      activeTag: f ? f.tagName.toLowerCase() + (f.getAttribute('role') ? `[${f.getAttribute('role')}]` : '') : null,
      scrollY: window.scrollY,
      bodyTop: document.body.style.top,
      bodyPosition: document.body.style.position,
      kb: sheet.hasAttribute('data-kb'),
    };
  });
}

// scrolls the open sheet's own area to its end in steps, and reads the css that keeps a scroll
// from reaching the page
async function scrollInside(page) {
  return page.evaluate(async () => {
    const sheet = [...document.querySelectorAll('[role=dialog]')].pop();
    for (let i = 0; i < 8; i++) { sheet.scrollTop += 200; await new Promise((r) => requestAnimationFrame(r)); }
    const cs = getComputedStyle(sheet);
    // playwright's windows webkit build lacks overscroll-behavior (safari has it since 16): then it is not checked here
    const supported = CSS.supports('overscroll-behavior', 'contain');
    return { overscroll: supported ? cs.getPropertyValue('overscroll-behavior-y') : 'contain', scrim: getComputedStyle(document.querySelector('.scrim')).touchAction, scrollTop: sheet.scrollTop };
  });
}

// opens New business with a script click, so the page keeps its scroll position (playwright would
// scroll the button into view first, which hides what this test looks for)
async function openNewBusiness(page) {
  const name = L('platform.newBusiness');
  await page.evaluate((n) => [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') === n || b.textContent?.trim().includes(n)) && b.getClientRects().length && getComputedStyle(b).visibility !== 'hidden')?.click(), name);
  await page.getByRole('dialog').last().waitFor({ state: 'visible' });
  await page.waitForTimeout(500);
  return page.getByRole('dialog').last();
}

function inView(l, what) {
  expect(l.buttonsBottom != null, `${what}: buttons`, 'present', 'none');
  expect(l.buttonsBottom <= l.visibleBottom + 1, `${what}: buttons above the keyboard`, `bottom <= ${Math.round(l.visibleBottom)}`, String(Math.round(l.buttonsBottom)));
  expect(l.sheetTop >= l.visibleTop - 1, `${what}: sheet top on screen`, `>= ${Math.round(l.visibleTop)}`, String(Math.round(l.sheetTop)));
  if (l.focused) {
    expect(l.focused.top >= l.visibleTop - 1 && l.focused.bottom <= (l.footerTop ?? l.visibleBottom) + 1, `${what}: focused field visible above the buttons`,
      `${Math.round(l.visibleTop)}..${Math.round(l.footerTop ?? l.visibleBottom)}`, `${Math.round(l.focused.top)}..${Math.round(l.focused.bottom)}`);
  }
}

test('sheets', 'iphone: New business opens without the keyboard and the page behind never scrolls', async (t) => {
  const sa = await superAdmin();
  const page = await iphone(t, sa.tokens);
  await go(page, '/admin/platform');
  await page.evaluate(() => window.scrollTo(0, 400));
  await page.waitForTimeout(200);
  t.step('open New business');
  await openNewBusiness(page);
  const before = await page.evaluate(() => window.scrollY);
  expect(before > 0, 'page scrolled down behind the sheet for the test', '> 0', String(before));
  const opened = await layout(page);
  expect(opened.activeTag === 'div[dialog]', 'focus after opening on a touch screen', 'the dialog itself (no keyboard)', String(opened.activeTag));
  t.step('scroll inside the sheet to its end');
  // mobile webkit in playwright has no swipe or wheel: the sheet's own area is scrolled, and the
  // css that stops a scroll from chaining to the page is checked instead
  const css = await scrollInside(page);
  expect(css.overscroll === 'contain', 'sheet scroll does not chain to the page', 'overscroll-behavior contain', css.overscroll);
  expect(css.scrim === 'none', 'a drag on the backdrop does not scroll the page', 'touch-action none', css.scrim);
  const during = await page.evaluate(() => window.scrollY);
  expect(during === before, 'page scroll while scrolling inside the sheet', String(before), String(during));
  t.step('close');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => window.scrollY);
  expect(after === before, 'page scroll after closing the sheet', String(before), String(after));
});

test('sheets', 'iphone: New business with the keyboard up keeps its buttons and fields in view, Next included', async (t) => {
  const sa = await superAdmin();
  const page = await iphone(t, sa.tokens);
  await go(page, '/admin/platform');
  await page.evaluate(() => window.scrollTo(0, 300));
  await page.waitForTimeout(200);
  const sheet = await openNewBusiness(page);
  const before = await page.evaluate(() => window.scrollY);
  expect(before > 0, 'page scrolled down behind the sheet for the test', '> 0', String(before));
  t.step('tap the first field, the keyboard comes up');
  await sheet.locator('input').first().tap();
  await page.waitForTimeout(200);
  const tapped = await page.evaluate(() => ({ y: window.scrollY, top: document.body.style.top, pos: document.body.style.position }));
  expect(tapped.pos === 'fixed' ? tapped.top === `-${before}px` : tapped.y === before, 'page behind did not move at the tap', `at ${before}`, JSON.stringify(tapped));
  await keyboard(page, KEYBOARD);
  let l = await layout(page);
  expect(l.kb, 'sheet knows the keyboard is up', 'data-kb', 'missing');
  expect(l.bodyPosition === 'fixed', 'page behind pinned while typing', 'position fixed', l.bodyPosition || 'none');
  inView(l, 'first field');
  t.step('Next through every field');
  const fields = await sheet.locator('input:not([type=hidden]):not([type=file])').count();
  for (let i = 1; i < fields; i++) {
    await page.keyboard.press('Enter');
    await page.waitForTimeout(450);
    l = await layout(page);
    inView(l, `field ${i + 1} after Next`);
  }
  t.step('safari pans the visible area down a little');
  await keyboard(page, KEYBOARD, 60);
  inView(await layout(page), 'with the visible area panned');
  t.step('scroll inside the sheet, and safari trying to scroll the page, with the keyboard up');
  await scrollInside(page);
  await page.evaluate(() => window.scrollTo(0, 250));
  await page.waitForTimeout(300);
  l = await layout(page);
  expect(l.scrollY === 0 && l.bodyTop === `-${before}px`, 'page behind stays at its place while pinned', `scrollY 0, body top -${before}px`, `scrollY ${l.scrollY}, body top ${l.bodyTop}`);
  t.step('keyboard down');
  await keyboard(page, 0);
  l = await layout(page);
  expect(!l.kb && l.bodyPosition !== 'fixed', 'back to normal with the keyboard down', 'no data-kb, body not pinned', `kb ${l.kb}, body ${l.bodyPosition}`);
  expect(l.scrollY === before, 'page scroll restored when the keyboard goes down', String(before), String(l.scrollY));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => window.scrollY);
  expect(after === before, 'page scroll after closing', String(before), String(after));
});

test('sheets', 'iphone: every sheet with a field keeps its buttons above the keyboard', async (t) => {
  const sa = await superAdmin();
  const owner = await login(seed.owner);
  const found = [];
  const check = async (page, label, opener) => {
    t.step(label);
    const btn = opener(page).filter({ visible: true }).first();
    if (!(await btn.isVisible().catch(() => false))) { found.push(`${label}: no button to open it`); return; }
    const sheet = await openSheet(page, btn).catch(() => null);
    if (!sheet) { found.push(`${label}: did not open`); return; }
    const field = sheet.locator('input:not([type=hidden]):not([type=file]):not([type=checkbox]), textarea').first();
    if (await field.isVisible().catch(() => false)) await field.tap();
    await keyboard(page, KEYBOARD);
    try { inView(await layout(page), label); } catch (e) { found.push(`${label}: ${e.what ?? e.message} (${e.actual ?? ''})`); }
    await keyboard(page, 0);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(350);
  };
  const p1 = await iphone(t, sa.tokens);
  await go(p1, '/admin/platform');
  await check(p1, 'Invite super admin', (p) => p.getByRole('button', { name: L('platform.admins.invite') }));
  const p2 = await iphone(t, owner);
  const sheets = [
    ['/admin/team', 'Team invite', (p) => p.getByRole('button', { name: L('team.invite') })],
    ['/admin/stock/categories', 'New category', (p) => p.getByRole('button', { name: L('categories.new') })],
    ['/admin/join-links', 'New QR code', (p) => p.getByRole('button', { name: L('links.new') })],
    ['/admin/stock/transfers', 'New transfer', (p) => p.getByRole('button', { name: L('transfers.new') })],
    ['/admin/stock/counts', 'Start a count', (p) => p.getByRole('button', { name: L('counts.start') })],
  ];
  for (const [path, label, opener] of sheets) {
    await go(p2, path);
    await check(p2, label, opener);
  }
  // the date and time picker opens from New post once Later is chosen
  await go(p2, '/admin/posts/new');
  await p2.getByRole('radio', { name: L('composer.later') }).or(p2.getByRole('button', { name: L('composer.later') })).filter({ visible: true }).first().tap().catch(() => {});
  await check(p2, 'Date and time picker', (p) => p.locator('.dtp-field'));
  expect(found.length === 0, 'sheets with the keyboard up', 'buttons and fields in view everywhere', found.join('; '));
});

test('sheets', 'iphone: the tab bar steps aside while typing on a page', async (t) => {
  const page = await iphone(t, await login(seed.owner));
  await go(page, '/admin/stock');
  const search = page.getByRole('searchbox').or(page.locator('.search input')).first();
  await search.tap();
  await keyboard(page, KEYBOARD);
  const hidden = await page.evaluate(() => {
    const bar = document.querySelector('[data-tabbar]');
    return bar ? getComputedStyle(bar).visibility : 'no bar';
  });
  expect(hidden === 'hidden', 'tab bar while the keyboard is up', 'hidden', hidden);
  await keyboard(page, 0);
  const shown = await page.evaluate(() => getComputedStyle(document.querySelector('[data-tabbar]')).visibility);
  expect(shown === 'visible', 'tab bar after the keyboard went down', 'visible', shown);
});
