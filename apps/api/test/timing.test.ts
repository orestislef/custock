// real life timing: two people at once, one person on two devices, rights or switches changing
// while someone is inside, and clocks around midnight and daylight saving.

import { beforeAll, describe, expect, it } from 'vitest';
import { hashPassword, migrate, openDb, seed, type Db, type SeedResult } from '@custock/db';
import { uuidv7 } from '@custock/core';
import { createApp, type App } from '../src/app';
import { inQuietHours, quietHoursEnd } from '../src/lib/time';
import { inviteSuperAdmin, setOrgControls } from '../src/services/platform';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const SECRET = 'timing-test-secret-long-enough-123456';
const clock = Date.now();

describe('timing', () => {
  let db: Db;
  let s: SeedResult;
  let app: App;
  type Who = 'eleni' | 'nikos' | 'maria' | 'dimitris';
  const tokens = {} as Record<Who, string>;
  const versions = {} as Record<Who, number>;

  async function call(method: string, path: string, token?: string, body?: unknown, extra: Record<string, string> = {}) {
    const res = await app.request(path, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...extra },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: Json = text;
    try { parsed = text ? JSON.parse(text) : null; } catch { /* not json */ }
    return { status: res.status, body: parsed, headers: res.headers };
  }
  const q = (sql: string, ...a: unknown[]) => db.prepare(sql).get(...a) as Json;
  const all = (sql: string, ...a: unknown[]) => db.prepare(sql).all(...a) as Json[];
  let n = 0;
  const id = () => uuidv7(clock + ++n);
  const O = () => `/v1/orgs/${s.orgId}`;
  const onHand = (shop: string, variant: string) => (q('SELECT on_hand FROM stock_levels WHERE shop_id = ? AND variant_id = ?', shop, variant)?.on_hand ?? 0) as number;
  let variant = '';

  beforeAll(async () => {
    db = openDb(':memory:');
    migrate(db);
    s = seed(db, { passwordHash: hashPassword('custock'), now: clock });
    app = createApp({ db, dev: true, jwtSecret: SECRET, publicWebUrl: 'http://localhost:3000', corsOrigins: [], now: () => clock, rateLimit: false });
    for (const who of ['eleni', 'nikos', 'maria', 'dimitris'] as Who[]) {
      const r = await call('POST', '/v1/auth/login', undefined, { email: `${who}@example.com`, password: 'custock' });
      tokens[who] = r.body.accessToken;
      const me = await call('GET', '/v1/me/context', tokens[who]);
      versions[who] = me.body.orgs.find((o: Json) => o.orgId === s.orgId).permsVersion;
    }
    variant = q(
      `SELECT l.variant_id AS v FROM stock_levels l JOIN product_variants pv ON pv.id = l.variant_id JOIN products p ON p.id = pv.product_id
        WHERE l.shop_id = ? AND l.on_hand > 20 AND p.uom = 'piece' AND p.archived_at IS NULL AND p.track_stock = 1 LIMIT 1`,
      s.shops.kifisia,
    ).v;
  });

  const move = (token: string, m: Record<string, unknown>) => call('POST', `${O()}/movements`, token, { movements: [{ id: id(), shopId: s.shops.kifisia, variantId: variant, occurredAt: clock, ...m }] });

  // ------------------------------------------------------------ two people in the same shop

  it('two people counting the same shelf with add: both scans are kept', async () => {
    const count = (await call('POST', `${O()}/shops/${s.shops.kifisia}/counts`, tokens.maria, { kind: 'partial' })).body;
    const line = `${O()}/counts/${count.id}/lines/${variant}`;
    const [a, b] = await Promise.all([
      call('PUT', line, tokens.maria, { countedQty: 3, mode: 'add' }),
      call('PUT', line, tokens.dimitris, { countedQty: 4, mode: 'add' }),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect((await call('GET', `${O()}/counts/${count.id}`, tokens.maria)).body.lines.find((l: Json) => l.variantId === variant).countedQty).toBe(7);
    await call('POST', `${O()}/counts/${count.id}/cancel`, tokens.maria, {});
  });

  it('a sale and a delivery while a count is open are not undone by applying it', async () => {
    const before = onHand(s.shops.kifisia, variant);
    const count = (await call('POST', `${O()}/shops/${s.shops.kifisia}/counts`, tokens.maria, { kind: 'partial' })).body;
    // the shelf really holds two less than the system thinks
    await call('PUT', `${O()}/counts/${count.id}/lines/${variant}`, tokens.maria, { countedQty: before - 2, mode: 'set' });
    // after counting: one sold, three arrive from another shop
    expect((await move(tokens.dimitris, { qtyDelta: -1, kind: 'sale' })).body.accepted).toHaveLength(1);
    expect((await move(tokens.maria, { qtyDelta: 3, kind: 'receive' })).body.accepted).toHaveLength(1);
    const [x, y] = await Promise.all([
      call('POST', `${O()}/counts/${count.id}/apply`, tokens.maria, {}),
      call('POST', `${O()}/counts/${count.id}/apply`, tokens.eleni, {}),
    ]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    // counted minus what left after counting plus what came in after counting
    expect(onHand(s.shops.kifisia, variant)).toBe(before - 2 - 1 + 3);
    expect(q("SELECT count(*) AS n FROM stock_movements WHERE ref_type = 'count' AND ref_id = ?", count.id).n).toBe(1);
  });

  it('a transfer received twice while a count is open: it lands once and the count keeps it', async () => {
    const before = onHand(s.shops.kifisia, variant);
    const count = (await call('POST', `${O()}/shops/${s.shops.kifisia}/counts`, tokens.maria, { kind: 'partial' })).body;
    await call('PUT', `${O()}/counts/${count.id}/lines/${variant}`, tokens.maria, { countedQty: before, mode: 'set' });
    const tr = (await call('POST', `${O()}/transfers`, tokens.eleni, { fromShopId: s.shops.marousi, toShopId: s.shops.kifisia, lines: [{ variantId: variant, qty: 2 }] })).body;
    expect((await call('POST', `${O()}/transfers/${tr.id}/send`, tokens.eleni, {})).status).toBe(200);
    // the receiver taps receive on the phone and on the desktop at once
    const got = { lines: [{ variantId: variant, qtyReceived: 2 }] };
    const [a, b] = await Promise.all([
      call('POST', `${O()}/transfers/${tr.id}/receive`, tokens.maria, got),
      call('POST', `${O()}/transfers/${tr.id}/receive`, tokens.eleni, got),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect((await call('POST', `${O()}/counts/${count.id}/apply`, tokens.maria, {})).status).toBe(200);
    expect(onHand(s.shops.kifisia, variant)).toBe(before + 2);
  });

  it('two approvers approve the same post at once: it goes out once', async () => {
    await call('PATCH', `${O()}`, tokens.eleni, { postsNeedApproval: true });
    const created = await call('POST', `${O()}/posts`, tokens.maria, {
      kind: 'news', defaultLocale: 'en', translations: { en: { title: 'Timing test', body: 'Two approvers' } },
      audience: { scopes: [{ scopeType: 'shop', scopeId: s.shops.kifisia }] }, channels: ['feed'],
    });
    expect(created.status).toBe(201);
    const post = created.body;
    expect((await call('POST', `${O()}/posts/${post.id}/publish`, tokens.maria, {})).body.status).toBe('pending_approval');
    const [a, b] = await Promise.all([
      call('POST', `${O()}/posts/${post.id}/approve`, tokens.eleni, {}),
      call('POST', `${O()}/posts/${post.id}/approve`, tokens.nikos, {}),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(q("SELECT count(*) AS n FROM jobs WHERE kind = 'send_post' AND json_extract(payload, '$.postId') = ?", post.id).n).toBe(1);
    await call('PATCH', `${O()}`, tokens.eleni, { postsNeedApproval: false });
  });

  it('one invite link opened in two tabs: one account, one membership, no server error', async () => {
    const roleId = q("SELECT id FROM roles WHERE org_id = ? AND template_key = 'staff'", s.orgId).id;
    const inv = await call('POST', `${O()}/invites`, tokens.eleni, { email: 'twotabs@example.com', roleId, scopeType: 'shop', scopeId: s.shops.kifisia, locale: 'en' });
    expect(inv.status).toBe(201);
    const token = (inv.body.link ?? inv.body.devLink).split('/').pop();
    const body = { token, displayName: 'Two Tabs', password: 'two.tabs.password' };
    const [a, b] = await Promise.all([call('POST', '/v1/invites/register', undefined, body), call('POST', '/v1/invites/register', undefined, body)]);
    expect([a.status, b.status].sort()).toEqual([201, 410]);
    expect(q("SELECT count(*) AS n FROM users WHERE email = 'twotabs@example.com'").n).toBe(1);
    expect(q("SELECT count(*) AS n FROM memberships m JOIN users u ON u.id = m.user_id WHERE u.email = 'twotabs@example.com'").n).toBe(1);
  });

  it('one super admin invite opened in two tabs: one account, no server error', async () => {
    db.prepare("UPDATE users SET platform_role = 'superadmin' WHERE id = ?").run(s.users.eleni!);
    const inv = inviteSuperAdmin(db, s.users.eleni!, { email: 'twotabs.admin@example.com' }, { webUrl: 'http://localhost:3000', emailed: false, now: clock });
    const token = inv.link.split('/').pop();
    const body = { token, displayName: 'Admin Tabs', password: 'admin.tabs.password' };
    const [a, b] = await Promise.all([call('POST', '/v1/platform-invites/register', undefined, body), call('POST', '/v1/platform-invites/register', undefined, body)]);
    expect([a.status, b.status].sort()).toEqual([201, 410]);
    expect(q("SELECT count(*) AS n FROM users WHERE email = 'twotabs.admin@example.com' AND platform_role = 'superadmin'").n).toBe(1);
    db.prepare('UPDATE users SET platform_role = NULL WHERE id = ?').run(s.users.eleni!);
  });

  it('two people saving the same product: the second save is refused, not silently lost', async () => {
    const product = q('SELECT product_id AS p FROM product_variants WHERE id = ?', variant).p;
    const loaded = await call('GET', `${O()}/products/${product}`, tokens.eleni);
    const etag = loaded.headers.get('ETag')!;
    expect(etag).toBeTruthy();
    const first = await call('PATCH', `${O()}/products/${product}`, tokens.eleni, { brand: 'First edit' }, { 'If-Match': etag });
    expect(first.status).toBe(200);
    const second = await call('PATCH', `${O()}/products/${product}`, tokens.nikos, { brand: 'Second edit' }, { 'If-Match': etag });
    expect(second.status).toBe(412);
    expect(q('SELECT brand FROM products WHERE id = ?', product).brand).toBe('First edit');
  });

  // ------------------------------------------------------------ one person on two devices

  it('the network drops mid save and the save is sent again: one product, the second answer is the first', async () => {
    const body = { name: 'Retry tea', priceMinor: 250, uom: 'piece' };
    const key = { 'Idempotency-Key': uuidv7(clock) };
    const [a, b] = await Promise.all([
      call('POST', `${O()}/products`, tokens.eleni, body, key),
      call('POST', `${O()}/products`, tokens.eleni, body, key),
    ]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(b.body.id).toBe(a.body.id);
    expect(q("SELECT count(*) AS n FROM products WHERE org_id = ? AND name = 'Retry tea'", s.orgId).n).toBe(1);
    const later = await call('POST', `${O()}/products`, tokens.eleni, body, key);
    expect(later.headers.get('Idempotent-Replay')).toBe('true');
    expect(later.body.id).toBe(a.body.id);
  });

  it('a phone sells offline, the desktop adjusts, the phone syncs twice: every movement counts once', async () => {
    const before = onHand(s.shops.kifisia, variant);
    // the phone's sale happened ten minutes ago, without signal
    const sale = { id: id(), shopId: s.shops.kifisia, variantId: variant, qtyDelta: -2, kind: 'sale', occurredAt: clock - 600_000 };
    expect((await move(tokens.maria, { qtyDelta: -1, kind: 'adjust', reason: 'damaged' })).body.accepted).toHaveLength(1);
    const sync = () => call('POST', `${O()}/movements`, tokens.maria, { movements: [sale] });
    const [a, b] = await Promise.all([sync(), sync()]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(onHand(s.shops.kifisia, variant)).toBe(before - 3);
    expect(q('SELECT count(*) AS n FROM stock_movements WHERE id = ?', sale.id).n).toBe(1);
  });

  // ------------------------------------------------------------ rights and switches changing

  it('a manager whose shop role is removed while the page is open: refused and told to refresh', async () => {
    const m = q('SELECT id FROM memberships WHERE org_id = ? AND user_id = ?', s.orgId, s.users.maria!).id;
    const asg = all('SELECT id FROM role_assignments WHERE membership_id = ?', m);
    for (const a of asg) expect((await call('DELETE', `${O()}/members/${m}/assignments/${a.id}`, tokens.eleni)).status).toBe(204);
    const r = await move(tokens.maria, { qtyDelta: 1, kind: 'receive' });
    // refused: a 403, or the batch answer with the movement rejected
    if (r.status === 200) expect(r.body.accepted).toHaveLength(0);
    else expect([403, 404]).toContain(r.status);
    const again = await call('GET', `${O()}/products?limit=1`, tokens.maria, undefined, { 'X-Perms-Version': String(versions.maria) });
    if (again.status < 300) expect(again.headers.get('X-Perms-Stale')).toBe('1');
  });

  it('a business paused or a feature switched off while people are inside: the next call says stale', async () => {
    const before = versions.dimitris;
    setOrgControls(db, s.users.eleni!, s.orgId, { disabledFeatures: ['posts'] }, clock);
    const r = await call('GET', `${O()}/products?limit=1`, tokens.dimitris, undefined, { 'X-Perms-Version': String(before) });
    expect(r.status).toBe(200);
    expect(r.headers.get('X-Perms-Stale')).toBe('1');
    const posts = await call('GET', `${O()}/posts`, tokens.dimitris, undefined, { 'X-Perms-Version': String(before) });
    expect(posts.status).toBe(403);
    expect(posts.headers.get('X-Perms-Stale')).toBe('1');
    setOrgControls(db, s.users.eleni!, s.orgId, { disabledFeatures: [] }, clock);
  });

  // ------------------------------------------------------------ clocks

  it('quiet hours across midnight end at the right local time, also on clock change nights', () => {
    const tz = 'Europe/Athens';
    // an ordinary night: 23:30 local (20:30Z in winter) waits until 09:00 local
    expect(quietHoursEnd(Date.UTC(2026, 10, 18, 21, 30), '22:00-09:00', tz)).toBe(Date.UTC(2026, 10, 19, 7, 0));
    // the night clocks go back (25 Oct 2026, 04:00 EEST becomes 03:00 EET): 09:00 local is 07:00Z
    expect(quietHoursEnd(Date.UTC(2026, 9, 24, 20, 30), '22:00-09:00', tz)).toBe(Date.UTC(2026, 9, 25, 7, 0));
    // the night clocks go forward (29 Mar 2026, 03:00 EET becomes 04:00 EEST): 09:00 local is 06:00Z
    expect(quietHoursEnd(Date.UTC(2026, 2, 28, 21, 0), '22:00-09:00', tz)).toBe(Date.UTC(2026, 2, 29, 6, 0));
    // a very long window on the long night still finds its end
    const end = quietHoursEnd(Date.UTC(2026, 9, 24, 21, 1), '00:00-23:59', tz);
    expect(inQuietHours(end, '00:00-23:59', tz)).toBe(false);
    // 08:59 is still quiet, 09:00 is not
    expect(inQuietHours(Date.UTC(2026, 10, 19, 6, 59), '22:00-09:00', tz)).toBe(true);
    expect(inQuietHours(Date.UTC(2026, 10, 19, 7, 0), '22:00-09:00', tz)).toBe(false);
  });
});
