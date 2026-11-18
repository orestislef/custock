// products, scan look up, unknown codes, the movement ledger (read side)

import type { Hono } from 'hono';
import { z } from 'zod';
import { normalizeBarcode, uuidv7, type Movement, type ScanResult } from '@custock/core';
import type { AppEnv } from '../types';
import { cfgOf, has, need, nowOf, orgOf, productNameSql, readerLocale, shopsFor } from '../lib/context';
import { notFound } from '../lib/problem';
import { clampLimit, decodeCursor, page } from '../lib/tenant';
import { loadProducts, variantLabel } from '../services/catalog';
import { searchClause } from '../services/search';
import { lowSql } from '../lib/low-stock';

export function catalogRoutes(app: Hono<AppEnv>) {
  app.get('/v1/orgs/:org/products', (c) => {
    need(c, 'products.view');
    const { t } = orgOf(c);
    const q = c.req.query();
    const limit = clampLimit(q.limit);
    const offset = decodeCursor(q.cursor);
    const stockShops = has(c, 'stock.view') ? shopsFor(c, 'stock.view', q.shopId || null) : [];
    const where: string[] = ['p.org_id = @org', 'p.archived_at IS NULL'];
    const named: Record<string, unknown> = { shops: stockShops };
    let positional: string[] = [];
    if (q.categoryId) {
      where.push('p.category_id = @cat');
      named.cat = q.categoryId;
    }
    if (q.q) {
      const s = searchClause(cfgOf(c).db, 'products', 'p.search_key', 'p.rowid', q.q);
      where.push(s.sql);
      positional = s.params;
    }
    const levelExists = (cond: string) => `EXISTS (
      SELECT 1 FROM product_variants v JOIN stock_levels l ON l.variant_id = v.id
      LEFT JOIN shop_variant_settings ss ON ss.shop_id = l.shop_id AND ss.variant_id = l.variant_id
      WHERE v.product_id = p.id AND v.archived_at IS NULL AND l.shop_id IN (SELECT value FROM json_each(@shops)) AND ${cond})`;
    switch (q.filter) {
      case 'low':
        where.push(levelExists(lowSql()));
        named.fewLeft = orgOf(c).org.few_left_threshold;
        break;
      case 'out':
        // a shop where it never arrived counts as out too, the same way the product page shows 0
        where.push('p.track_stock = 1', `EXISTS (
          SELECT 1 FROM product_variants v
          JOIN shops sh ON sh.org_id = p.org_id AND sh.archived_at IS NULL AND sh.id IN (SELECT value FROM json_each(@shops))
          LEFT JOIN stock_levels l ON l.variant_id = v.id AND l.shop_id = sh.id
          WHERE v.product_id = p.id AND v.archived_at IS NULL AND coalesce(l.on_hand, 0) = 0)`);
        break;
      case 'negative':
        where.push(levelExists('l.on_hand < 0'));
        break;
      case 'waiting':
        where.push(`EXISTS (SELECT 1 FROM product_variants v JOIN stock_alerts a ON a.variant_id = v.id WHERE v.product_id = p.id AND a.status = 'waiting')`);
        break;
    }
    const ids = t
      .all<{ id: string }>(`SELECT p.id FROM products p WHERE ${where.join(' AND ')} ORDER BY p.name LIMIT @lim OFFSET @off`, { ...named, lim: limit + 1, off: offset }, positional)
      .map((r) => r.id);
    const items = loadProducts(t, ids, { withCost: has(c, 'products.cost.view'), levelShops: stockShops, fillLevels: true, locale: readerLocale(c, orgOf(c).org.default_locale) });
    return c.json(page(items, offset, limit));
  });

  app.get('/v1/orgs/:org/products/:id', (c) => {
    need(c, 'products.view');
    const { t } = orgOf(c);
    const stockShops = has(c, 'stock.view') ? shopsFor(c, 'stock.view') : [];
    const [p] = loadProducts(t, [c.req.param('id')], { withCost: has(c, 'products.cost.view'), levelShops: stockShops, fillLevels: true, locale: readerLocale(c, orgOf(c).org.default_locale) });
    if (!p) throw notFound('product');
    const stamp = t.get<{ updated_at: number }>('SELECT updated_at FROM products WHERE org_id = @org AND id = @id', { id: p.id });
    if (stamp) c.header('ETag', `W/"p-${stamp.updated_at}"`);
    return c.json(p);
  });

  // a scan: normalise, look up, remember unknown codes for the manager
  app.post('/v1/orgs/:org/scan', async (c) => {
    need(c, 'products.view');
    const body = z.object({ code: z.string().min(1).max(500), symbology: z.string().optional(), shopId: z.string().optional() }).parse(await c.req.json());
    const { t, access } = orgOf(c);
    if (body.shopId && !access.shops.some((s) => s.shopId === body.shopId)) need(c, 'stock.view', body.shopId);
    const n = normalizeBarcode(body.code, body.symbology);
    const hit = t.get<{ variant_id: string; pack_qty: number; product_id: string; archived: number }>(
      `SELECT b.variant_id, b.pack_qty, v.product_id, (p.archived_at IS NOT NULL OR v.archived_at IS NOT NULL) AS archived
         FROM barcodes b JOIN product_variants v ON v.id = b.variant_id JOIN products p ON p.id = v.product_id
        WHERE b.org_id = @org AND (b.code_norm = @norm OR b.code = @raw) LIMIT 1`,
      { norm: n.codeNorm, raw: n.code },
    );
    if (!hit) {
      // a misread (a barcode whose check digit does not match) is not a code the shop is missing,
      // so it stays out of the unknown codes list and the home count
      if (body.shopId && n.valid) {
        const now = nowOf(c);
        const open = t.get<{ id: string }>('SELECT id FROM unknown_scans WHERE org_id = @org AND shop_id = @s AND code_norm = @n AND resolved_at IS NULL', { s: body.shopId, n: n.codeNorm });
        if (open) t.run('UPDATE unknown_scans SET times = times + 1, scanned_at = @now, scanned_by = @u WHERE org_id = @org AND id = @id', { now, u: c.get('user').id, id: open.id });
        else
          t.run(
            `INSERT INTO unknown_scans (id, org_id, shop_id, code, code_norm, symbology, scanned_by, scanned_at, times)
             VALUES (@id, @org, @s, @code, @n, @sym, @u, @now, 1)`,
            { id: uuidv7(now), s: body.shopId, code: n.code, n: n.codeNorm, sym: body.symbology ?? null, u: c.get('user').id, now },
          );
      }
      const res: ScanResult = { codeNorm: n.codeNorm, kind: n.kind, valid: n.valid, match: 'unknown', packQty: 1, product: null, variantId: null };
      return c.json(res);
    }
    const stockShops = has(c, 'stock.view') ? shopsFor(c, 'stock.view') : [];
    const [product] = loadProducts(t, [hit.product_id], { withCost: has(c, 'products.cost.view'), levelShops: stockShops, fillLevels: true, locale: readerLocale(c, orgOf(c).org.default_locale) });
    const res: ScanResult = {
      codeNorm: n.codeNorm, kind: n.kind, valid: n.valid, match: hit.archived ? 'archived' : 'variant', packQty: hit.pack_qty,
      product: product ?? null, variantId: hit.variant_id,
    };
    return c.json(res);
  });

  app.get('/v1/orgs/:org/unknown-scans', (c) => {
    if (!has(c, 'products.create') && !has(c, 'products.edit') && !has(c, 'stock.settings.manage')) need(c, 'products.create');
    const { t, access } = orgOf(c);
    const asked = c.req.query('shopId');
    const shops = asked ? [asked] : access.shops.map((s) => s.shopId);
    if (asked && !access.shops.some((s) => s.shopId === asked)) need(c, 'stock.view', asked);
    const rows = t.all<{ id: string; code: string; shop_id: string; times: number; scanned_at: number }>(
      `SELECT id, code, shop_id, times, scanned_at FROM unknown_scans
        WHERE org_id = @org AND resolved_at IS NULL AND shop_id IN (SELECT value FROM json_each(@shops)) ORDER BY scanned_at DESC`,
      { shops },
    );
    return c.json(rows.map((r) => ({ id: r.id, code: r.code, shopId: r.shop_id, times: r.times, scannedAt: r.scanned_at })));
  });

  // the ledger, newest first
  app.get('/v1/orgs/:org/movements', (c) => {
    const q = c.req.query();
    const shops = shopsFor(c, 'stock.history.view', q.shopId || null);
    if (!shops.length) need(c, 'stock.history.view');
    const { t } = orgOf(c);
    const limit = clampLimit(q.limit);
    const offset = decodeCursor(q.cursor);
    const loc = readerLocale(c, orgOf(c).org.default_locale);
    const rows = t.all<Record<string, string | number | null> & { recorded_at: number }>(
      `SELECT m.id, m.org_id, m.shop_id, m.variant_id, m.qty_delta, m.kind, m.reason, m.note, m.unit_price_minor, m.unit_cost_minor,
              m.batch_id, m.ref_type, m.ref_id, m.occurred_at, m.recorded_at, m.created_by, u.display_name AS created_by_name,
              ${productNameSql('p')} AS product_name, v.options AS variant_options
         FROM stock_movements m LEFT JOIN users u ON u.id = m.created_by
         LEFT JOIN product_variants v ON v.id = m.variant_id LEFT JOIN products p ON p.id = v.product_id
        WHERE m.org_id = @org AND m.shop_id IN (SELECT value FROM json_each(@shops))
          AND (@variant IS NULL OR m.variant_id = @variant)
        ORDER BY m.recorded_at DESC, m.id DESC LIMIT @lim OFFSET @off`,
      { shops, variant: q.variantId ?? null, lim: limit + 1, off: offset, loc },
    );
    const showCost = has(c, 'products.cost.view');
    const items: Movement[] = rows.map((r) => ({
      id: String(r.id),
      orgId: String(r.org_id),
      shopId: String(r.shop_id),
      variantId: String(r.variant_id),
      qtyDelta: Number(r.qty_delta),
      kind: r.kind as Movement['kind'],
      ...(r.reason ? { reason: r.reason as Movement['reason'] } : {}),
      ...(r.note ? { note: String(r.note) } : {}),
      ...(r.unit_price_minor != null ? { unitPriceMinor: Number(r.unit_price_minor) } : {}),
      ...(showCost && r.unit_cost_minor != null ? { unitCostMinor: Number(r.unit_cost_minor) } : {}),
      ...(r.batch_id ? { batchId: String(r.batch_id) } : {}),
      ...(r.ref_type ? { refType: String(r.ref_type) } : {}),
      ...(r.ref_id ? { refId: String(r.ref_id) } : {}),
      occurredAt: Number(r.occurred_at),
      createdBy: String(r.created_by),
      createdByName: (r.created_by_name as string | null) ?? null,
      productName: r.product_name ? variantLabel(String(r.product_name), (r.variant_options as string | null) ?? null, loc) : null,
      recordedAt: Number(r.recorded_at),
    }));
    return c.json(page(items, offset, limit));
  });
}
