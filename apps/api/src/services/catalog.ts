// product loading shared by staff, customer and public endpoints

import type { Db } from '@custock/db';
import type { Product, StockLevel, Uom } from '@custock/core';
import type { Tenant } from '../lib/tenant';
import { parseJson } from '../lib/tenant';

// where files stored by the api itself are served from (local uploads), and the public address of
// the bucket (s3). both set from the config.
let fileBase = 'http://localhost:8787';
let bucketBase: string | null = null;
export function setFileBase(base: string | undefined) {
  if (base) fileBase = base.replace(/\/$/, '');
}
export function setBucketBase(base: string | null | undefined) {
  bucketBase = base ? base.replace(/\/$/, '') : null;
}

const LOCAL_KEY = /^uploads\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp)$/;
const BUCKET_KEY = /^orgs\/[0-9a-f-]{36}\/(products|posts|logos|shops)\/[0-9a-f-]{36}\.(jpg|png|webp)$/;

export function fileUrl(storageKey: string | null | undefined): string | null {
  if (!storageKey) return null;
  if (/^https?:\/\//.test(storageKey)) return storageKey;
  if (storageKey.startsWith('orgs/') || storageKey.startsWith('users/')) return `${bucketBase ?? `${fileBase}/files`}/${storageKey}`;
  return `${fileBase}/files/${storageKey}`;
}

// the storage key behind one of our own upload urls (local or bucket), or null
export function uploadKeyFromUrl(url: string): string | null {
  const local = `${fileBase}/files/`;
  if (url.startsWith(local)) {
    const key = url.slice(local.length);
    return LOCAL_KEY.test(key) ? key : null;
  }
  if (bucketBase && url.startsWith(`${bucketBase}/`)) {
    const key = url.slice(bucketBase.length + 1);
    return BUCKET_KEY.test(key) ? key : null;
  }
  return null;
}

interface ProductRow {
  id: string;
  category_id: string | null;
  category_name: string | null;
  category_icon: string | null;
  name: string;
  description: string | null;
  brand: string | null;
  uom: Uom;
  tax_rate_bp: number;
  track_stock: number;
  customer_visible: number;
  customer_stock_hidden: number;
  archived_at: number | null;
}

interface VariantRow {
  id: string;
  product_id: string;
  sku: string | null;
  options: string | null;
  price_minor: number | null;
  cost_minor: number | null;
  is_default: number;
}

export interface LoadOpts {
  withCost: boolean;
  // shops whose stock levels to include, empty for none
  levelShops: string[];
  // the reader's language for displayName and categoryName
  locale?: string;
  // customer facing: name itself in the reader's language (staff keep the default name to edit)
  localizeName?: boolean;
  // staff views: every shop in levelShops gets a level per variant, 0 when nothing moved there yet
  fillLevels?: boolean;
}

export type ProductWithLevels = Product & { levels: StockLevel[] };

export function loadProducts(t: Tenant, ids: string[], opts: LoadOpts): ProductWithLevels[] {
  if (!ids.length) return [];
  const products = t.all<ProductRow>(
    `SELECT p.id, p.category_id,
            coalesce((SELECT ctr.name FROM category_translations ctr WHERE ctr.category_id = c.id AND ctr.locale = @loc), c.name) AS category_name, c.icon_key AS category_icon, p.name, p.description, p.brand, p.uom, p.tax_rate_bp,
            p.track_stock, p.customer_visible, p.customer_stock_hidden, p.archived_at
       FROM products p LEFT JOIN categories c ON c.id = p.category_id AND c.org_id = p.org_id
      WHERE p.org_id = @org AND p.id IN (SELECT value FROM json_each(@ids))`,
    { ids, loc: opts.locale ?? '' },
  );
  const variants = t.all<VariantRow>(
    `SELECT id, product_id, sku, options, price_minor, cost_minor, is_default FROM product_variants
      WHERE org_id = @org AND archived_at IS NULL AND product_id IN (SELECT value FROM json_each(@ids)) ORDER BY sort, created_at`,
    { ids },
  );
  const variantIds = variants.map((v) => v.id);
  const barcodes = t.all<{ id: string; variant_id: string; code: string; code_norm: string; symbology: string | null; pack_qty: number }>(
    `SELECT id, variant_id, code, code_norm, symbology, pack_qty FROM barcodes
      WHERE org_id = @org AND variant_id IN (SELECT value FROM json_each(@vids)) ORDER BY created_at`,
    { vids: variantIds },
  );
  const images = t.all<{ id: string; product_id: string; storage_key: string; width: number | null; height: number | null }>(
    `SELECT i.id, i.product_id, f.storage_key, f.width, f.height FROM product_images i JOIN files f ON f.id = i.file_id
      WHERE i.org_id = @org AND f.deleted_at IS NULL AND i.product_id IN (SELECT value FROM json_each(@ids)) ORDER BY i.sort`,
    { ids },
  );
  const translations = t.all<{ product_id: string; locale: string; name: string; description: string | null }>(
    `SELECT tr.product_id, tr.locale, tr.name, tr.description FROM product_translations tr JOIN products p ON p.id = tr.product_id
      WHERE p.org_id = @org AND tr.product_id IN (SELECT value FROM json_each(@ids))`,
    { ids },
  );
  const levels = opts.levelShops.length ? loadLevels(t, variantIds, opts.levelShops, opts.fillLevels) : [];

  const byProduct = <T extends { product_id: string }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) m.set(r.product_id, [...(m.get(r.product_id) ?? []), r]);
    return m;
  };
  const vByP = byProduct(variants);
  const iByP = byProduct(images);
  const trByP = byProduct(translations);
  const bByV = new Map<string, typeof barcodes>();
  for (const b of barcodes) bByV.set(b.variant_id, [...(bByV.get(b.variant_id) ?? []), b]);
  const lByV = new Map<string, StockLevel[]>();
  for (const l of levels) lByV.set(l.variantId, [...(lByV.get(l.variantId) ?? []), l]);

  const order = new Map(ids.map((id, i) => [id, i]));
  return products
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
    .map((p) => {
      const vs = vByP.get(p.id) ?? [];
      const tr = trByP.get(p.id) ?? [];
      const localized = opts.locale ? tr.find((x) => x.locale === opts.locale) : undefined;
      const product: ProductWithLevels = {
        id: p.id,
        orgId: t.orgId,
        categoryId: p.category_id,
        categoryName: p.category_name,
        categoryIconKey: p.category_icon,
        name: opts.localizeName ? localized?.name ?? p.name : p.name,
        displayName: localized?.name ?? p.name,
        description: opts.localizeName ? localized?.description ?? p.description : p.description,
        brand: p.brand,
        uom: p.uom,
        taxRateBp: p.tax_rate_bp,
        trackStock: !!p.track_stock,
        customerVisible: !!p.customer_visible,
        customerStockHidden: !!p.customer_stock_hidden,
        images: (iByP.get(p.id) ?? []).map((i) => ({ id: i.id, url: fileUrl(i.storage_key)!, width: i.width, height: i.height })),
        variants: vs.map((v) => ({
          id: v.id,
          productId: p.id,
          sku: v.sku,
          options: parseJson<Record<string, string> | null>(v.options, null),
          priceMinor: v.price_minor,
          ...(opts.withCost ? { costMinor: v.cost_minor } : {}),
          isDefault: !!v.is_default,
          barcodes: (bByV.get(v.id) ?? []).map((b) => ({ id: b.id, code: b.code, codeNorm: b.code_norm, symbology: b.symbology, packQty: b.pack_qty })),
        })),
        translations: Object.fromEntries(tr.map((x) => [x.locale, { name: x.name, description: x.description }])),
        archivedAt: p.archived_at,
        levels: vs.flatMap((v) => lByV.get(v.id) ?? []),
      };
      return product;
    });
}

// stock_levels only has a row once something moved in a shop. with fill, a variant that never had
// stock in one of the shops still gets a level there, at 0, so staff see every shop they work in.
export function loadLevels(t: Tenant, variantIds: string[], shopIds: string[], fill = false): StockLevel[] {
  if (!variantIds.length || !shopIds.length) return [];
  const rows = t.all<{ shop_id: string; variant_id: string; on_hand: number; in_transit_in: number; last_movement_at: number | null; reorder_point: number | null }>(
    `SELECT l.shop_id, l.variant_id, l.on_hand, l.in_transit_in, l.last_movement_at, s.reorder_point
       FROM stock_levels l
       LEFT JOIN shop_variant_settings s ON s.shop_id = l.shop_id AND s.variant_id = l.variant_id
      WHERE l.org_id = @org AND l.variant_id IN (SELECT value FROM json_each(@vids)) AND l.shop_id IN (SELECT value FROM json_each(@shops))`,
    { vids: variantIds, shops: shopIds },
  );
  const waiting = t.all<{ variant_id: string; shop_id: string | null; n: number }>(
    `SELECT variant_id, shop_id, count(*) AS n FROM stock_alerts
      WHERE org_id = @org AND status = 'waiting' AND variant_id IN (SELECT value FROM json_each(@vids))
      GROUP BY variant_id, shop_id`,
    { vids: variantIds },
  );
  const waitingFor = (variantId: string, shopId: string) =>
    waiting.filter((w) => w.variant_id === variantId && (w.shop_id === shopId || w.shop_id === null)).reduce((a, w) => a + w.n, 0);
  const out: StockLevel[] = rows.map((r) => ({
    shopId: r.shop_id,
    variantId: r.variant_id,
    onHand: r.on_hand,
    inTransitIn: r.in_transit_in,
    reorderPoint: r.reorder_point,
    lastMovementAt: r.last_movement_at,
    waiting: waitingFor(r.variant_id, r.shop_id),
  }));
  if (!fill) return out;
  const have = new Set(rows.map((r) => `${r.variant_id}:${r.shop_id}`));
  const visible = t.all<{ id: string }>(
    `SELECT id FROM shops WHERE org_id = @org AND archived_at IS NULL AND id IN (SELECT value FROM json_each(@shops)) ORDER BY name`,
    { shops: shopIds },
  ).map((s) => s.id);
  const missing = variantIds.flatMap((v) => visible.filter((s) => !have.has(`${v}:${s}`)).map((s) => ({ v, s })));
  if (!missing.length) return out;
  const points = new Map(
    t.all<{ shop_id: string; variant_id: string; reorder_point: number | null }>(
      `SELECT shop_id, variant_id, reorder_point FROM shop_variant_settings
        WHERE org_id = @org AND variant_id IN (SELECT value FROM json_each(@vids)) AND shop_id IN (SELECT value FROM json_each(@shops))`,
      { vids: variantIds, shops: shopIds },
    ).map((r) => [`${r.variant_id}:${r.shop_id}`, r.reorder_point]),
  );
  for (const { v, s } of missing) {
    out.push({ shopId: s, variantId: v, onHand: 0, inTransitIn: 0, reorderPoint: points.get(`${v}:${s}`) ?? null, lastMovementAt: null, waiting: waitingFor(v, s) });
  }
  return out;
}

// a readable variant name: product name plus option labels in the asked language
export function variantLabel(productName: string, options: string | null, locale = 'el'): string {
  const o = parseJson<Record<string, string> | null>(options, null);
  if (!o) return productName;
  const label = o[locale] ?? o.el ?? Object.values(o).join(' ');
  return `${productName} · ${label}`;
}

// the profile photo of a person, or null for the initials
export function avatarUrlOf(db: Db, userId: string | null | undefined): string | null {
  if (!userId) return null;
  const row = db.prepare(
    'SELECT f.storage_key AS k FROM users u JOIN files f ON f.id = u.avatar_file_id AND f.deleted_at IS NULL WHERE u.id = ?',
  ).get(userId) as { k: string } | undefined;
  return fileUrl(row?.k);
}

// sql for a select list: the storage key of the profile photo of the user in column userCol
export function avatarKeySql(userCol: string): string {
  return `(SELECT f.storage_key FROM users au JOIN files f ON f.id = au.avatar_file_id AND f.deleted_at IS NULL WHERE au.id = ${userCol})`;
}

// the business's logo, or null when it has none
export function orgLogoUrl(db: Db, orgId: string): string | null {
  const row = db.prepare(
    'SELECT f.storage_key AS k FROM organizations o JOIN files f ON f.id = o.logo_file_id AND f.deleted_at IS NULL WHERE o.id = ?',
  ).get(orgId) as { k: string } | undefined;
  return fileUrl(row?.k);
}
