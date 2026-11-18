// what customers see of a product: the merchant decides catalog, prices and stock
// (thinking/06-customers-and-comms.md, "what customers see")

import type { Availability, CustomerStockMode, PublicProduct } from '@custock/core';
import type { Db } from '@custock/db';
import type { OrgRow } from '../types';
import { Tenant } from '../lib/tenant';
import { loadProducts } from './catalog';
import { wasPrice } from './posts';

interface ShopRow {
  id: string;
  name: string;
  customer_visible: number;
  customer_stock: CustomerStockMode | null;
}

export function availabilityState(onHand: number, mode: CustomerStockMode, fewLeft: number): Pick<Availability, 'state' | 'qty'> {
  if (mode === 'off') return { state: null, qty: null };
  const state = onHand <= 0 ? 'out' : onHand <= fewLeft ? 'few' : 'in';
  return { state, qty: mode === 'exact' ? Math.max(0, onHand) : null };
}

export function storefrontProducts(
  db: Db,
  org: OrgRow,
  productIds: string[],
  opts: { locale: string; viewerCustomerIds?: string[]; now: number },
): PublicProduct[] {
  const t = new Tenant(db, org.id);
  const shops = t.all<ShopRow>(
    'SELECT id, name, customer_visible, customer_stock FROM shops WHERE org_id = @org AND archived_at IS NULL ORDER BY created_at, name',
  ).filter((s) => s.customer_visible);
  const products = loadProducts(t, productIds, { withCost: false, levelShops: shops.map((s) => s.id), locale: opts.locale, localizeName: true });
  const viewer = opts.viewerCustomerIds ?? [];

  return products
    .filter((p) => p.customerVisible && !p.archivedAt)
    .map((p) => {
      const v = p.variants.find((x) => x.isDefault) ?? p.variants[0]!;
      const availability: Availability[] = shops.map((s) => {
        const mode: CustomerStockMode = !p.trackStock || p.customerStockHidden ? 'off' : (s.customer_stock ?? org.customer_stock);
        const onHand = p.levels.filter((l) => l.shopId === s.id && l.variantId === v.id).reduce((a, l) => a + l.onHand, 0);
        const shown = availabilityState(p.uom === 'piece' ? onHand : Math.floor(onHand / 1000), mode, org.few_left_threshold);
        return { shopId: s.id, shopName: s.name, ...shown };
      });
      const offerRow = t.get<{ post_id: string; offer_price_minor: number; valid_from: number | null; sent_at: number | null; valid_until: number | null }>(
        `SELECT pp.post_id, pp.offer_price_minor, po.valid_from, po.sent_at, po.valid_until
           FROM post_products pp JOIN posts po ON po.id = pp.post_id
          WHERE po.org_id = @org AND po.kind = 'offer' AND po.status = 'sent' AND po.deleted_at IS NULL
            AND pp.variant_id = @v AND pp.offer_price_minor IS NOT NULL
            AND coalesce(po.valid_from, po.sent_at) <= @now AND (po.valid_until IS NULL OR po.valid_until > @now)
          ORDER BY pp.offer_price_minor LIMIT 1`,
        { v: v.id, now: opts.now },
      );
      const prices = !!org.customer_prices;
      const waiting = viewer.length
        ? !!t.get("SELECT 1 FROM stock_alerts WHERE org_id = @org AND status = 'waiting' AND variant_id = @v AND customer_id IN (SELECT value FROM json_each(@c))", { v: v.id, c: viewer })
        : false;
      const saved = viewer.length
        ? !!t.get('SELECT 1 FROM customer_favorites WHERE org_id = @org AND product_id = @p AND customer_id IN (SELECT value FROM json_each(@c))', { p: p.id, c: viewer })
        : false;
      return {
        id: p.id,
        orgId: org.id,
        orgName: org.name,
        orgSlug: org.slug,
        timezone: org.timezone,
        name: p.name,
        description: p.description,
        images: p.images,
        categoryName: p.categoryName,
        categoryId: p.categoryId,
        categoryIconKey: p.categoryIconKey ?? null,
        priceMinor: prices ? v.priceMinor : null,
        currency: org.currency,
        offer: offerRow
          ? {
              postId: offerRow.post_id,
              priceMinor: offerRow.offer_price_minor,
              wasMinor: wasPrice(t, v.id, offerRow.valid_from ?? offerRow.sent_at ?? opts.now),
              validUntil: offerRow.valid_until,
            }
          : null,
        availability,
        variantId: v.id,
        waitingForIt: waiting,
        saved,
      };
    });
}
