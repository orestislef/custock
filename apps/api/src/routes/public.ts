// public endpoints, no login, rate limited: join page, shelf product page, public catalog

import type { Hono } from 'hono';
import { normalizeBarcode, type Audience, type FeedItem, type JoinPage, type PublicProduct, type PublicShop } from '@custock/core';
import type { Db } from '@custock/db';
import { readHours } from '../lib/shop-hours';
import type { AppEnv, OrgRow } from '../types';
import { categoryNameSql, cfgOf, loadTopology, nowOf, optionalAuth, ORG_COLUMNS, readerLocale } from '../lib/context';
import { forbidden, notFound } from '../lib/problem';
import { rateLimit } from '../lib/ratelimit';
import { policyNumber } from '../lib/policy';
import { clampLimit, decodeCursor, page, parseJson, platform, Tenant } from '../lib/tenant';
import { orgFeatureOn } from '../lib/platform-access';
import { loadPosts, postShops } from '../services/posts';
import { fileUrl } from '../services/catalog';
import { CATEGORY_PICTURE_SQL, pictureOf } from './categories';
import { storefrontProducts } from '../services/storefront';
import { catalogIds, followingOf } from './customer';
import { dayKey } from './reports';
import { orderOptions } from '../services/orders';

// a product as a visitor who does not follow a followers only business sees it on the shelf page
export function shelfTeaser(p: PublicProduct): PublicProduct {
  return { ...p, priceMinor: null, offer: null, availability: [], waitingForIt: false, saved: false };
}

// the shops of a business that customers see, with their hours in the shop's time zone
function publicShops(db: Db, org: OrgRow): PublicShop[] {
  return new Tenant(db, org.id).all<{ id: string; name: string; address: string | null; city: string | null; phone: string | null; timezone: string | null; opening_hours: string | null }>(
    `SELECT id, name, address, city, phone, timezone, opening_hours FROM shops WHERE org_id = @org AND archived_at IS NULL AND customer_visible = 1 ORDER BY created_at, name`,
  ).map(({ timezone, opening_hours, ...s }) => ({ ...s, timezone: timezone || org.timezone, hours: readHours(opening_hours) }));
}

// a post narrowed to some customers (tags, interests, languages, saved products, new followers)
// stays with the followers it was meant for
function targeted(raw: string): boolean {
  const a = parseJson<Partial<Audience>>(raw, {});
  return !!(a.tags?.length || a.interests?.length || a.locales?.length || a.savedAnyLinked || a.joinedWithinDays != null);
}

// the posts a visitor sees: sent, in the feed, not an ended offer, reaching a shop customers see.
// no audience, author or numbers; products only when the catalog is open to everyone
function publicFeed(db: Db, org: OrgRow, now: number, locale: string): FeedItem[] {
  const t = new Tenant(db, org.id);
  const rows = t.all<{ id: string; audience: string }>(
    `SELECT id, audience FROM posts WHERE org_id = @org AND status = 'sent' AND deleted_at IS NULL
       AND EXISTS (SELECT 1 FROM json_each(posts.channels) WHERE value = 'feed')
       AND NOT (kind = 'offer' AND valid_until IS NOT NULL AND valid_until <= @now)
     ORDER BY sent_at DESC LIMIT 500`,
    { now },
  );
  const ids = rows.filter((r) => !targeted(r.audience)).map((r) => r.id);
  const { topology, shopNames } = loadTopology(db, org.id);
  const visible = new Set(t.all<{ id: string }>('SELECT id FROM shops WHERE org_id = @org AND customer_visible = 1 AND archived_at IS NULL').map((s) => s.id));
  const withProducts = org.customer_catalog === 'public';
  const out: FeedItem[] = [];
  const posts = loadPosts(t, ids, { withStats: false, showPrices: !!org.customer_prices, offerPrices: !!org.customer_offer_prices, hideArchived: true, publicAudience: true, locale });
  for (const full of posts) {
    const reach = postShops(t, full, topology).filter((s) => visible.has(s));
    if (!reach.length) continue;
    // the reader's language and the post's own, for when it was not written in theirs
    const translations = Object.fromEntries(Object.entries(full.translations).filter(([l]) => l === locale || l === full.defaultLocale));
    out.push({
      post: { ...full, translations, products: withProducts ? full.products : [], audience: { ...full.audience, scopes: [] }, authorId: '', authorName: null, approvedBy: null, recipientsCount: null, stats: null },
      orgName: org.name,
      shopNames: reach.map((s) => shopNames[s] ?? s),
    });
  }
  return out;
}

export function publicRoutes(app: Hono<AppEnv>) {
  app.use('/v1/public/*', rateLimit({ windowMs: 60_000, max: (c) => policyNumber(cfgOf(c).db, 'rate.publicPerMinute'), prefix: 'public' }), optionalAuth);

  app.get('/v1/public/join/:code', (c) => {
    const db = cfgOf(c).db;
    const link = platform(db).get<{ id: string; org_id: string; scope_type: 'org' | 'group' | 'shop'; scope_id: string; disabled_at: number | null; expires_at: number | null }>(
      'SELECT id, org_id, scope_type, scope_id, disabled_at, expires_at FROM join_links WHERE code = @code',
      { code: c.req.param('code') },
    );
    if (!link) throw notFound('join link');
    const t = new Tenant(db, link.org_id);
    const org = t.get<OrgRow & { logo_key: string | null }>(
      `SELECT ${ORG_COLUMNS.split(',').map((x) => 'o.' + x.trim()).join(', ')}, f.storage_key AS logo_key
         FROM organizations o LEFT JOIN files f ON f.id = o.logo_file_id WHERE o.id = @org`,
    )!;
    const now = nowOf(c);
    let scopeName = org.name;
    let imageKey: string | null = null;
    if (link.scope_type === 'shop') {
      const s = t.get<{ name: string; storage_key: string | null }>(
        'SELECT s.name, f.storage_key FROM shops s LEFT JOIN files f ON f.id = s.image_file_id WHERE s.org_id = @org AND s.id = @id',
        { id: link.scope_id },
      );
      scopeName = s ? `${org.name} ${s.name}` : org.name;
      imageKey = s?.storage_key ?? null;
    } else if (link.scope_type === 'group') {
      const g = t.get<{ name: string }>('SELECT name FROM shop_groups WHERE org_id = @org AND id = @id', { id: link.scope_id });
      scopeName = g ? `${org.name} ${g.name}` : org.name;
    }
    if (!imageKey) {
      imageKey = t.get<{ storage_key: string | null }>(
        'SELECT f.storage_key FROM shops s JOIN files f ON f.id = s.image_file_id WHERE s.org_id = @org ORDER BY s.created_at LIMIT 1',
      )?.storage_key ?? null;
    }
    const disabled = !!link.disabled_at || (link.expires_at != null && link.expires_at < now);
    if (!disabled) {
      t.run(
        `INSERT INTO join_link_stats_daily (org_id, join_link_id, day, opens) VALUES (@org, @l, @d, 1)
         ON CONFLICT (join_link_id, day) DO UPDATE SET opens = opens + 1`,
        { l: link.id, d: dayKey(now, org.timezone) },
      );
    }
    const body: JoinPage = {
      code: c.req.param('code'),
      orgSlug: org.slug,
      orgName: org.name,
      scopeName,
      scopeType: link.scope_type,
      brandColor: org.brand_color,
      logoUrl: fileUrl(org.logo_key),
      imageUrl: fileUrl(imageKey),
      disabled,
      pushDailyCap: org.push_daily_cap,
      quietHours: org.quiet_hours,
      interests: t
        .all<{ id: string; parent_id: string | null; name: string; icon_key: string | null; image_key: string | null }>(
          `SELECT c.id, c.parent_id, ${categoryNameSql('c')} AS name, ${CATEGORY_PICTURE_SQL('c')} FROM categories c WHERE c.org_id = @org AND c.parent_id IS NULL AND c.archived_at IS NULL ORDER BY c.sort`,
          { loc: readerLocale(c, org.default_locale) },
        )
        .map((x) => ({ id: x.id, parentId: x.parent_id, name: x.name, ...pictureOf(x) })),
    };
    return c.json(body);
  });

  // shelf qr: /p/<code> or /p/<org slug>:<code> when the same barcode lives in two businesses
  app.get('/v1/public/p/:code', (c) => {
    const db = cfgOf(c).db;
    const raw = c.req.param('code');
    const sep = raw.indexOf(':');
    const slug = sep > 0 && !/^https?$/i.test(raw.slice(0, sep)) ? raw.slice(0, sep) : null;
    const code = slug ? raw.slice(sep + 1) : raw;
    const n = normalizeBarcode(code);
    const hit = platform(db).get<{ org_id: string; product_id: string }>(
      `SELECT b.org_id, v.product_id FROM barcodes b JOIN product_variants v ON v.id = b.variant_id JOIN organizations o ON o.id = b.org_id
        WHERE (b.code_norm = @n OR b.code = @raw) AND (@slug IS NULL OR o.slug = @slug) AND o.archived_at IS NULL
        ORDER BY o.created_at LIMIT 1`,
      { n: n.codeNorm, raw: n.code, slug },
    );
    if (!hit) throw notFound('product');
    const org = platform(db).get<OrgRow>(`SELECT ${ORG_COLUMNS} FROM organizations WHERE id = @id`, { id: hit.org_id })!;
    // the shelf page follows what the business shows customers: nothing when the catalog is off,
    // and for followers only, a visitor who does not follow sees the name and photos without
    // price or stock
    if (org.customer_catalog === 'off') throw notFound('product');
    const user = c.get('user');
    const viewer = user ? followingOf(db, user.id).find((f) => f.org.id === org.id)?.customerIds ?? [] : [];
    const [p] = storefrontProducts(db, org, [hit.product_id], { locale: readerLocale(c, org.default_locale), viewerCustomerIds: viewer, now: nowOf(c) });
    if (!p) throw notFound('product');
    if (org.customer_catalog !== 'public' && !viewer.length) return c.json(shelfTeaser(p));
    return c.json(p);
  });

  app.get('/v1/public/orgs/:slug/catalog', (c) => {
    const db = cfgOf(c).db;
    const org = platform(db).get<OrgRow>(`SELECT ${ORG_COLUMNS} FROM organizations WHERE slug = @s AND archived_at IS NULL`, { s: c.req.param('slug') });
    if (!org) throw notFound('organization');
    if (org.customer_catalog !== 'public') throw forbidden('catalog is not public');
    const ids = catalogIds(db, org.id, c.req.query('q'), c.req.query('categoryId'));
    return c.json(storefrontProducts(db, org, ids, { locale: readerLocale(c, org.default_locale), now: nowOf(c) }));
  });

  // what the business's pages need before a visitor has an account: its name and logo, whether the
  // catalog is open, and the join link for the whole business (the Join on its shop page), if any
  app.get('/v1/public/orgs/:slug', (c) => {
    const db = cfgOf(c).db;
    const org = platform(db).get<OrgRow>(`SELECT ${ORG_COLUMNS} FROM organizations WHERE slug = @s AND archived_at IS NULL`, { s: c.req.param('slug') });
    if (!org) throw notFound('organization');
    const link = new Tenant(db, org.id).get<{ code: string }>(
      `SELECT code FROM join_links WHERE org_id = @org AND scope_type = 'org' AND disabled_at IS NULL AND (expires_at IS NULL OR expires_at > @now)
        ORDER BY created_at LIMIT 1`,
      { now: nowOf(c) },
    );
    const logo = org.logo_file_id ? platform(db).get<{ storage_key: string }>('SELECT storage_key FROM files WHERE id = @id AND deleted_at IS NULL', { id: org.logo_file_id }) : undefined;
    const categories = org.customer_catalog === 'off'
      ? []
      : new Tenant(db, org.id)
          .all<{ id: string; name: string; icon_key: string | null; image_key: string | null }>(
            `SELECT c.id, ${categoryNameSql('c')} AS name, ${CATEGORY_PICTURE_SQL('c')} FROM categories c
              WHERE c.org_id = @org AND c.archived_at IS NULL
                AND EXISTS (SELECT 1 FROM products p WHERE p.org_id = c.org_id AND p.category_id = c.id AND p.archived_at IS NULL AND p.customer_visible = 1)
              ORDER BY c.sort, c.name`,
            { loc: readerLocale(c, org.default_locale) },
          )
          .map((x) => ({ id: x.id, name: x.name, ...pictureOf(x) }));
    return c.json({ slug: org.slug, name: org.name, catalog: org.customer_catalog, joinCode: link?.code ?? null, logoUrl: fileUrl(logo?.storage_key), timezone: org.timezone, quietHours: org.quiet_hours, pushDailyCap: org.push_daily_cap, categories, orders: orderOptions(db, org), shops: publicShops(db, org) });
  });

  // the shops customers can see: where, the phone and the opening hours (PublicShop)
  app.get('/v1/public/orgs/:slug/shops', (c) => {
    const db = cfgOf(c).db;
    const org = platform(db).get<OrgRow>(`SELECT ${ORG_COLUMNS} FROM organizations WHERE slug = @s AND archived_at IS NULL`, { s: c.req.param('slug') });
    if (!org) throw notFound('organization');
    return c.json(publicShops(db, org));
  });

  // the business's posts for everyone, when it chose so (policy catalog.news) and its catalog is not
  // off: what was sent and shows in the feed, newest first, never a draft, a scheduled or targeted one
  app.get('/v1/public/orgs/:slug/posts', (c) => {
    const db = cfgOf(c).db;
    const org = platform(db).get<OrgRow>(`SELECT ${ORG_COLUMNS} FROM organizations WHERE slug = @s AND archived_at IS NULL`, { s: c.req.param('slug') });
    if (!org || org.customer_news !== 'everyone' || org.customer_catalog === 'off' || !orgFeatureOn(db, org.id, 'posts')) throw notFound('posts');
    const offset = decodeCursor(c.req.query('cursor'));
    const limit = clampLimit(c.req.query('limit'), 20, 50);
    const all = publicFeed(db, org, nowOf(c), readerLocale(c, org.default_locale));
    return c.json(page(all.slice(offset, offset + limit + 1), offset, limit));
  });

  // whether the business takes orders, from which shops, and the limits (PublicOrderOptions)
  app.get('/v1/public/orgs/:slug/order-options', (c) => {
    const db = cfgOf(c).db;
    const org = platform(db).get<OrgRow>(`SELECT ${ORG_COLUMNS} FROM organizations WHERE slug = @s AND archived_at IS NULL`, { s: c.req.param('slug') });
    if (!org) throw notFound('organization');
    return c.json(orderOptions(db, org));
  });
}
