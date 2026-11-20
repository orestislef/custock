// me/context, org settings, shops, groups, categories

import type { Hono } from 'hono';
import { can, type MeContext, type OrgSettings, type Shop } from '@custock/core';
import { readHours } from '../lib/shop-hours';
import type { Db } from '@custock/db';
import type { AppEnv, OrgRow } from '../types';
import { buildContextFor, categoryNameSql, cfgOf, orgOf, preloadContexts, readerLocale, requireAuth } from '../lib/context';
import { ApiProblem } from '../lib/problem';
import { platform, Tenant } from '../lib/tenant';
import { isSuperadmin, platformSettings, storageUse } from '../lib/platform-access';
import { avatarUrlOf, fileUrl } from '../services/catalog';
import { CATEGORY_PICTURE_SQL, pictureOf } from './categories';

export function orgSettings(db: Db, org: OrgRow): OrgSettings {
  const logo = org.logo_file_id ? platform(db).get<{ storage_key: string }>('SELECT storage_key FROM files WHERE id = @id', { id: org.logo_file_id }) : undefined;
  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    country: org.country,
    currency: org.currency,
    timezone: org.timezone,
    defaultLocale: org.default_locale,
    brandColor: org.brand_color,
    logoUrl: fileUrl(logo?.storage_key),
    allowNegativeStock: !!org.allow_negative_stock,
    postsNeedApproval: !!org.posts_need_approval,
    pushDailyCap: org.push_daily_cap,
    quietHours: org.quiet_hours,
    customerCatalog: org.customer_catalog,
    customerPrices: !!org.customer_prices,
    customerStock: org.customer_stock,
    fewLeftThreshold: org.few_left_threshold,
    customerOrders: org.customer_orders,
  };
}

interface ShopRow {
  id: string;
  name: string;
  slug: string;
  city: string | null;
  address: string | null;
  phone: string | null;
  timezone: string | null;
  storage_key: string | null;
  customer_visible: number;
  customer_stock: Shop['customerStock'];
  customer_orders: 'off' | null;
  opening_hours: string | null;
}

export function loadShops(t: Tenant, onlyIds?: string[]): Shop[] {
  const rows = t.all<ShopRow>(
    `SELECT s.id, s.name, s.slug, s.city, s.address, s.phone, s.timezone, f.storage_key, s.customer_visible, s.customer_stock, s.customer_orders, s.opening_hours
       FROM shops s LEFT JOIN files f ON f.id = s.image_file_id
      WHERE s.org_id = @org AND s.archived_at IS NULL ORDER BY s.created_at, s.name`,
  );
  const groups = t.all<{ shop_id: string; group_id: string }>('SELECT shop_id, group_id FROM shop_group_shops WHERE org_id = @org');
  return rows
    .filter((r) => !onlyIds || onlyIds.includes(r.id))
    .map((r) => ({
      id: r.id,
      orgId: t.orgId,
      name: r.name,
      slug: r.slug,
      city: r.city,
      address: r.address,
      phone: r.phone,
      timezone: r.timezone,
      imageUrl: fileUrl(r.storage_key),
      customerVisible: !!r.customer_visible,
      customerStock: r.customer_stock,
      customerOrders: r.customer_orders,
      hours: readHours(r.opening_hours),
      groupIds: groups.filter((g) => g.shop_id === r.id).map((g) => g.group_id),
    }));
}

export function orgRoutes(app: Hono<AppEnv>) {
  app.get('/v1/me/context', requireAuth, (c) => {
    const user = c.get('user');
    const db = cfgOf(c).db;
    const p = platform(db);
    const memberships = p.all<{ org_id: string }>(
      `SELECT m.org_id FROM memberships m JOIN organizations o ON o.id = m.org_id
        WHERE m.user_id = @u AND m.status = 'active' AND o.archived_at IS NULL ORDER BY m.joined_at`,
      { u: user.id },
    );
    // a super admin sees every business: their own first, then the rest by name
    const superadmin = isSuperadmin(db, user.id);
    const orgIds = memberships.map((m) => m.org_id);
    if (superadmin) {
      for (const o of p.all<{ id: string }>('SELECT id FROM organizations WHERE archived_at IS NULL ORDER BY name COLLATE NOCASE')) {
        if (!orgIds.includes(o.id)) orgIds.push(o.id);
      }
    }
    const pre = preloadContexts(db, orgIds, user.id);
    const orgs = orgIds.map((id) => buildContextFor(db, id, user.id, pre)).filter((x) => x !== null).map((x) => x.access);
    const following = p.all<{ org_id: string; org_name: string; org_slug: string; customer_id: string }>(
      `SELECT c.org_id, o.name AS org_name, o.slug AS org_slug, c.id AS customer_id FROM customers c JOIN organizations o ON o.id = c.org_id
        WHERE c.user_id = @u AND c.erased_at IS NULL AND o.archived_at IS NULL`,
      { u: user.id },
    );
    const body: MeContext = {
      user: { id: user.id, email: user.email, displayName: user.displayName, locale: user.locale, avatarUrl: avatarUrlOf(db, user.id) },
      orgs,
      following: following.map((f) => ({ orgId: f.org_id, orgName: f.org_name, orgSlug: f.org_slug, customerId: f.customer_id })),
      platformRole: superadmin ? 'superadmin' : null,
      ...(superadmin
        ? {
            platformPaused: Object.entries(platformSettings(db)).filter(([k, on]) => on && k.startsWith('pause_')).map(([k]) => k),
            storagePercent: storageUse(db).percent,
          }
        : {}),
    };
    return c.json(body);
  });

  // any member can read the org settings, editing needs org.settings.manage (stage 2)
  app.get('/v1/orgs/:org', (c) => c.json(orgSettings(cfgOf(c).db, orgOf(c).org)));

  // members see the shops they work in, org wide roles see all
  // the caller's own shops. ?all=1 lists every shop of the org, so someone who sends transfers can
  // pick a destination outside their own shops. it needs stock.transfer.send somewhere.
  app.get('/v1/orgs/:org/shops', (c) => {
    const { t, access } = orgOf(c);
    const all = c.req.query('all');
    if (all === '1' || all === 'true') {
      if (!can(access, 'stock.transfer.send')) throw new ApiProblem(403, 'forbidden', 'needs stock.transfer.send at some shop');
      return c.json(loadShops(t));
    }
    return c.json(loadShops(t, access.shops.map((s) => s.shopId)));
  });

  app.get('/v1/orgs/:org/groups', (c) => {
    const { topology, groupNames, access } = orgOf(c);
    const mine = new Set(access.shops.map((s) => s.shopId));
    return c.json(
      Object.entries(topology.groups)
        .filter(([, shops]) => shops.some((s) => mine.has(s)))
        .map(([id, shopIds]) => ({ id, name: groupNames[id] ?? id, shopIds: [...shopIds] })),
    );
  });

  app.get('/v1/orgs/:org/categories', (c) => {
    const { t, org, access } = orgOf(c);
    const rows = t.all<{ id: string; parent_id: string | null; name: string; base: string; icon_key: string | null; image_key: string | null }>(
      `SELECT c.id, c.parent_id, ${categoryNameSql('c')} AS name, c.name AS base, ${CATEGORY_PICTURE_SQL('c')} FROM categories c WHERE c.org_id = @org AND c.archived_at IS NULL ORDER BY c.sort, c.name`,
      { loc: readerLocale(c, org.default_locale) },
    );
    // people who manage categories also get every language, for renaming
    const manage = can(access, 'categories.manage');
    const tr = manage && rows.length
      ? t.all<{ category_id: string; locale: string; name: string }>(
          'SELECT tr.category_id, tr.locale, tr.name FROM category_translations tr JOIN categories c ON c.id = tr.category_id WHERE c.org_id = @org AND tr.category_id IN (SELECT value FROM json_each(@ids))',
          { ids: JSON.stringify(rows.map((r) => r.id)) },
        )
      : [];
    return c.json(
      rows.map((r) => ({
        id: r.id,
        parentId: r.parent_id,
        name: r.name,
        ...pictureOf(r),
        ...(manage ? { names: { [org.default_locale]: r.base, ...Object.fromEntries(tr.filter((x) => x.category_id === r.id).map((x) => [x.locale, x.name])) } } : {}),
      })),
    );
  });
}
