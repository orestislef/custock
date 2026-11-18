// the customer side of the app: feed, offers, catalog, followed shops. across organizations,
// but each organization only ever sees its own customer record.

import type { Context, Hono } from 'hono';
import { followedShops, type FeedItem, type Subscription } from '@custock/core';
import type { Db } from '@custock/db';
import type { AppEnv, OrgRow } from '../types';
import { cfgOf, loadTopology, nowOf, ORG_COLUMNS, readerLocale, requireAuth } from '../lib/context';
import { forbidden, notFound } from '../lib/problem';
import { decodeCursor, page, platform, Tenant, clampLimit } from '../lib/tenant';
import { customerPagesOpen } from '../lib/platform-access';
import { loadPosts, postShops } from '../services/posts';
import { storefrontProducts } from '../services/storefront';
import { searchClause } from '../services/search';
import { loadShops } from './org';

export interface Following {
  org: OrgRow;
  customerIds: string[];
  shops: string[]; // followed, visible to customers
  shopNames: Record<string, string>;
  topology: ReturnType<typeof loadTopology>['topology'];
}

export function followingOf(db: Db, userId: string): Following[] {
  const p = platform(db);
  const records = p.all<{ id: string; org_id: string }>(
    'SELECT id, org_id FROM customers WHERE user_id = @u AND erased_at IS NULL',
    { u: userId },
  );
  const byOrg = new Map<string, string[]>();
  for (const r of records) byOrg.set(r.org_id, [...(byOrg.get(r.org_id) ?? []), r.id]);
  const out: Following[] = [];
  for (const [orgId, customerIds] of byOrg) {
    const org = p.get<OrgRow>(`SELECT ${ORG_COLUMNS} FROM organizations WHERE id = @id AND archived_at IS NULL`, { id: orgId });
    // a paused business, or one whose customer pages are off, drops out of the customer app
    if (!org || !customerPagesOpen(db, orgId)) continue;
    const t = new Tenant(db, orgId);
    const { topology, shopNames } = loadTopology(db, orgId);
    const subs = t.all<{ scope_type: Subscription['scopeType']; scope_id: string; status: Subscription['status'] }>(
      'SELECT scope_type, scope_id, status FROM customer_subscriptions WHERE org_id = @org AND customer_id IN (SELECT value FROM json_each(@ids))',
      { ids: customerIds },
    );
    const visible = new Set(t.all<{ id: string }>('SELECT id FROM shops WHERE org_id = @org AND customer_visible = 1 AND archived_at IS NULL').map((s) => s.id));
    const shops = followedShops(subs.map((s) => ({ scopeType: s.scope_type, scopeId: s.scope_id, status: s.status })), topology).filter((s) => visible.has(s));
    out.push({ org, customerIds, shops, shopNames, topology });
  }
  return out;
}

function feedItems(c: Context<AppEnv>, kind?: 'offer'): FeedItem[] {
  const db = cfgOf(c).db;
  const now = nowOf(c);
  const items: (FeedItem & { sortKey: number })[] = [];
  for (const f of followingOf(db, c.get('user').id)) {
    if (!f.shops.length) continue;
    const t = new Tenant(db, f.org.id);
    const rows = t.all<{ id: string }>(
      `SELECT id FROM posts WHERE org_id = @org AND status = 'sent' AND deleted_at IS NULL
         AND (@kind IS NULL OR kind = @kind)
         AND NOT (kind = 'offer' AND valid_until IS NOT NULL AND valid_until <= @now)
         AND (@kind IS NULL OR coalesce(valid_from, sent_at) <= @now)`,
      { kind: kind ?? null, now },
    );
    const posts = loadPosts(t, rows.map((r) => r.id), { withStats: false, showPrices: !!f.org.customer_prices, offerPrices: !!f.org.customer_offer_prices, hideArchived: true, publicAudience: true, locale: readerLocale(c, f.org.default_locale) });
    for (const full of posts) {
      const reach = postShops(t, full, f.topology).filter((s) => f.shops.includes(s));
      if (!reach.length) continue;
      const post = { ...full, authorId: '', authorName: null, approvedBy: null, recipientsCount: null, stats: null };
      items.push({
        post,
        orgName: f.org.name,
        shopNames: reach.map((s) => f.shopNames[s] ?? s),
        sortKey: kind === 'offer' ? (post.validUntil ?? Number.MAX_SAFE_INTEGER) : -(post.sentAt ?? 0),
      });
    }
  }
  return items.sort((a, b) => a.sortKey - b.sortKey).map(({ sortKey: _k, ...rest }) => rest);
}

// org by slug, if the merchant lets this caller see the catalog
export function catalogOrg(db: Db, slug: string, userId: string | null): { org: OrgRow; viewer: string[] } {
  const org = platform(db).get<OrgRow>(`SELECT ${ORG_COLUMNS} FROM organizations WHERE slug = @s AND archived_at IS NULL`, { s: slug });
  if (!org) throw notFound('organization');
  const f = userId ? followingOf(db, userId).find((x) => x.org.id === org.id) : undefined;
  const viewer = f?.customerIds ?? [];
  if (org.customer_catalog === 'off') throw forbidden('catalog is off');
  if (org.customer_catalog === 'subscribers' && !f?.shops.length) throw forbidden('catalog is for followers');
  return { org, viewer };
}

export function catalogIds(db: Db, orgId: string, q?: string, categoryId?: string): string[] {
  const t = new Tenant(db, orgId);
  const s = q ? searchClause(db, 'products', 'search_key', 'rowid', q) : { sql: '1=1', params: [] };
  return t
    .all<{ id: string }>(
      `SELECT id FROM products WHERE org_id = @org AND archived_at IS NULL AND customer_visible = 1
         AND (@cat IS NULL OR category_id = @cat) AND ${s.sql} ORDER BY name`,
      { cat: categoryId ?? null },
      s.params,
    )
    .map((r) => r.id);
}

export function customerRoutes(app: Hono<AppEnv>) {
  app.use('/v1/c/*', requireAuth);

  app.get('/v1/c/feed', (c) => {
    const offset = decodeCursor(c.req.query('cursor'));
    const limit = clampLimit(c.req.query('limit'), 20, 50);
    const all = feedItems(c);
    return c.json(page(all.slice(offset, offset + limit + 1), offset, limit));
  });

  app.get('/v1/c/offers', (c) => c.json(feedItems(c, 'offer')));

  app.get('/v1/c/shops', (c) => {
    const db = cfgOf(c).db;
    return c.json(
      followingOf(db, c.get('user').id).flatMap((f) =>
        loadShops(new Tenant(db, f.org.id), f.shops).map((s) => ({ ...s, orgName: f.org.name })),
      ),
    );
  });

  app.get('/v1/c/orgs/:slug/catalog', (c) => {
    const db = cfgOf(c).db;
    const { org, viewer } = catalogOrg(db, c.req.param('slug'), c.get('user').id);
    const ids = catalogIds(db, org.id, c.req.query('q'), c.req.query('categoryId'));
    return c.json(storefrontProducts(db, org, ids, { locale: readerLocale(c, org.default_locale), viewerCustomerIds: viewer, now: nowOf(c) }));
  });

  app.get('/v1/c/orgs/:slug/products/:id', (c) => {
    const db = cfgOf(c).db;
    const { org, viewer } = catalogOrg(db, c.req.param('slug'), c.get('user').id);
    const [p] = storefrontProducts(db, org, [c.req.param('id')], { locale: readerLocale(c, org.default_locale), viewerCustomerIds: viewer, now: nowOf(c) });
    if (!p) throw notFound('product');
    return c.json(p);
  });
}
