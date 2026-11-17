// product loading shared by staff, customer and public endpoints

import type { Product, StockLevel, Uom } from '@custock/core';
import type { Tenant } from '../lib/tenant';
import { parseJson } from '../lib/tenant';

// where files stored by the api itself are served from (dev uploads). set from the config.
let fileBase = 'http://localhost:8787';
export function setFileBase(base: string | undefined) {
  if (base) fileBase = base.replace(/\/$/, '');
}

export function fileUrl(storageKey: string | null | undefined): string | null {
  if (!storageKey) return null;
  if (/^https?:\/\//.test(storageKey)) return storageKey;
  // object storage keys get the public bucket url once storage is wired
  return `${fileBase}/files/${storageKey}`;
}

// the storage key behind one of our own upload urls, or null
export function uploadKeyFromUrl(url: string): string | null {
  const prefix = `${fileBase}/files/`;
  if (!url.startsWith(prefix)) return null;
  const key = url.slice(prefix.length);
  return /^uploads\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp)$/.test(key) ? key : null;
}

interface ProductRow {
  id: string;
  category_id: string | null;
  category_name: string | null;
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
}

export type ProductWithLevels = Product & { levels: StockLevel[] };

export function loadProducts(t: Tenant, ids: string[], opts: LoadOpts): ProductWithLevels[] {
  if (!ids.length) return [];
  const products = t.all<ProductRow>(
    `SELECT p.id, p.category_id,
            coalesce((SELECT ctr.name FROM category_translations ctr WHERE ctr.category_id = c.id AND ctr.locale = @loc), c.name) AS category_name, p.name, p.description, p.brand, p.uom, p.tax_rate_bp,
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
  const levels = opts.levelShops.length ? loadLevels(t, variantIds, opts.levelShops) : [];

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

export function loadLevels(t: Tenant, variantIds: string[], shopIds: string[]): StockLevel[] {
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
  return rows.map((r) => ({
    shopId: r.shop_id,
    variantId: r.variant_id,
    onHand: r.on_hand,
    inTransitIn: r.in_transit_in,
    reorderPoint: r.reorder_point,
    lastMovementAt: r.last_movement_at,
    waiting: waiting.filter((w) => w.variant_id === r.variant_id && (w.shop_id === r.shop_id || w.shop_id === null)).reduce((a, w) => a + w.n, 0),
  }));
}

// a readable variant name: product name plus option labels in the asked language
export function variantLabel(productName: string, options: string | null, locale = 'el'): string {
  const o = parseJson<Record<string, string> | null>(options, null);
  if (!o) return productName;
  const label = o[locale] ?? o.el ?? Object.values(o).join(' ');
  return `${productName} · ${label}`;
}
