import { expect, go, lemoni, login, ok, open, seed, test } from '../lib.mjs';
import { superAdmin } from '../helpers.mjs';

// every limit and option shows the control that fits its type, on the three pages that set them:
// the platform defaults, one business as the super admin sees it, and the owner's settings. a row
// with a name but no control (only a switch next to "Now ...") is the bug this guards against.

// keys whose row on the page has no control next to its name
async function rowsWithoutControl(page) {
  return page.evaluate(() => {
    const out = [];
    for (const title of document.querySelectorAll('[data-policy]')) {
      const row = title.closest('.row');
      if (!row || !row.querySelector('[data-policy-control]')) out.push(title.getAttribute('data-policy'));
    }
    return out;
  });
}

const keysOnPage = (page) => page.evaluate(() => [...new Set([...document.querySelectorAll('[data-policy]')].map((n) => n.getAttribute('data-policy')))]);

for (const device of ['desktop', 'phone']) {
  test('policies', `platform defaults: every limit has its control (${device})`, async (t) => {
    const sa = await superAdmin();
    const api = await ok('/v1/platform/policies', { token: sa.tokens });
    const page = await open(t, { device, tokens: sa.tokens });
    await go(page, '/admin/platform/policies');
    await page.locator('[data-policy]').first().waitFor({ timeout: 10_000 });
    const missing = await rowsWithoutControl(page);
    expect(missing.length === 0, 'platform rows without a control', 'none', missing.join(', '));
    const shown = await keysOnPage(page);
    expect(shown.length === api.entries.length, 'platform settings on the page', String(api.entries.length), String(shown.length));
  });

  test('policies', `one business: a value control and an owner switch per setting (${device})`, async (t) => {
    const sa = await superAdmin();
    const l = await lemoni();
    const api = await ok(`/v1/platform/businesses/${l.orgId}/policies`, { token: sa.tokens });
    const page = await open(t, { device, tokens: sa.tokens });
    await go(page, `/admin/platform/${l.orgId}`);
    await page.locator('[data-policy-block]').first().waitFor({ timeout: 10_000 });
    const blocks = await page.evaluate(() => [...document.querySelectorAll('[data-policy-block]')].map((b) => ({
      key: b.getAttribute('data-policy-block'),
      controls: b.querySelectorAll('[data-policy-control]').length,
      values: b.querySelectorAll('[data-policy]').length,
      delegate: b.querySelectorAll('[data-policy-delegate]').length,
    })));
    expect(blocks.length === api.controls.length, 'settings on the business page', String(api.controls.length), String(blocks.length));
    const bad = blocks.filter((b) => b.controls !== 1 || b.values !== 1 || b.delegate !== 1).map((b) => `${b.key} (controls ${b.controls}, owner switch ${b.delegate})`);
    expect(bad.length === 0, 'settings without exactly one value control and one owner switch', 'none', bad.join(', '));
  });

  test('policies', `owner settings: every limit the owner may change has its control (${device})`, async (t) => {
    const l = await lemoni();
    const owner = await login(seed.owner);
    const api = await ok(`/v1/orgs/${l.orgId}/policies`, { token: owner });
    const page = await open(t, { device, tokens: owner });
    await go(page, '/admin/settings');
    await page.locator('[data-policy]').first().waitFor({ timeout: 10_000 });
    const shown = new Set(await keysOnPage(page));
    const editable = api.entries.filter((e) => e.editable).map((e) => e.key);
    const missing = await page.evaluate((keys) => keys.filter((k) => {
      const title = document.querySelector(`[data-policy="${k}"]`);
      return title && !title.closest('.row')?.querySelector('[data-policy-control]');
    }), editable);
    expect(missing.length === 0, 'editable rows without a control', 'none', missing.join(', '));
    expect(shown.size > 0, 'limits on the owner settings page', 'some', '0');
  });
}
