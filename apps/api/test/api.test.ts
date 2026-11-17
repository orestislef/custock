import { beforeAll, describe, expect, it } from 'vitest';
import { migrate, openDb, seed, hashPassword, type Db, type SeedResult } from '@custock/db';
import { DEFAULT_ROLES, uuidv7, type Customer, type MeContext, type Post, type Product, type PublicProduct, type StockLevel } from '@custock/core';
import { createApp, type App } from '../src/app';

let db: Db;
let s: SeedResult;
let app: App;
const pw = hashPassword('custock');
const tokens: Record<string, string> = {};

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

async function call(method: string, path: string, who?: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await app.request(path, {
    method,
    headers: {
      ...(who ? { Authorization: `Bearer ${tokens[who]}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as Json, headers: res.headers };
}

async function login(who: string, email = `${who}@example.com`) {
  const r = await call('POST', '/v1/auth/login', undefined, { email, password: 'custock' });
  expect(r.status).toBe(200);
  tokens[who] = r.body.accessToken;
  return r.body;
}

// a second, tiny business to prove nothing leaks between organizations
const other = { org: uuidv7(), shop: uuidv7(), product: uuidv7(), variant: uuidv7(), customer: uuidv7(), user: uuidv7(), role: uuidv7(), membership: uuidv7(), post: uuidv7() };
function seedOther() {
  const now = Date.now();
  const run = (sql: string, ...p: unknown[]) => db.prepare(sql).run(...p);
  run(`INSERT INTO organizations (id, name, slug, created_at) VALUES (?, 'Other', 'other', ?)`, other.org, now);
  run(`INSERT INTO shops (id, org_id, name, slug, created_at) VALUES (?, ?, 'Other shop', 'other-shop', ?)`, other.shop, other.org, now);
  run(`INSERT INTO products (id, org_id, name, search_key, created_at, updated_at) VALUES (?, ?, 'Secret honey', 'secret honey meli', ?, ?)`, other.product, other.org, now, now);
  run(`INSERT INTO product_variants (id, org_id, product_id, price_minor, cost_minor, is_default, created_at, updated_at) VALUES (?, ?, ?, 999, 111, 1, ?, ?)`, other.variant, other.org, other.product, now, now);
  run(`INSERT INTO barcodes (id, org_id, variant_id, code, code_norm, created_at) VALUES (?, ?, ?, '5200000000000', '05200000000000', ?)`, uuidv7(), other.org, other.variant, now);
  run(`INSERT INTO users (id, email, display_name, password_hash, locale, created_at, updated_at) VALUES (?, 'otto@example.com', 'Otto', ?, 'en', ?, ?)`, other.user, pw, now, now);
  run(`INSERT INTO roles (id, org_id, template_key, name, rank, is_locked, created_at, updated_at) VALUES (?, ?, 'owner', 'Owner', 100, 1, ?, ?)`, other.role, other.org, now, now);
  for (const p of DEFAULT_ROLES[0]!.permissions) run('INSERT INTO role_permissions (role_id, permission) VALUES (?, ?)', other.role, p);
  run(`INSERT INTO memberships (id, org_id, user_id, status, joined_at) VALUES (?, ?, ?, 'active', ?)`, other.membership, other.org, other.user, now);
  run(`INSERT INTO role_assignments (id, org_id, membership_id, role_id, scope_type, scope_id, created_at) VALUES (?, ?, ?, ?, 'org', ?, ?)`, uuidv7(), other.org, other.membership, other.role, other.org, now);
  run(`INSERT INTO customers (id, org_id, name, email, email_verified_at, locale, source, search_key, created_at, updated_at) VALUES (?, ?, 'Leaky Lena', 'anna@example.com', ?, 'en', 'staff', 'leaky lena', ?, ?)`, other.customer, other.org, now, now, now);
  run(`INSERT INTO customer_subscriptions (id, org_id, customer_id, scope_type, scope_id, status, created_at, updated_at) VALUES (?, ?, ?, 'org', ?, 'subscribed', ?, ?)`, uuidv7(), other.org, other.customer, other.org, now, now);
  run(`INSERT INTO posts (id, org_id, kind, status, default_locale, channels, audience, author_id, sent_at, created_at, updated_at) VALUES (?, ?, 'news', 'sent', 'en', '["feed"]', '{"scopes":[]}', ?, ?, ?, ?)`, other.post, other.org, other.user, now, now, now);
  run(`INSERT INTO post_translations (post_id, locale, title, body) VALUES (?, 'en', 'Other secret news', 'x')`, other.post);
  run(`INSERT INTO post_scopes (post_id, org_id, scope_type, scope_id) VALUES (?, ?, 'org', ?)`, other.post, other.org, other.org);
}

const barcodeOf = (variantId: string) => (db.prepare("SELECT code FROM barcodes WHERE variant_id = ? AND symbology != 'itf14'").get(variantId) as { code: string }).code;
const setOrg = (col: string, value: string | number) => db.prepare(`UPDATE organizations SET ${col} = ? WHERE id = ?`).run(value, s.orgId);

beforeAll(async () => {
  db = openDb(':memory:');
  migrate(db);
  s = seed(db, { passwordHash: pw });
  seedOther();
  app = createApp({ db, dev: true, jwtSecret: 'test-secret-that-is-long-enough-123', publicWebUrl: 'http://localhost:3000', corsOrigins: [] });
  for (const who of ['eleni', 'nikos', 'maria', 'giorgos', 'dimitris', 'katerina', 'sofia', 'anna', 'otto']) await login(who);
});

describe('auth', () => {
  it('refuses a wrong password with a problem code', async () => {
    const r = await call('POST', '/v1/auth/login', undefined, { email: 'eleni@example.com', password: 'nope' });
    expect(r.status).toBe(401);
    expect(r.body.code).toBe('unauthorized');
    expect(r.headers.get('content-type')).toContain('json');
  });
  it('validates input', async () => {
    const r = await call('POST', '/v1/auth/login', undefined, { email: 'not-an-email' });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('validation');
  });
  it('needs a token for org routes', async () => {
    expect((await call('GET', `/v1/orgs/${s.orgId}/products`)).status).toBe(401);
  });
  it('rotates refresh tokens and kills the family on reuse', async () => {
    const first = await call('POST', '/v1/auth/login', undefined, { email: 'sofia@example.com', password: 'custock' });
    const second = await call('POST', '/v1/auth/refresh', undefined, { refreshToken: first.body.refreshToken });
    expect(second.status).toBe(200);
    const reuse = await call('POST', '/v1/auth/refresh', undefined, { refreshToken: first.body.refreshToken });
    expect(reuse.status).toBe(401);
    const afterReuse = await call('POST', '/v1/auth/refresh', undefined, { refreshToken: second.body.refreshToken });
    expect(afterReuse.status).toBe(401);
  });
  it('signs customers in with a one time code that lands in the dev outbox', async () => {
    const req = await call('POST', '/v1/auth/otp/request', undefined, { email: 'new.person@example.com', locale: 'el' });
    expect(req.body.devCode).toMatch(/^\d{6}$/);
    const mail = db.prepare("SELECT title, locale FROM dev_outbox WHERE to_address = 'new.person@example.com'").get() as { title: string; locale: string };
    expect(mail.locale).toBe('el');
    expect(mail.title).toContain(req.body.devCode);
    const bad = await call('POST', '/v1/auth/otp/verify', undefined, { email: 'new.person@example.com', code: '000000' });
    expect(bad.status).toBe(401);
    const ok = await call('POST', '/v1/auth/otp/verify', undefined, { email: 'new.person@example.com', code: req.body.devCode });
    expect(ok.status).toBe(200);
    tokens.newbie = ok.body.accessToken;
    const me = await call('GET', '/v1/me/context', 'newbie');
    expect(me.body.orgs).toEqual([]);
  });
  it('logout revokes the session', async () => {
    const r = await call('POST', '/v1/auth/login', undefined, { email: 'katerina@example.com', password: 'custock' });
    tokens.kat2 = r.body.accessToken;
    expect((await call('POST', '/v1/auth/logout', 'kat2')).status).toBe(204);
    expect((await call('GET', '/v1/me/context', 'kat2')).status).toBe(401);
  });
});

describe('me/context', () => {
  it('owner sees every shop and org permissions', async () => {
    const me: MeContext = (await call('GET', '/v1/me/context', 'eleni')).body;
    expect(me.orgs).toHaveLength(1);
    expect(me.orgs[0]!.shops).toHaveLength(3);
    expect(me.orgs[0]!.orgPerms).toContain('org.settings.manage');
  });
  it('a shop manager only gets their shop, and approval takes publishing away', async () => {
    const me: MeContext = (await call('GET', '/v1/me/context', 'maria')).body;
    const org = me.orgs[0]!;
    expect(org.shops.map((x) => x.shopId)).toEqual([s.shops.kifisia]);
    expect(org.shops[0]!.perms).toContain('stock.adjust');
    expect(org.shops[0]!.perms).not.toContain('posts.publish');
    expect(org.anyPerms).not.toContain('products.cost.view');
  });
  it('a customer follows Lemoni and is a member of nothing', async () => {
    const me: MeContext = (await call('GET', '/v1/me/context', 'anna')).body;
    expect(me.orgs).toEqual([]);
    // anna is also a customer of the other business (same verified email), linked at login
    expect(me.following.map((f) => f.orgName).sort()).toEqual(['Lemoni', 'Other']);
    expect(new Set(me.following.map((f) => f.customerId)).size).toBe(2);
  });
  it('flags a stale permissions version', async () => {
    db.prepare('UPDATE memberships SET perms_version = 5 WHERE user_id = ?').run(s.users.dimitris);
    const r = await call('GET', `/v1/orgs/${s.orgId}`, 'dimitris', undefined, { 'X-Perms-Version': '1' });
    expect(r.headers.get('X-Perms-Stale')).toBe('1');
  });
});

describe('catalog and stock', () => {
  it('shows costs only to roles that may see them', async () => {
    const owner = await call('GET', `/v1/orgs/${s.orgId}/products?limit=5`, 'eleni');
    expect(owner.body.items[0].variants[0]).toHaveProperty('costMinor');
    const manager = await call('GET', `/v1/orgs/${s.orgId}/products?limit=5`, 'maria');
    expect(manager.body.items[0].variants[0]).not.toHaveProperty('costMinor');
  });
  it('limits stock levels to the member shops', async () => {
    const r = await call('GET', `/v1/orgs/${s.orgId}/products/${s.products['p-olive-oil']}`, 'maria');
    const shops = new Set((r.body.levels as StockLevel[]).map((l) => l.shopId));
    expect([...shops]).toEqual([s.shops.kifisia]);
    const owner = await call('GET', `/v1/orgs/${s.orgId}/products/${s.products['p-olive-oil']}`, 'eleni');
    expect(new Set((owner.body.levels as StockLevel[]).map((l) => l.shopId)).size).toBe(3);
  });
  it('searches greek by greeklish and russian with or without ё', async () => {
    for (const q of ['meli', 'μελι', 'мёд', 'мед', 'thyme']) {
      const r = await call('GET', `/v1/orgs/${s.orgId}/products?q=${encodeURIComponent(q)}`, 'maria');
      expect((r.body.items as Product[]).map((p) => p.id)).toContain(s.products['p-thyme-honey']);
    }
  });
  it('filters out, negative and waiting', async () => {
    const out = await call('GET', `/v1/orgs/${s.orgId}/products?filter=out&shopId=${s.shops.kifisia}`, 'maria');
    expect((out.body.items as Product[]).map((p) => p.id)).toContain(s.products['p-thyme-honey']);
    const neg = await call('GET', `/v1/orgs/${s.orgId}/products?filter=negative`, 'eleni');
    expect((neg.body.items as Product[]).map((p) => p.id)).toContain(s.products['p-loukoumi']);
    const honey = (out.body.items as (Product & { levels: StockLevel[] })[]).find((p) => p.id === s.products['p-thyme-honey'])!;
    expect(honey.levels[0]!.waiting).toBe(14);
  });
  it('refuses a shop the member does not work in', async () => {
    const r = await call('GET', `/v1/orgs/${s.orgId}/products?shopId=${s.shops.glyfada}`, 'maria');
    expect(r.status).toBe(403);
  });
  it('scans a known code and an upc style code with a leading zero', async () => {
    const code = barcodeOf(s.variants['p-olive-oil']!);
    const r = await call('POST', `/v1/orgs/${s.orgId}/scan`, 'dimitris', { code, shopId: s.shops.kifisia });
    expect(r.body.match).toBe('variant');
    expect(r.body.variantId).toBe(s.variants['p-olive-oil']);
    const padded = await call('POST', `/v1/orgs/${s.orgId}/scan`, 'dimitris', { code: '0' + code });
    expect(padded.body.match).toBe('variant');
  });
  it('reads a box barcode as 12 packs', async () => {
    const box = (db.prepare("SELECT code FROM barcodes WHERE symbology = 'itf14'").get() as { code: string }).code;
    const r = await call('POST', `/v1/orgs/${s.orgId}/scan`, 'dimitris', { code: box, symbology: 'itf14' });
    expect(r.body.packQty).toBe(12);
  });
  it('keeps unknown codes for the manager', async () => {
    const r = await call('POST', `/v1/orgs/${s.orgId}/scan`, 'dimitris', { code: 'MYSTERY-1', shopId: s.shops.kifisia });
    expect(r.body.match).toBe('unknown');
    await call('POST', `/v1/orgs/${s.orgId}/scan`, 'dimitris', { code: 'MYSTERY-1', shopId: s.shops.kifisia });
    const list = await call('GET', `/v1/orgs/${s.orgId}/unknown-scans`, 'maria');
    const row = list.body.find((x: { code: string }) => x.code === 'MYSTERY-1');
    expect(row.times).toBe(2);
    expect((await call('GET', `/v1/orgs/${s.orgId}/unknown-scans`, 'dimitris')).status).toBe(403);
  });
  it('shows the ledger only with history permission', async () => {
    const r = await call('GET', `/v1/orgs/${s.orgId}/movements?variantId=${s.variants['p-thyme-honey']}&limit=5`, 'maria');
    expect(r.status).toBe(200);
    expect(r.body.items.length).toBe(5);
    expect(r.body.items[0].shopId).toBe(s.shops.kifisia);
    expect((await call('GET', `/v1/orgs/${s.orgId}/movements`, 'dimitris')).status).toBe(403);
  });
});

describe('customers', () => {
  it('owner sees all 40, staff see masked contacts of their shop only', async () => {
    const owner = await call('GET', `/v1/orgs/${s.orgId}/customers?limit=100`, 'eleni');
    expect(owner.body.total).toBe(40);
    expect((owner.body.items as Customer[]).every((x) => !x.contactMasked)).toBe(true);
    const staff = await call('GET', `/v1/orgs/${s.orgId}/customers?limit=100`, 'dimitris');
    expect(staff.body.total).toBeLessThan(40);
    expect((staff.body.items as Customer[]).every((x) => x.contactMasked && (!x.email || x.email.includes('***')))).toBe(true);
  });
  it('a manager sees full contacts of customers who reach their shop, nobody else', async () => {
    const r = await call('GET', `/v1/orgs/${s.orgId}/customers?limit=100`, 'maria');
    const items = r.body.items as Customer[];
    expect(items.every((x) => !x.contactMasked)).toBe(true);
    const glyfadaOnly = db.prepare(
      `SELECT customer_id FROM customer_subscriptions WHERE org_id = ? GROUP BY customer_id
       HAVING sum(scope_type = 'shop' AND scope_id = ?) = count(*)`,
    ).get(s.orgId, s.shops.glyfada) as { customer_id: string };
    expect(items.map((x) => x.id)).not.toContain(glyfadaOnly.customer_id);
    expect((await call('GET', `/v1/orgs/${s.orgId}/customers/${glyfadaOnly.customer_id}`, 'maria')).status).toBe(404);
  });
  it('searches customers in greek and russian script', async () => {
    const r = await call('GET', `/v1/orgs/${s.orgId}/customers?q=${encodeURIComponent('petrova')}`, 'eleni');
    expect((r.body.items as Customer[]).map((x) => x.name)).toContain('Анна Петрова');
  });
  it('customer detail has consents, waiting list and notes', async () => {
    const anna = (db.prepare("SELECT id FROM customers WHERE email = 'anna@example.com' AND org_id = ?").get(s.orgId) as { id: string }).id;
    const r = await call('GET', `/v1/orgs/${s.orgId}/customers/${anna}`, 'maria');
    expect(r.body.waitingFor.length).toBeGreaterThan(0);
    expect(r.body.notes.length).toBe(1);
    expect(r.body.consents.length).toBeGreaterThan(0);
  });
  it('lists join links within the member scopes', async () => {
    const owner = await call('GET', `/v1/orgs/${s.orgId}/join-links`, 'eleni');
    expect(owner.body).toHaveLength(6);
    const maria = await call('GET', `/v1/orgs/${s.orgId}/join-links`, 'maria');
    expect(maria.body.map((l: { code: string }) => l.code).sort()).toEqual(['kif7q2', 'old000']);
    expect(maria.body[0].url).toMatch(/^http:\/\/localhost:3000\/j\//);
  });
});

describe('posts', () => {
  it('the offer carries a real was price', async () => {
    const r = await call('GET', `/v1/orgs/${s.orgId}/posts/${s.posts.offer}`, 'eleni');
    const oil = (r.body as Post).products.find((p) => p.variantId === s.variants['p-olive-oil'])!;
    expect(oil.offerPriceMinor).toBe(1090);
    expect(oil.wasMinor).toBe(1290);
    expect(r.body.stats.sent).toBeGreaterThan(0);
  });
  it('a shop manager sees posts reaching their shop and their own drafts', async () => {
    const r = await call('GET', `/v1/orgs/${s.orgId}/posts`, 'giorgos');
    const ids = (r.body.items as Post[]).map((p) => p.id);
    expect(ids).toContain(s.posts.news);
    expect(ids).not.toContain(s.posts.offer); // north athens only
    expect(ids).not.toContain(s.posts.draft);
    expect((await call('GET', `/v1/orgs/${s.orgId}/posts/${s.posts.offer}`, 'giorgos')).status).toBe(404);
  });
});

describe('team', () => {
  it('members come with what the caller may do', async () => {
    const r = await call('GET', `/v1/orgs/${s.orgId}/members`, 'nikos');
    const byUser = Object.fromEntries(r.body.map((m: { userId: string }) => [m.userId, m]));
    expect(byUser[s.users.eleni!].canManage).toBe(false);
    expect(byUser[s.users.eleni!].manageBlockedBy).toBe('rank');
    expect(byUser[s.users.nikos!].manageBlockedBy).toBe('self');
    expect(byUser[s.users.maria!].canManage).toBe(true);
  });
  it('a manager sees their shop team only', async () => {
    const r = await call('GET', `/v1/orgs/${s.orgId}/members`, 'maria');
    const users = r.body.map((m: { userId: string }) => m.userId);
    expect(users).toContain(s.users.dimitris);
    expect(users).not.toContain(s.users.katerina);
    expect(r.body.find((m: { userId: string }) => m.userId === s.users.dimitris).canManage).toBe(true);
  });
  it('explains which roles can be given', async () => {
    const r = await call('GET', `/v1/orgs/${s.orgId}/roles/grantable?scopeType=shop&scopeId=${s.shops.kifisia}`, 'maria');
    const byName = Object.fromEntries(r.body.map((x: { name: string }) => [x.name, x]));
    expect(byName.Staff.ok).toBe(true);
    expect(byName.Manager.blockedBy).toBe('rank');
    const away = await call('GET', `/v1/orgs/${s.orgId}/roles/grantable?scopeType=shop&scopeId=${s.shops.marousi}`, 'maria');
    expect(away.body.every((x: { ok: boolean }) => !x.ok)).toBe(true);
  });
  it('staff cannot read the team', async () => {
    expect((await call('GET', `/v1/orgs/${s.orgId}/members`, 'dimitris')).status).toBe(403);
  });
});

describe('reports', () => {
  it('dashboard hides money without the financial permission', async () => {
    const maria = await call('GET', `/v1/orgs/${s.orgId}/reports/dashboard`, 'maria');
    expect(maria.body.peopleWaiting).toBeGreaterThanOrEqual(14);
    expect(maria.body.stockValueCostMinor).toBeNull();
    expect(maria.body.outOfStock).toBeGreaterThanOrEqual(1);
    const owner = await call('GET', `/v1/orgs/${s.orgId}/reports/dashboard`, 'eleni');
    expect(owner.body.stockValueCostMinor).toBeGreaterThan(0);
    expect(owner.body.negativeStock).toBe(1);
    expect(owner.body.pendingApprovals).toBe(1);
  });
  it('sales per day, most wanted and shrinkage', async () => {
    const sales = await call('GET', `/v1/orgs/${s.orgId}/reports/sales?days=14`, 'sofia');
    expect(sales.body).toHaveLength(14);
    expect(sales.headers.get('X-Series-Unit')).toBe('minor');
    const wanted = await call('GET', `/v1/orgs/${s.orgId}/reports/most-wanted`, 'maria');
    expect(wanted.body[0].variantId).toBe(s.variants['p-thyme-honey']);
    expect(wanted.body[0].waiting).toBe(14);
    const shrink = await call('GET', `/v1/orgs/${s.orgId}/reports/shrinkage`, 'maria');
    expect(shrink.body.every((x: { valueMinor: number | null }) => x.valueMinor === null)).toBe(true);
    expect((await call('GET', `/v1/orgs/${s.orgId}/reports/sales`, 'dimitris')).status).toBe(403);
  });
});

describe('customer side', () => {
  it('feed and offers', async () => {
    const feed = await call('GET', '/v1/c/feed', 'anna');
    const ids = feed.body.items.map((i: { post: Post }) => i.post.id);
    expect(ids).toContain(s.posts.offer);
    expect(ids).toContain(s.posts.arrival);
    expect(ids).not.toContain(s.posts.draft);
    const byPost = Object.fromEntries(feed.body.items.map((i: { post: Post; orgName: string }) => [i.post.id, i.orgName]));
    expect(byPost[s.posts.offer]).toBe('Lemoni');
    expect(byPost[other.post]).toBe('Other');
    const item = feed.body.items.find((i: { post: Post }) => i.post.id === s.posts.offer);
    expect(item.post.audience.tags).toEqual([]);
    const offers = await call('GET', '/v1/c/offers', 'anna');
    expect(offers.body.map((i: { post: Post }) => i.post.id)).toEqual([s.posts.offer]);
  });
  it('catalog follows the merchant switch', async () => {
    const r = await call('GET', '/v1/c/orgs/lemoni/catalog', 'anna');
    expect(r.status).toBe(200);
    const oil = (r.body as PublicProduct[]).find((p) => p.id === s.products['p-olive-oil'])!;
    expect(oil.offer?.priceMinor).toBe(1090);
    expect(oil.saved).toBe(true);
    expect((await call('GET', '/v1/c/orgs/lemoni/catalog', 'newbie')).status).toBe(403);
  });
  it('followed shops', async () => {
    const r = await call('GET', '/v1/c/shops', 'anna');
    expect(r.body.filter((x: { orgName: string }) => x.orgName === 'Lemoni').map((x: { name: string }) => x.name).sort()).toEqual(['Glyfada', 'Kifisia', 'Marousi']);
  });
});

describe('public pages', () => {
  it('join page counts opens', async () => {
    const before = (db.prepare("SELECT sum(opens) n FROM join_link_stats_daily WHERE join_link_id = ?").get(s.joinLinks.kif7q2) as { n: number }).n;
    const r = await call('GET', '/v1/public/join/kif7q2');
    expect(r.body.scopeName).toBe('Lemoni Kifisia');
    expect(r.body.disabled).toBe(false);
    const after = (db.prepare("SELECT sum(opens) n FROM join_link_stats_daily WHERE join_link_id = ?").get(s.joinLinks.kif7q2) as { n: number }).n;
    expect(after).toBe(before + 1);
    expect((await call('GET', '/v1/public/join/old000')).body.disabled).toBe(true);
    expect((await call('GET', '/v1/public/join/nope')).status).toBe(404);
  });
  it('shelf product follows stock and price settings', async () => {
    const code = barcodeOf(s.variants['p-thyme-honey']!);
    const avail = await call('GET', `/v1/public/p/${code}`);
    const kif = (avail.body as PublicProduct).availability.find((a) => a.shopId === s.shops.kifisia)!;
    expect(kif.state).toBe('out');
    expect(kif.qty).toBeNull();
    setOrg('customer_stock', 'exact');
    const exact = await call('GET', `/v1/public/p/${code}`);
    expect((exact.body as PublicProduct).availability.every((a) => typeof a.qty === 'number')).toBe(true);
    setOrg('customer_stock', 'off');
    setOrg('customer_prices', 0);
    const off = await call('GET', `/v1/public/p/${code}`);
    expect((off.body as PublicProduct).availability.every((a) => a.state === null)).toBe(true);
    expect(off.body.priceMinor).toBeNull();
    setOrg('customer_stock', 'availability');
    setOrg('customer_prices', 1);
  });
  it('public catalog only when the merchant made it public', async () => {
    expect((await call('GET', '/v1/public/orgs/lemoni/catalog')).status).toBe(403);
    setOrg('customer_catalog', 'public');
    const r = await call('GET', '/v1/public/orgs/lemoni/catalog?q=meli');
    expect(r.body.map((p: PublicProduct) => p.id)).toEqual([s.products['p-thyme-honey']]);
    setOrg('customer_catalog', 'subscribers');
  });
});

describe('isolation between organizations', () => {
  it('a member of one org cannot reach another', async () => {
    expect((await call('GET', `/v1/orgs/${other.org}/products`, 'eleni')).status).toBe(404);
    expect((await call('GET', `/v1/orgs/${other.org}`, 'eleni')).status).toBe(404);
    expect((await call('GET', `/v1/orgs/${s.orgId}/customers`, 'otto')).status).toBe(404);
    expect((await call('GET', `/v1/orgs/${s.orgId}/products/${s.products['p-olive-oil']}`, 'otto')).status).toBe(404);
  });
  it('ids from another org are not found through your own org', async () => {
    expect((await call('GET', `/v1/orgs/${s.orgId}/products/${other.product}`, 'eleni')).status).toBe(404);
    expect((await call('GET', `/v1/orgs/${s.orgId}/customers/${other.customer}`, 'eleni')).status).toBe(404);
    expect((await call('GET', `/v1/orgs/${s.orgId}/posts/${other.post}`, 'eleni')).status).toBe(404);
  });
  it('lists and searches never mix orgs', async () => {
    const products = await call('GET', `/v1/orgs/${s.orgId}/products?q=meli&limit=200`, 'eleni');
    expect((products.body.items as Product[]).map((p) => p.id)).not.toContain(other.product);
    const customers = await call('GET', `/v1/orgs/${s.orgId}/customers?limit=200`, 'eleni');
    expect((customers.body.items as Customer[]).map((x) => x.name)).not.toContain('Leaky Lena');
    const ottoProducts = await call('GET', `/v1/orgs/${other.org}/products?limit=200`, 'otto');
    expect(ottoProducts.body.items.map((p: Product) => p.id)).toEqual([other.product]);
    const scan = await call('POST', `/v1/orgs/${other.org}/scan`, 'otto', { code: barcodeOf(s.variants['p-olive-oil']!) });
    expect(scan.body.match).toBe('unknown');
  });
  it('the same email at two orgs stays two customers, the app user only sees orgs that linked them', async () => {
    const me: MeContext = (await call('GET', '/v1/me/context', 'anna')).body;
    // Leaky Lena has anna's email but was added by staff with a verified email, so a fresh login links it
    await login('anna');
    const again: MeContext = (await call('GET', '/v1/me/context', 'anna')).body;
    expect(me.following.length).toBeLessThanOrEqual(again.following.length);
    const lemoni = await call('GET', `/v1/orgs/${s.orgId}/customers?q=anna&limit=200`, 'eleni');
    expect((lemoni.body.items as Customer[]).every((x) => x.name !== 'Leaky Lena')).toBe(true);
  });
});
