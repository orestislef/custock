// posts, the approval flow and the staff alerts: who gets what, by role and shop
import { see, L, api, eq, expect, go, lemoni, login, ok, one, open, q, seed, sleep, test, text, WEB } from '../lib.mjs';
import { waitPath } from '../helpers.mjs';

const ids = {};
async function people() {
  if (ids.eleni) return ids;
  for (const [k, e] of Object.entries({ eleni: seed.owner, nikos: seed.admin, maria: seed.managerKif, giorgos: seed.managerGly, dimitris: seed.staffKif, katerina: seed.staffMar, sofia: seed.viewer })) {
    ids[k] = one('SELECT id FROM users WHERE email = @e', { e }).id;
  }
  return ids;
}
const nameOf = (id) => Object.entries(ids).find(([, v]) => v === id)?.[0] ?? id;
// staff alerts written to the outbox since a moment, by type
function alerts(type, since) {
  return q("SELECT user_id FROM dev_outbox WHERE channel = 'push' AND created_at >= @s AND json_extract(payload, '$.type') = @t", { s: since, t: type }).map((r) => nameOf(r.user_id)).sort();
}
async function draft(token, title, scope, extra = {}) {
  const l = await lemoni();
  return ok(`/v1/orgs/${l.orgId}/posts`, { method: 'POST', token, body: {
    kind: 'news', defaultLocale: 'en', translations: { en: { title, body: 'E2E body text' } }, channels: ['feed', 'push', 'email'],
    audience: { scopes: [scope ?? { scopeType: 'shop', scopeId: l.kifisia }] }, ...extra,
  } });
}
const status = (id) => one('SELECT status FROM posts WHERE id = @id', { id })?.status;
async function setApproval(on) {
  const l = await lemoni();
  await ok(`/v1/orgs/${l.orgId}`, { method: 'PATCH', token: await login(seed.owner), body: { postsNeedApproval: on } });
}

test('posts', 'a draft shows under Draft and is not sent', async (t) => {
  const owner = await login(seed.owner);
  const p = await draft(owner, 'E2E draft only');
  eq(status(p.id), 'draft', 'status of a new post');
  const page = await open(t, { tokens: owner });
  await go(page, '/admin/posts?status=draft');
  await see(page, 'E2E draft only', 10_000);
  eq(q('SELECT id FROM deliveries WHERE post_id = @p', { p: p.id }).length, 0, 'deliveries of a draft');
});

test('posts', 'audience preview matches the deliveries of a published post', async () => {
  const l = await lemoni();
  const owner = await login(seed.owner);
  const p = await draft(owner, 'E2E owner publishes');
  const prev = await ok(`/v1/orgs/${l.orgId}/posts/audience-preview`, { method: 'POST', token: owner, body: { audience: { scopes: [{ scopeType: 'shop', scopeId: l.kifisia }] }, channels: ['feed', 'push', 'email'] } });
  await ok(`/v1/orgs/${l.orgId}/posts/${p.id}/publish`, { method: 'POST', token: owner });
  await api('/v1/dev/run-jobs', { method: 'POST', token: owner });
  await sleep(1000);
  expect(['sent', 'sending'].includes(status(p.id)), 'status after the owner publishes', 'sent', status(p.id));
  const del = q('SELECT channel, status, customer_id FROM deliveries WHERE post_id = @p', { p: p.id });
  const people = new Set(del.map((d) => d.customer_id)).size;
  const total = prev.total;
  expect(total != null, 'audience preview total', 'a number', JSON.stringify(prev).slice(0, 160));
  eq(people, total, 'people with deliveries vs the preview');
  const emails = del.filter((d) => d.channel === 'email' && d.status !== 'skipped').length;
  eq(emails, prev.email.count, 'email deliveries vs the preview');
  const pushes = del.filter((d) => d.channel === 'push' && d.status !== 'skipped').length;
  eq(pushes, prev.push.count, 'push deliveries vs the preview');
});

test('posts', 'approval: a manager submits, owner and admin get the alert, the writer does not', async (t) => {
  await people();
  await setApproval(true);
  const maria = await login(seed.managerKif);
  const p = await draft(maria, 'E2E needs approval');
  const since = Date.now();
  const l = await lemoni();
  await ok(`/v1/orgs/${l.orgId}/posts/${p.id}/publish`, { method: 'POST', token: maria });
  eq(status(p.id), 'pending_approval', 'status after a manager submits with approval on');
  ids.pending = p.id;
  const got = alerts('approvalNeeded', since);
  eq(got, ['eleni', 'nikos'], 'people alerted to approve');
  t.step('owner Home shows it under Needs you');
  const page = await open(t, { tokens: await login(seed.owner) });
  await go(page, '/admin');
  const body = await text(page);
  expect(/approv/i.test(body), 'Needs you on the owner Home', 'a posts to approve line', body.slice(0, 200));
  const dash = await ok(`/v1/orgs/${l.orgId}/reports/dashboard`, { token: await login(seed.owner) });
  expect(dash.pendingApprovals >= 1, 'pending approvals on the dashboard', '>= 1', dash.pendingApprovals);
  const mariaHome = await ok(`/v1/orgs/${l.orgId}/reports/dashboard`, { token: maria });
  expect(!mariaHome.pendingApprovals, 'pending approvals for the writer', '0', mariaHome.pendingApprovals);
});

test('posts', 'approval: the alert link opens the post, approving sends it, the writer hears back', async (t) => {
  const l = await lemoni();
  const since = Date.now();
  const alert = one("SELECT payload FROM dev_outbox WHERE channel = 'push' AND json_extract(payload, '$.type') = 'approvalNeeded' AND json_extract(payload, '$.postId') = @p", { p: ids.pending });
  const payload = JSON.parse(alert.payload);
  const url = payload.url ?? `/admin/posts/${ids.pending}`;
  const owner = await login(seed.owner);
  const page = await open(t, { tokens: owner });
  await page.goto(url.startsWith('http') ? url : `${WEB}${url}`, { waitUntil: 'networkidle' });
  await waitPath(page, new RegExp(`/admin/posts/${ids.pending}`));
  await see(page, 'E2E needs approval', 10_000);
  await ok(`/v1/orgs/${l.orgId}/posts/${ids.pending}/approve`, { method: 'POST', token: owner });
  await api('/v1/dev/run-jobs', { method: 'POST', token: owner });
  await sleep(1000);
  expect(['sent', 'sending'].includes(status(ids.pending)), 'status after approval', 'sent', status(ids.pending));
  const del = q('SELECT channel FROM deliveries WHERE post_id = @p', { p: ids.pending }).map((d) => d.channel);
  expect(del.includes('push') && del.includes('email'), 'deliveries per channel', 'push and email', [...new Set(del)].join(','));
  const writer = q("SELECT 1 FROM dev_outbox WHERE user_id = @u AND created_at >= @s AND channel = 'push'", { u: ids.maria, s: since }).length;
  expect(writer >= 1, 'the writer told the post went out', 'a push to maria', 'nothing');
});

test('posts', 'approval: push deliveries respect quiet hours', async () => {
  const org = one("SELECT quiet_hours, timezone FROM organizations WHERE slug = 'lemoni'");
  const [from, to] = (org.quiet_hours ?? '22:00-09:00').split('-');
  const hm = new Intl.DateTimeFormat('en-GB', { timeZone: org.timezone, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
  const inQuiet = from > to ? hm >= from || hm < to : hm >= from && hm < to;
  const push = q("SELECT send_after, status FROM deliveries WHERE post_id = @p AND channel = 'push'", { p: ids.pending });
  const held = push.filter((d) => d.send_after && d.send_after > Date.now()).length;
  if (inQuiet) expect(held === push.length, 'push during quiet hours', 'all held', `${held} of ${push.length} held`);
  else expect(held === 0, 'push outside quiet hours', 'none held', `${held} held at ${hm}`);
});

test('posts', 'approval: the writer sees "Your post went out" on Home', async (t) => {
  const page = await open(t, { tokens: await login(seed.managerKif) });
  await go(page, '/admin');
  await see(page, L('dash.postWent'), 10_000);
  await see(page, 'E2E needs approval', 5000);
});

test('posts', 'approval: a shop scoped approver gets the alert too', async () => {
  await people();
  const l = await lemoni();
  const owner = await login(seed.owner);
  const roles = await ok(`/v1/orgs/${l.orgId}/roles`, { token: owner });
  const admin = roles.find((r) => r.templateKey === 'admin');
  const members = await ok(`/v1/orgs/${l.orgId}/members`, { token: owner });
  const g = members.find((m) => m.email === seed.managerGly);
  if (!g.assignments.some((a) => a.roleId === admin.id && a.scopeId === l.kifisia)) {
    await ok(`/v1/orgs/${l.orgId}/members/${g.membershipId}/assignments`, { method: 'POST', token: owner, body: { roleId: admin.id, scopeType: 'shop', scopeId: l.kifisia } });
  }
  const maria = await login(seed.managerKif);
  const p = await draft(maria, 'E2E shop approver');
  const since = Date.now();
  await ok(`/v1/orgs/${l.orgId}/posts/${p.id}/publish`, { method: 'POST', token: maria });
  eq(status(p.id), 'pending_approval', 'waiting for approval');
  const got = alerts('approvalNeeded', since);
  expect(got.includes('giorgos'), 'admin of Kifisia only', 'alerted', got.join(','));
  expect(!got.includes('maria') && !got.includes('dimitris') && !got.includes('katerina'), 'writer and staff', 'not alerted', got.join(','));
  try {
    const r = await api(`/v1/orgs/${l.orgId}/posts/${p.id}/approve`, { method: 'POST', token: await login(seed.managerGly, undefined, { fresh: true }) });
    expect(r.status < 300, 'the shop scoped approver approves', '2xx', r.status);
  } finally {
    // later tests count on giorgos having Glyfada only
    const again = (await ok(`/v1/orgs/${l.orgId}/members`, { token: owner })).find((m) => m.email === seed.managerGly);
    for (const a of again.assignments.filter((x) => x.roleId === admin.id && x.scopeId === l.kifisia)) {
      await ok(`/v1/orgs/${l.orgId}/members/${again.membershipId}/assignments/${a.id}`, { method: 'DELETE', token: owner });
    }
    await login(seed.managerGly, undefined, { fresh: true });
  }
});

test('posts', 'a cancelled post sends nothing to customers, the writer hears it stopped', async () => {
  await people();
  const l = await lemoni();
  const maria = await login(seed.managerKif);
  const p = await draft(maria, 'E2E cancel me');
  await ok(`/v1/orgs/${l.orgId}/posts/${p.id}/publish`, { method: 'POST', token: maria });
  eq(status(p.id), 'pending_approval', 'waiting first');
  const since = Date.now();
  await ok(`/v1/orgs/${l.orgId}/posts/${p.id}/cancel`, { method: 'POST', token: await login(seed.owner) });
  const told = q("SELECT 1 FROM dev_outbox WHERE user_id = @u AND created_at >= @s AND channel = 'push'", { u: ids.maria, s: since }).length;
  expect(told >= 1, 'the writer told it was stopped', 'a push to maria', 'nothing');
  await api('/v1/dev/run-jobs', { method: 'POST', token: await login(seed.owner) });
  eq(status(p.id), 'cancelled', 'status after cancel');
  eq(q('SELECT id FROM deliveries WHERE post_id = @p', { p: p.id }).length, 0, 'deliveries of a cancelled post');
});

test('posts', 'with approval off a manager publishes directly', async () => {
  const l = await lemoni();
  await setApproval(false);
  try {
    const maria = await login(seed.managerKif, undefined, { fresh: true });
    const p = await draft(maria, 'E2E manager direct');
    await ok(`/v1/orgs/${l.orgId}/posts/${p.id}/publish`, { method: 'POST', token: maria });
    expect(['sent', 'sending', 'scheduled'].includes(status(p.id)), 'status when approval is off', 'sent', status(p.id));
  } finally {
    await setApproval(true);
  }
});

test('posts', 'a scheduled post is sent by the worker', async () => {
  const l = await lemoni();
  const owner = await login(seed.owner);
  const p = await draft(owner, 'E2E scheduled', null, { scheduledAt: Date.now() + 3000 });
  await ok(`/v1/orgs/${l.orgId}/posts/${p.id}/publish`, { method: 'POST', token: owner });
  eq(status(p.id), 'scheduled', 'status before its time');
  await sleep(4500);
  for (let i = 0; i < 10 && !['sent', 'sending'].includes(status(p.id)); i++) await sleep(1000);
  expect(['sent', 'sending'].includes(status(p.id)), 'status after its time (worker)', 'sent', status(p.id));
});

test('posts', 'an offer email shows the lowest price of the last 30 days', async () => {
  const l = await lemoni();
  const owner = await login(seed.owner);
  const v = one("SELECT pv.id, pv.price_minor AS price FROM product_variants pv JOIN products p ON p.id = pv.product_id JOIN price_history h ON h.variant_id = pv.id WHERE p.org_id = @o GROUP BY pv.id HAVING COUNT(*) >= 1 LIMIT 1", { o: l.orgId });
  expect(!!v, 'a product with price history', 'one', 'none');
  const since = Date.now();
  const p = await draft(owner, 'E2E offer week', { scopeType: 'org', scopeId: l.orgId }, { kind: 'offer', products: [{ variantId: v.id, offerPriceMinor: Math.max(1, Math.round(v.price * 0.8)) }], validUntil: Date.now() + 7 * 86400000 });
  await ok(`/v1/orgs/${l.orgId}/posts/${p.id}/publish`, { method: 'POST', token: owner });
  await api('/v1/dev/run-jobs', { method: 'POST', token: owner });
  await sleep(1500);
  const mail = one("SELECT html, body FROM dev_outbox WHERE channel = 'email' AND created_at >= @s AND (body LIKE '%E2E offer week%' OR title LIKE '%E2E offer week%') LIMIT 1", { s: since });
  expect(!!mail, 'offer email in the outbox', 'one', 'none');
  // the email is in the reader's language
  const phrases = ['en', 'el', 'ru'].map((lc) => L('server:email.layout.lowest30', { price: '' }, lc).trim().replace(/:$/, ''));
  const all = `${mail.html}\n${mail.body}`;
  expect(phrases.some((ph) => all.includes(ph)), 'offer email', 'shows the lowest 30 day price', 'not shown');
});

test('alerts', 'low stock reaches only people with that shop who manage its stock', async () => {
  await people();
  const l = await lemoni();
  const owner = await login(seed.owner);
  const p = await ok(`/v1/orgs/${l.orgId}/products`, { method: 'POST', token: owner, body: { name: 'E2E Low thing', priceMinor: 300 } });
  const v = p.variants[0].id;
  await ok(`/v1/orgs/${l.orgId}/movements`, { method: 'POST', token: owner, body: { movements: [{ id: crypto.randomUUID(), shopId: l.kifisia, variantId: v, qtyDelta: 10, kind: 'receive', occurredAt: Date.now() }] } });
  await ok(`/v1/orgs/${l.orgId}/shops/${l.kifisia}/variants/${v}/settings`, { method: 'PUT', token: owner, body: { reorderPoint: 5 } });
  const since = Date.now();
  await ok(`/v1/orgs/${l.orgId}/movements`, { method: 'POST', token: await login(seed.staffKif), body: { movements: [{ id: crypto.randomUUID(), shopId: l.kifisia, variantId: v, qtyDelta: -6, kind: 'sale', occurredAt: Date.now() }] } });
  const got = alerts('lowStock', since);
  expect(got.includes('maria'), 'Kifisia manager alerted', 'maria', got.join(','));
  const wrong = got.filter((n) => ['giorgos', 'katerina', 'dimitris', 'sofia'].includes(n));
  expect(wrong.length === 0, 'people without Kifisia or without stock settings', 'not alerted', wrong.join(','));
});

test('alerts', 'transfer on the way reaches only the receiving shop', async () => {
  await people();
  const l = await lemoni();
  const owner = await login(seed.owner);
  const v = one('SELECT variant_id AS v FROM stock_levels WHERE shop_id = @s AND on_hand > 3 LIMIT 1', { s: l.kifisia }).v;
  const tr = await ok(`/v1/orgs/${l.orgId}/transfers`, { method: 'POST', token: owner, body: { fromShopId: l.kifisia, toShopId: l.marousi, lines: [{ variantId: v, qty: 1 }] } });
  const since = Date.now();
  await ok(`/v1/orgs/${l.orgId}/transfers/${tr.id}/send`, { method: 'POST', token: await login(seed.managerKif) });
  const got = alerts('transferSent', since);
  expect(got.includes('katerina'), 'Marousi staff alerted', 'katerina', got.join(','));
  const wrong = got.filter((n) => ['maria', 'dimitris', 'giorgos', 'sofia'].includes(n));
  expect(wrong.length === 0, 'people without Marousi', 'not alerted', wrong.join(','));
});

test('alerts', 'a count waiting for review reaches only approvers of that shop', async () => {
  await people();
  const l = await lemoni();
  const kat = await login(seed.staffMar);
  const count = await ok(`/v1/orgs/${l.orgId}/shops/${l.marousi}/counts`, { method: 'POST', token: kat, body: { kind: 'partial' } });
  const v = one('SELECT variant_id AS v FROM stock_levels WHERE shop_id = @s LIMIT 1', { s: l.marousi }).v;
  await ok(`/v1/orgs/${l.orgId}/counts/${count.id}/lines/${v}`, { method: 'PUT', token: kat, body: { countedQty: 1, mode: 'set' } });
  const since = Date.now();
  const sub = await api(`/v1/orgs/${l.orgId}/counts/${count.id}/submit`, { method: 'POST', token: kat });
  expect(sub.status < 300, 'staff sends the count for review', '2xx', `${sub.status} ${JSON.stringify(sub.json).slice(0, 100)}`);
  const got = alerts('countReady', since);
  expect(got.includes('eleni') || got.includes('nikos'), 'approvers alerted', 'owner or admin', got.join(','));
  const wrong = got.filter((n) => ['maria', 'giorgos', 'dimitris', 'sofia', 'katerina'].includes(n));
  expect(wrong.length === 0, 'people without Marousi approval', 'not alerted', wrong.join(','));
});
