// public endpoints, no login, rate limited: join page, shelf product page, public catalog

import type { Hono } from 'hono';
import { normalizeBarcode, type JoinPage } from '@custock/core';
import type { AppEnv, OrgRow } from '../types';
import { categoryNameSql, cfgOf, nowOf, optionalAuth, ORG_COLUMNS, readerLocale } from '../lib/context';
import { forbidden, notFound } from '../lib/problem';
import { rateLimit } from '../lib/ratelimit';
import { platform, Tenant } from '../lib/tenant';
import { fileUrl } from '../services/catalog';
import { storefrontProducts } from '../services/storefront';
import { catalogIds, followingOf } from './customer';
import { dayKey } from './reports';

export function publicRoutes(app: Hono<AppEnv>) {
  app.use('/v1/public/*', rateLimit({ windowMs: 60_000, max: 120, prefix: 'public' }), optionalAuth);

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
      interests: t
        .all<{ id: string; parent_id: string | null; name: string }>(
          `SELECT c.id, c.parent_id, ${categoryNameSql('c')} AS name FROM categories c WHERE c.org_id = @org AND c.parent_id IS NULL AND c.archived_at IS NULL ORDER BY c.sort`,
          { loc: readerLocale(c, org.default_locale) },
        )
        .map((x) => ({ id: x.id, parentId: x.parent_id, name: x.name })),
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
    const user = c.get('user');
    const viewer = user ? followingOf(db, user.id).find((f) => f.org.id === org.id)?.customerIds ?? [] : [];
    const [p] = storefrontProducts(db, org, [hit.product_id], { locale: readerLocale(c, org.default_locale), viewerCustomerIds: viewer, now: nowOf(c) });
    if (!p) throw notFound('product');
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
}
