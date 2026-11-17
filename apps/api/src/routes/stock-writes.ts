// catalog and stock writes: products, prices, barcodes, the movement batch, counts, transfers, sync

import type { Context, Hono } from 'hono';
import { z } from 'zod';
import {
  makeInternalEan13, MovementInput, normalizeBarcode, ProductInput, searchKey, ShopVariantSettingsInput, TransferInput,
  UncountedPolicy, uuidv7, type MovementBatchResult, type StockCount, type SyncResult, type Transfer,
} from '@custock/core';
import type { AppEnv } from '../types';
import { audit, nextStamp } from '../lib/audit';
import { cfgOf, has, need, nowOf, orgOf, productNameSql, readerLocale, shopsFor } from '../lib/context';
import { idempotent } from '../lib/idempotency';
import { notifyMembers } from '../lib/notify';
import { ApiProblem, badRequest, forbidden, notFound } from '../lib/problem';
import { parseJson, type Tenant } from '../lib/tenant';
import { loadLevels, loadProducts, variantLabel } from '../services/catalog';
import { currentLevel, recordMovement, shopNameOf, type LedgerCtx } from '../services/ledger';
import { applyImages, applyVariants, attachBarcode } from '../services/product-writes';

function ledgerCtx(c: Context<AppEnv>): LedgerCtx {
  const o = orgOf(c);
  return {
    db: cfgOf(c).db,
    t: o.t,
    org: o.org,
    topology: o.topology,
    userId: c.get('user').id,
    now: nowOf(c),
    can: (perm, shopId) => has(c, perm, shopId),
  };
}

export const productEtag = (updatedAt: number) => `W/"p-${updatedAt}"`;

function checkIfMatch(c: Context<AppEnv>, etag: string) {
  const want = c.req.header('If-Match');
  if (want && want !== etag && want !== '*') throw new ApiProblem(412, 'conflict', 'changed since you loaded it');
}

function productSearchKey(t: Tenant, productId: string, name: string): string {
  const tr = t.all<{ name: string }>('SELECT tr.name FROM product_translations tr JOIN products p ON p.id = tr.product_id WHERE p.org_id = @org AND tr.product_id = @p', { p: productId });
  return searchKey(name, ...tr.map((x) => x.name));
}

function attach(c: Context<AppEnv>, variantId: string, raw: string, packQty = 1, symbology?: string | null) {
  attachBarcode(c, variantId, raw, packQty, symbology);
  orgOf(c).t.run('UPDATE products SET updated_at = @now WHERE org_id = @org AND id = (SELECT product_id FROM product_variants WHERE id = @v)', { now: nowOf(c), v: variantId });
}

function setBasePrice(c: Context<AppEnv>, variantId: string, price: number) {
  const { t } = orgOf(c);
  const now = nowOf(c);
  const v = t.get<{ price_minor: number | null; product_id: string }>('SELECT price_minor, product_id FROM product_variants WHERE org_id = @org AND id = @v', { v: variantId });
  if (!v) throw notFound('variant');
  if (v.price_minor === price) return;
  t.run('UPDATE product_variants SET price_minor = @p, updated_at = @now WHERE org_id = @org AND id = @v', { p: price, now, v: variantId });
  t.run('UPDATE products SET updated_at = @now WHERE org_id = @org AND id = @pid', { now, pid: v.product_id });
  t.run("UPDATE price_history SET valid_to = @now WHERE org_id = @org AND variant_id = @v AND shop_id IS NULL AND source = 'base' AND valid_to IS NULL", { now, v: variantId });
  t.run(
    "INSERT INTO price_history (id, org_id, variant_id, shop_id, price_minor, source, valid_from, changed_by) VALUES (@id, @org, @v, NULL, @p, 'base', @now, @u)",
    { id: uuidv7(now), v: variantId, p: price, now, u: c.get('user').id },
  );
  audit(t, { id: c.get('user').id }, 'product.price_changed', { type: 'product_variant', id: variantId }, { price_minor: v.price_minor }, { price_minor: price }, now);
}

function loadCount(c: Context<AppEnv>, id: string): StockCount {
  const { t } = orgOf(c);
  const row = t.get<{ id: string; shop_id: string; kind: 'full' | 'partial'; filter: string | null; status: StockCount['status']; started_by: string; started_at: number; submitted_at: number | null; applied_by: string | null; applied_at: number | null; uncounted_policy: StockCount['uncountedPolicy'] }>(
    'SELECT id, shop_id, kind, filter, status, started_by, started_at, submitted_at, applied_by, applied_at, uncounted_policy FROM stock_counts WHERE org_id = @org AND id = @id',
    { id },
  );
  if (!row) throw notFound('count');
  need(c, 'stock.count', row.shop_id);
  const showCost = has(c, 'products.cost.view');
  const lines = t.all<{ variant_id: string; product_id: string; name: string; options: string | null; counted_qty: number; expected_qty: number; counted_by: string; counted_by_name: string | null; counted_at: number; cost: number | null; uom: string }>(
    `SELECT l.variant_id, v.product_id, ${productNameSql('p')} AS name, v.options, l.counted_qty, l.expected_qty, l.counted_by, u.display_name AS counted_by_name, l.counted_at, v.cost_minor AS cost, p.uom
       FROM stock_count_lines l JOIN product_variants v ON v.id = l.variant_id JOIN products p ON p.id = v.product_id LEFT JOIN users u ON u.id = l.counted_by
      WHERE l.org_id = @org AND l.count_id = @id ORDER BY p.name`,
    { id, loc: readerLocale(c, orgOf(c).org.default_locale) },
  );
  return {
    id: row.id, shopId: row.shop_id, kind: row.kind, filter: parseJson(row.filter, null), status: row.status, startedBy: row.started_by,
    startedAt: row.started_at, submittedAt: row.submitted_at, appliedBy: row.applied_by, appliedAt: row.applied_at, uncountedPolicy: row.uncounted_policy,
    lines: lines.map((l) => {
      const diff = l.counted_qty - l.expected_qty;
      return {
        variantId: l.variant_id, productId: l.product_id, name: variantLabel(l.name, l.options, readerLocale(c, orgOf(c).org.default_locale)), countedQty: l.counted_qty,
        expectedQty: l.expected_qty, difference: diff,
        differenceCostMinor: showCost && l.cost != null ? Math.round((l.uom === 'piece' ? diff : diff / 1000) * l.cost) : null,
        countedBy: l.counted_by, countedByName: l.counted_by_name, countedAt: l.counted_at,
      };
    }),
  };
}

function loadTransfer(c: Context<AppEnv>, id: string): Transfer {
  const { t, access } = orgOf(c);
  const row = t.get<{ id: string; from_shop_id: string; to_shop_id: string; status: Transfer['status']; note: string | null; created_by: string; created_at: number; sent_at: number | null; received_at: number | null }>(
    'SELECT id, from_shop_id, to_shop_id, status, note, created_by, created_at, sent_at, received_at FROM transfers WHERE org_id = @org AND id = @id',
    { id },
  );
  if (!row) throw notFound('transfer');
  const mine = access.shops.map((s) => s.shopId);
  if (!mine.includes(row.from_shop_id) && !mine.includes(row.to_shop_id)) throw notFound('transfer');
  const lines = t.all<{ variant_id: string; name: string; options: string | null; qty_sent: number; qty_received: number | null }>(
    `SELECT l.variant_id, ${productNameSql('p')} AS name, v.options, l.qty_sent, l.qty_received FROM transfer_lines l
       JOIN product_variants v ON v.id = l.variant_id JOIN products p ON p.id = v.product_id
      WHERE l.org_id = @org AND l.transfer_id = @id ORDER BY p.name`,
    { id, loc: readerLocale(c, orgOf(c).org.default_locale) },
  );
  return {
    id: row.id, fromShopId: row.from_shop_id, toShopId: row.to_shop_id, status: row.status, note: row.note, createdBy: row.created_by,
    createdAt: row.created_at, sentAt: row.sent_at, receivedAt: row.received_at,
    lines: lines.map((l) => ({
      variantId: l.variant_id, name: variantLabel(l.name, l.options, readerLocale(c, orgOf(c).org.default_locale)), qtySent: l.qty_sent, qtyReceived: l.qty_received,
      lost: l.qty_received == null ? 0 : Math.max(0, l.qty_sent - l.qty_received),
    })),
  };
}

export function stockWriteRoutes(app: Hono<AppEnv>) {
  // ------------------------------------------------------------ products

  app.post('/v1/orgs/:org/products', async (c) => {
    need(c, 'products.create');
    const input = ProductInput.parse(await c.req.json());
    return idempotent(c, () => {
      const { t } = orgOf(c);
      const now = nowOf(c);
      const user = c.get('user').id;
      const pid = uuidv7(now);
      const vid = uuidv7(now);
      if (input.categoryId && !t.get('SELECT 1 FROM categories WHERE org_id = @org AND id = @id', { id: input.categoryId })) throw badRequest('unknown category', { categoryId: 'not_found' });
      cfgOf(c).db.transaction(() => {
        t.run(
          `INSERT INTO products (id, org_id, category_id, name, description, brand, uom, tax_rate_bp, track_stock, search_key, created_by, created_at, updated_at)
           VALUES (@id, @org, @cat, @name, @desc, @brand, @uom, @vat, @track, @key, @u, @now, @now)`,
          { id: pid, cat: input.categoryId ?? null, name: input.name, desc: input.description ?? null, brand: input.brand ?? null, uom: input.uom, vat: input.taxRateBp, track: input.trackStock, key: searchKey(input.name, input.brand), u: user, now },
        );
        if (input.variants) {
          applyVariants(c, pid, input.variants, true);
        } else {
          const cost = has(c, 'products.cost.edit') ? input.costMinor ?? null : null;
          t.run(
            'INSERT INTO product_variants (id, org_id, product_id, price_minor, cost_minor, is_default, sort, created_at, updated_at) VALUES (@id, @org, @p, @price, @cost, 1, 0, @now, @now)',
            { id: vid, p: pid, price: input.priceMinor ?? null, cost, now },
          );
          if (input.priceMinor != null) {
            t.run("INSERT INTO price_history (id, org_id, variant_id, shop_id, price_minor, source, valid_from, changed_by) VALUES (@id, @org, @v, NULL, @p, 'base', @now, @u)", { id: uuidv7(now), v: vid, p: input.priceMinor, now, u: user });
          }
          if (input.barcode) attach(c, vid, input.barcode);
        }
        if (input.imageUrls) applyImages(c, pid, input.imageUrls);
        audit(t, { id: user }, 'product.created', { type: 'product', id: pid }, null, { name: input.name }, now);
      })();
      const [p] = loadProducts(t, [pid], { withCost: has(c, 'products.cost.view'), levelShops: [] });
      c.header('ETag', productEtag(now));
      return { status: 201, body: p };
    });
  });

  app.patch('/v1/orgs/:org/products/:id', async (c) => {
    need(c, 'products.edit');
    const { t } = orgOf(c);
    const id = c.req.param('id');
    const row = t.get<{ name: string; updated_at: number; brand: string | null }>('SELECT name, updated_at, brand FROM products WHERE org_id = @org AND id = @id', { id });
    if (!row) throw notFound('product');
    checkIfMatch(c, productEtag(row.updated_at));
    const patch = ProductInput.partial().parse(await c.req.json());
    if (patch.categoryId && !t.get('SELECT 1 FROM categories WHERE org_id = @org AND id = @id', { id: patch.categoryId })) throw badRequest('unknown category', { categoryId: 'not_found' });
    if (patch.priceMinor != null && !has(c, 'products.price.edit')) throw forbidden('products.price.edit');
    if (patch.costMinor != null && !has(c, 'products.cost.edit')) throw forbidden('products.cost.edit');
    const now = nextStamp(row.updated_at, nowOf(c));
    cfgOf(c).db.transaction(() => {
      const name = patch.name ?? row.name;
      t.run(
        `UPDATE products SET name = coalesce(@name, name), description = CASE WHEN @hasDesc THEN @desc ELSE description END,
           brand = CASE WHEN @hasBrand THEN @brand ELSE brand END, category_id = CASE WHEN @hasCat THEN @cat ELSE category_id END,
           uom = coalesce(@uom, uom), tax_rate_bp = coalesce(@vat, tax_rate_bp), track_stock = coalesce(@track, track_stock),
           search_key = @key, updated_at = @now WHERE org_id = @org AND id = @id`,
        {
          id, name: patch.name ?? null, hasDesc: 'description' in patch, desc: patch.description ?? null, hasBrand: 'brand' in patch, brand: patch.brand ?? null,
          hasCat: 'categoryId' in patch, cat: patch.categoryId ?? null, uom: patch.uom ?? null, vat: patch.taxRateBp ?? null,
          track: patch.trackStock === undefined ? null : patch.trackStock, key: productSearchKey(t, id, name), now,
        },
      );
      const def = t.get<{ id: string }>('SELECT id FROM product_variants WHERE org_id = @org AND product_id = @id ORDER BY is_default DESC, sort LIMIT 1', { id })!;
      if (patch.priceMinor != null) setBasePrice(c, def.id, patch.priceMinor);
      if (patch.costMinor != null) t.run('UPDATE product_variants SET cost_minor = @c, updated_at = @now WHERE org_id = @org AND id = @v', { c: patch.costMinor, now, v: def.id });
      if (patch.barcode) attach(c, def.id, patch.barcode);
      if (patch.variants) applyVariants(c, id, patch.variants, false);
      if (patch.imageUrls) applyImages(c, id, patch.imageUrls);
      t.run('UPDATE products SET updated_at = @now WHERE org_id = @org AND id = @id', { now, id });
      audit(t, { id: c.get('user').id }, 'product.updated', { type: 'product', id }, { name: row.name }, patch, now);
    })();
    const [p] = loadProducts(t, [id], { withCost: has(c, 'products.cost.view'), levelShops: has(c, 'stock.view') ? shopsFor(c, 'stock.view') : [] });
    c.header('ETag', productEtag(now));
    return c.json(p);
  });

  app.post('/v1/orgs/:org/products/:id/archive', (c) => {
    need(c, 'products.archive');
    const { t } = orgOf(c);
    const id = c.req.param('id');
    const now = nowOf(c);
    const res = t.run('UPDATE products SET archived_at = coalesce(archived_at, @now), updated_at = @now WHERE org_id = @org AND id = @id', { now, id });
    if (!res.changes) throw notFound('product');
    audit(t, { id: c.get('user').id }, 'product.archived', { type: 'product', id }, null, null, now);
    return c.body(null, 204);
  });

  app.patch('/v1/orgs/:org/variants/:variant/price', async (c) => {
    need(c, 'products.price.edit');
    const { priceMinor } = z.object({ priceMinor: z.number().int().min(0) }).parse(await c.req.json());
    cfgOf(c).db.transaction(() => setBasePrice(c, c.req.param('variant'), priceMinor))();
    return c.body(null, 204);
  });

  // shop price and visibility need prices.shop.edit, reorder points stock.settings.manage
  app.put('/v1/orgs/:org/shops/:shop/variants/:variant/settings', async (c) => {
    const shopId = c.req.param('shop');
    const variantId = c.req.param('variant');
    const input = ShopVariantSettingsInput.parse(await c.req.json());
    if (!Object.keys(input).length) throw badRequest('nothing to change');
    if (!orgOf(c).topology.shops.includes(shopId)) throw notFound('shop');
    if ('priceOverrideMinor' in input || 'isListed' in input) need(c, 'prices.shop.edit', shopId);
    if ('reorderPoint' in input || 'reorderQty' in input) need(c, 'stock.settings.manage', shopId);
    const { t } = orgOf(c);
    if (!t.get('SELECT 1 FROM product_variants WHERE org_id = @org AND id = @v', { v: variantId })) throw notFound('variant');
    const now = nowOf(c);
    const before = t.get<{ price_override_minor: number | null }>('SELECT price_override_minor FROM shop_variant_settings WHERE org_id = @org AND shop_id = @s AND variant_id = @v', { s: shopId, v: variantId });
    cfgOf(c).db.transaction(() => {
      t.run(
        `INSERT INTO shop_variant_settings (org_id, shop_id, variant_id, price_override_minor, is_listed, reorder_point, reorder_qty, updated_at)
         VALUES (@org, @s, @v, @price, coalesce(@listed, 1), @rp, @rq, @now)
         ON CONFLICT (shop_id, variant_id) DO UPDATE SET
           price_override_minor = CASE WHEN @hasPrice THEN @price ELSE price_override_minor END,
           is_listed = coalesce(@listed, is_listed),
           reorder_point = CASE WHEN @hasRp THEN @rp ELSE reorder_point END,
           reorder_qty = CASE WHEN @hasRq THEN @rq ELSE reorder_qty END,
           updated_at = @now`,
        {
          s: shopId, v: variantId, price: input.priceOverrideMinor ?? null, hasPrice: 'priceOverrideMinor' in input,
          listed: input.isListed === undefined ? null : input.isListed, rp: input.reorderPoint ?? null, hasRp: 'reorderPoint' in input,
          rq: input.reorderQty ?? null, hasRq: 'reorderQty' in input, now,
        },
      );
      if ('priceOverrideMinor' in input && (before?.price_override_minor ?? null) !== (input.priceOverrideMinor ?? null)) {
        t.run("UPDATE price_history SET valid_to = @now WHERE org_id = @org AND variant_id = @v AND shop_id = @s AND source = 'shop_override' AND valid_to IS NULL", { now, v: variantId, s: shopId });
        if (input.priceOverrideMinor != null) {
          t.run(
            "INSERT INTO price_history (id, org_id, variant_id, shop_id, price_minor, source, valid_from, changed_by) VALUES (@id, @org, @v, @s, @p, 'shop_override', @now, @u)",
            { id: uuidv7(now), v: variantId, s: shopId, p: input.priceOverrideMinor, now, u: c.get('user').id },
          );
        }
        audit(t, { id: c.get('user').id }, 'product.shop_price_changed', { type: 'product_variant', id: variantId }, before ?? null, { shopId, priceOverrideMinor: input.priceOverrideMinor }, now);
      }
    })();
    return c.body(null, 204);
  });

  app.post('/v1/orgs/:org/variants/:variant/barcodes', async (c) => {
    need(c, 'products.edit');
    const body = z.object({ code: z.string().min(1).max(500), packQty: z.number().int().positive().default(1), symbology: z.string().optional() }).parse(await c.req.json());
    const { t } = orgOf(c);
    if (!t.get('SELECT 1 FROM product_variants WHERE org_id = @org AND id = @v', { v: c.req.param('variant') })) throw notFound('variant');
    cfgOf(c).db.transaction(() => attach(c, c.req.param('variant'), body.code, body.packQty, body.symbology))();
    return c.body(null, 204);
  });

  app.post('/v1/orgs/:org/barcodes/internal', (c) => {
    need(c, 'products.edit');
    const { t } = orgOf(c);
    let seq = (t.get<{ n: number }>("SELECT count(*) AS n FROM barcodes WHERE org_id = @org AND symbology = 'internal'")?.n ?? 0) + 1;
    for (;;) {
      const code = makeInternalEan13(seq);
      if (!t.get('SELECT 1 FROM barcodes WHERE org_id = @org AND code_norm = @n', { n: code.padStart(14, '0') })) return c.json({ code });
      seq++;
    }
  });

  app.post('/v1/orgs/:org/unknown-scans/:id/resolve', async (c) => {
    need(c, 'products.edit');
    const { variantId } = z.object({ variantId: z.string().nullable() }).parse(await c.req.json());
    const { t } = orgOf(c);
    const row = t.get<{ code: string; shop_id: string }>('SELECT code, shop_id FROM unknown_scans WHERE org_id = @org AND id = @id AND resolved_at IS NULL', { id: c.req.param('id') });
    if (!row) throw notFound('unknown scan');
    if (variantId && !t.get('SELECT 1 FROM product_variants WHERE org_id = @org AND id = @v', { v: variantId })) throw notFound('variant');
    cfgOf(c).db.transaction(() => {
      if (variantId) attach(c, variantId, row.code);
      t.run('UPDATE unknown_scans SET resolved_at = @now, resolved_variant_id = @v WHERE org_id = @org AND id = @id', { now: nowOf(c), v: variantId, id: c.req.param('id') });
    })();
    return c.body(null, 204);
  });

  // ------------------------------------------------------------ the movement batch

  app.post('/v1/orgs/:org/movements', async (c) => {
    const { movements } = z.object({ movements: z.array(z.unknown()).min(1).max(500) }).parse(await c.req.json());
    const ctx = ledgerCtx(c);
    const result: MovementBatchResult = { accepted: [], duplicates: [], rejected: [], levels: [], backInStock: [], lowStock: [] };
    const touched = new Map<string, { shopId: string; variantId: string }>();
    for (const raw of movements) {
      const parsed = MovementInput.safeParse(raw);
      const rawId = typeof raw === 'object' && raw && 'id' in raw ? String((raw as { id: unknown }).id) : 'unknown';
      if (!parsed.success) {
        result.rejected.push({ id: rawId, code: 'validation' });
        continue;
      }
      // each movement in its own transaction: partial success is allowed
      const out = cfgOf(c).db.transaction(() => recordMovement(ctx, parsed.data))();
      if (out.status === 'duplicate') result.duplicates.push(out.id);
      else if (out.status === 'rejected') result.rejected.push({ id: out.id, code: out.code });
      else {
        result.accepted.push(out.id);
        touched.set(`${out.level.shopId}|${out.level.variantId}`, { shopId: out.level.shopId, variantId: out.level.variantId });
        if (out.backInStock) result.backInStock.push(out.backInStock);
        if (out.lowStock) result.lowStock.push(out.lowStock);
      }
    }
    result.levels = [...touched.values()].map((x) => currentLevel(ctx.t, x.shopId, x.variantId));
    return c.json(result);
  });

  // ------------------------------------------------------------ counts

  app.get('/v1/orgs/:org/counts', (c) => {
    const shops = shopsFor(c, 'stock.count', c.req.query('shopId') || null);
    if (!shops.length) need(c, 'stock.count');
    const { t } = orgOf(c);
    const ids = t.all<{ id: string }>(
      `SELECT id FROM stock_counts WHERE org_id = @org AND shop_id IN (SELECT value FROM json_each(@shops)) AND (@status IS NULL OR status = @status) ORDER BY started_at DESC LIMIT 100`,
      { shops, status: c.req.query('status') ?? null },
    );
    return c.json(ids.map((r) => loadCount(c, r.id)));
  });

  app.get('/v1/orgs/:org/counts/:id', (c) => c.json(loadCount(c, c.req.param('id'))));

  app.post('/v1/orgs/:org/shops/:shop/counts', async (c) => {
    const shopId = c.req.param('shop');
    need(c, 'stock.count', shopId);
    const body = z.object({ kind: z.enum(['full', 'partial']), filter: z.record(z.string(), z.string()).nullable().optional() }).parse(await c.req.json());
    return idempotent(c, () => {
      const { t } = orgOf(c);
      const now = nowOf(c);
      const id = uuidv7(now);
      t.run(
        "INSERT INTO stock_counts (id, org_id, shop_id, kind, filter, status, started_by, started_at) VALUES (@id, @org, @s, @kind, @filter, 'open', @u, @now)",
        { id, s: shopId, kind: body.kind, filter: body.filter ? JSON.stringify(body.filter) : null, u: c.get('user').id, now },
      );
      return { status: 201, body: loadCount(c, id) };
    });
  });

  // the server stamps what it expected at the moment the line is counted
  app.put('/v1/orgs/:org/counts/:id/lines/:variant', async (c) => {
    const body = z.object({ countedQty: z.number().int(), mode: z.enum(['set', 'add']).default('set') }).parse(await c.req.json());
    const { t } = orgOf(c);
    const count = t.get<{ shop_id: string; status: string }>('SELECT shop_id, status FROM stock_counts WHERE org_id = @org AND id = @id', { id: c.req.param('id') });
    if (!count) throw notFound('count');
    need(c, 'stock.count', count.shop_id);
    if (count.status !== 'open') throw new ApiProblem(409, 'conflict', 'count is not open');
    const variantId = c.req.param('variant');
    if (!t.get('SELECT 1 FROM product_variants WHERE org_id = @org AND id = @v', { v: variantId })) throw notFound('variant');
    const now = nowOf(c);
    const expected = currentLevel(t, count.shop_id, variantId).onHand;
    const prev = t.get<{ counted_qty: number }>('SELECT counted_qty FROM stock_count_lines WHERE org_id = @org AND count_id = @id AND variant_id = @v', { id: c.req.param('id'), v: variantId });
    const counted = body.mode === 'add' ? (prev?.counted_qty ?? 0) + body.countedQty : body.countedQty;
    if (counted < 0) throw badRequest('counted quantity below zero', { countedQty: 'too_small' });
    t.run(
      `INSERT INTO stock_count_lines (count_id, org_id, variant_id, counted_qty, expected_qty, counted_by, counted_at) VALUES (@id, @org, @v, @counted, @exp, @u, @now)
       ON CONFLICT (count_id, variant_id) DO UPDATE SET counted_qty = @counted, expected_qty = @exp, counted_by = @u, counted_at = @now`,
      { id: c.req.param('id'), v: variantId, counted, exp: expected, u: c.get('user').id, now },
    );
    return c.json(loadCount(c, c.req.param('id')).lines.find((l) => l.variantId === variantId));
  });

  app.post('/v1/orgs/:org/counts/:id/submit', (c) => {
    const count = loadCount(c, c.req.param('id'));
    if (count.status !== 'open') throw new ApiProblem(409, 'conflict', 'count is not open');
    const { t, org } = orgOf(c);
    const moved = t.run("UPDATE stock_counts SET status = 'review', submitted_at = @now WHERE org_id = @org AND id = @id AND status = 'open'", { now: nowOf(c), id: count.id });
    if (!moved.changes) throw new ApiProblem(409, 'conflict', 'count is not open');
    const shopName = shopNameOf(t, count.shopId);
    notifyMembers(cfgOf(c).db, org.id, {
      perm: 'stock.count.approve', shopId: count.shopId, key: 'countReady', exceptUserId: c.get('user').id,
      params: () => ({ shop: shopName, count: count.lines.length }), payload: { countId: count.id },
    });
    return c.json(loadCount(c, count.id));
  });

  app.post('/v1/orgs/:org/counts/:id/apply', async (c) => {
    // read the body before looking at the status, so nothing async sits between the check and the write
    const body = z.object({ uncountedPolicy: UncountedPolicy.optional() }).parse(await c.req.json().catch(() => ({})));
    const count = loadCount(c, c.req.param('id'));
    need(c, 'stock.count.approve', count.shopId);
    if (count.status !== 'review' && count.status !== 'open') throw new ApiProblem(409, 'conflict', 'count is already closed');
    if (count.kind === 'full' && !body.uncountedPolicy) throw badRequest('full counts need an uncounted policy', { uncountedPolicy: 'required' });
    const ctx = ledgerCtx(c);
    const { t } = ctx;
    cfgOf(c).db.transaction(() => {
      const claimed = t.run(
        "UPDATE stock_counts SET status = 'applied', applied_by = @u, applied_at = @now, uncounted_policy = @p WHERE org_id = @org AND id = @id AND status IN ('open', 'review')",
        { u: ctx.userId, now: ctx.now, p: count.kind === 'full' ? body.uncountedPolicy : null, id: count.id },
      );
      if (!claimed.changes) throw new ApiProblem(409, 'conflict', 'count is already closed');
      for (const l of count.lines) {
        if (l.difference === 0) continue;
        const out = recordMovement(ctx, { id: uuidv7(ctx.now), shopId: count.shopId, variantId: l.variantId, qtyDelta: l.difference, kind: 'count', refType: 'count', refId: count.id, occurredAt: ctx.now }, { internal: true });
        if (out.status === 'rejected') throw new ApiProblem(409, out.code, `line ${l.variantId}`);
      }
      if (count.kind === 'full' && body.uncountedPolicy === 'set_zero') {
        const counted = count.lines.map((l) => l.variantId);
        const rest = t.all<{ variant_id: string; on_hand: number }>(
          `SELECT l.variant_id, l.on_hand FROM stock_levels l JOIN product_variants v ON v.id = l.variant_id JOIN products p ON p.id = v.product_id
            WHERE l.org_id = @org AND l.shop_id = @s AND l.on_hand != 0 AND p.track_stock = 1 AND l.variant_id NOT IN (SELECT value FROM json_each(@counted))`,
          { s: count.shopId, counted },
        );
        for (const r of rest) {
          recordMovement(ctx, { id: uuidv7(ctx.now), shopId: count.shopId, variantId: r.variant_id, qtyDelta: -r.on_hand, kind: 'count', refType: 'count', refId: count.id, occurredAt: ctx.now }, { internal: true });
        }
      }
      audit(t, { id: ctx.userId }, 'stock.count_applied', { type: 'stock_count', id: count.id }, null, { lines: count.lines.length, policy: body.uncountedPolicy ?? null }, ctx.now);
    })();
    return c.json(loadCount(c, count.id));
  });

  app.post('/v1/orgs/:org/counts/:id/cancel', (c) => {
    const count = loadCount(c, c.req.param('id'));
    if (count.status === 'applied' || count.status === 'cancelled') throw new ApiProblem(409, 'conflict', 'count is already closed');
    const moved = orgOf(c).t.run("UPDATE stock_counts SET status = 'cancelled' WHERE org_id = @org AND id = @id AND status IN ('open', 'review')", { id: count.id });
    if (!moved.changes) throw new ApiProblem(409, 'conflict', 'count is already closed');
    return c.json(loadCount(c, count.id));
  });

  // ------------------------------------------------------------ transfers

  app.get('/v1/orgs/:org/transfers', (c) => {
    const { t, access } = orgOf(c);
    const asked = c.req.query('shopId');
    const mine = asked ? [asked] : access.shops.map((s) => s.shopId);
    if (asked && !access.shops.some((s) => s.shopId === asked)) need(c, 'stock.view', asked);
    if (!has(c, 'stock.transfer.send') && !has(c, 'stock.transfer.receive')) need(c, 'stock.transfer.receive');
    const ids = t.all<{ id: string }>(
      `SELECT id FROM transfers WHERE org_id = @org AND (from_shop_id IN (SELECT value FROM json_each(@s)) OR to_shop_id IN (SELECT value FROM json_each(@s)))
         AND (@status IS NULL OR status = @status) ORDER BY created_at DESC LIMIT 100`,
      { s: mine, status: c.req.query('status') ?? null },
    );
    return c.json(ids.map((r) => loadTransfer(c, r.id)));
  });

  app.get('/v1/orgs/:org/transfers/:id', (c) => c.json(loadTransfer(c, c.req.param('id'))));

  app.post('/v1/orgs/:org/transfers', async (c) => {
    const input = TransferInput.parse(await c.req.json());
    need(c, 'stock.transfer.send', input.fromShopId);
    const { t, topology } = orgOf(c);
    if (input.fromShopId === input.toShopId) throw badRequest('same shop', { toShopId: 'same_shop' });
    if (!topology.shops.includes(input.toShopId)) throw notFound('shop');
    return idempotent(c, () => {
      const now = nowOf(c);
      const id = uuidv7(now);
      cfgOf(c).db.transaction(() => {
        t.run(
          "INSERT INTO transfers (id, org_id, from_shop_id, to_shop_id, status, note, created_by, created_at) VALUES (@id, @org, @f, @to, 'draft', @note, @u, @now)",
          { id, f: input.fromShopId, to: input.toShopId, note: input.note ?? null, u: c.get('user').id, now },
        );
        const merged = new Map<string, number>();
        for (const l of input.lines) merged.set(l.variantId, (merged.get(l.variantId) ?? 0) + l.qty);
        for (const [v, qty] of merged) {
          if (!t.get('SELECT 1 FROM product_variants WHERE org_id = @org AND id = @v', { v })) throw notFound('variant');
          t.run('INSERT INTO transfer_lines (transfer_id, org_id, variant_id, qty_sent) VALUES (@id, @org, @v, @q)', { id, v, q: qty });
        }
      })();
      return { status: 201, body: loadTransfer(c, id) };
    });
  });

  app.post('/v1/orgs/:org/transfers/:id/send', (c) => {
    const tr = loadTransfer(c, c.req.param('id'));
    need(c, 'stock.transfer.send', tr.fromShopId);
    if (tr.status !== 'draft') throw new ApiProblem(409, 'conflict', 'transfer is not a draft');
    const ctx = ledgerCtx(c);
    cfgOf(c).db.transaction(() => {
      const claimed = ctx.t.run("UPDATE transfers SET status = 'sent', sent_by = @u, sent_at = @now WHERE org_id = @org AND id = @id AND status = 'draft'", { u: ctx.userId, now: ctx.now, id: tr.id });
      if (!claimed.changes) throw new ApiProblem(409, 'conflict', 'transfer is not a draft');
      for (const l of tr.lines) {
        const out = recordMovement(ctx, { id: uuidv7(ctx.now), shopId: tr.fromShopId, variantId: l.variantId, qtyDelta: -l.qtySent, kind: 'transfer_out', refType: 'transfer', refId: tr.id, occurredAt: ctx.now }, { internal: true });
        if (out.status === 'rejected') throw new ApiProblem(409, out.code, `line ${l.variantId}`);
        ctx.t.run(
          `INSERT INTO stock_levels (org_id, shop_id, variant_id, on_hand, in_transit_in) VALUES (@org, @s, @v, 0, @q)
           ON CONFLICT (shop_id, variant_id) DO UPDATE SET in_transit_in = in_transit_in + @q`,
          { s: tr.toShopId, v: l.variantId, q: l.qtySent },
        );
      }
    })();
    const total = tr.lines.reduce((a, l) => a + l.qtySent, 0);
    const to = shopNameOf(ctx.t, tr.toShopId);
    const from = shopNameOf(ctx.t, tr.fromShopId);
    notifyMembers(ctx.db, ctx.org.id, {
      perm: 'stock.transfer.receive', shopId: tr.toShopId, key: 'transferSent', exceptUserId: ctx.userId,
      params: () => ({ shop: to, from, count: total }), payload: { transferId: tr.id },
    });
    return c.json(loadTransfer(c, tr.id));
  });

  // what really arrived. the difference is lost in transit, no phantom stock anywhere.
  app.post('/v1/orgs/:org/transfers/:id/receive', async (c) => {
    const body = z.object({ lines: z.array(z.object({ variantId: z.string().max(64), qtyReceived: z.number().int().min(0) })).max(500).default([]) }).parse(await c.req.json());
    const tr = loadTransfer(c, c.req.param('id'));
    need(c, 'stock.transfer.receive', tr.toShopId);
    if (tr.status !== 'sent') throw new ApiProblem(409, 'conflict', 'transfer is not on the way');
    const got = new Map(body.lines.map((l) => [l.variantId, l.qtyReceived]));
    const ctx = ledgerCtx(c);
    cfgOf(c).db.transaction(() => {
      const claimed = ctx.t.run("UPDATE transfers SET status = 'received', received_by = @u, received_at = @now WHERE org_id = @org AND id = @id AND status = 'sent'", { u: ctx.userId, now: ctx.now, id: tr.id });
      if (!claimed.changes) throw new ApiProblem(409, 'conflict', 'transfer is not on the way');
      for (const l of tr.lines) {
        const received = Math.min(got.get(l.variantId) ?? l.qtySent, l.qtySent);
        ctx.t.run('UPDATE transfer_lines SET qty_received = @r WHERE org_id = @org AND transfer_id = @id AND variant_id = @v', { r: received, id: tr.id, v: l.variantId });
        ctx.t.run('UPDATE stock_levels SET in_transit_in = max(0, in_transit_in - @q) WHERE org_id = @org AND shop_id = @s AND variant_id = @v', { q: l.qtySent, s: tr.toShopId, v: l.variantId });
        if (received > 0) {
          recordMovement(ctx, { id: uuidv7(ctx.now), shopId: tr.toShopId, variantId: l.variantId, qtyDelta: received, kind: 'transfer_in', refType: 'transfer', refId: tr.id, occurredAt: ctx.now }, { internal: true });
        }
        if (received < l.qtySent) {
          audit(ctx.t, { id: ctx.userId }, 'stock.transfer_shortage', { type: 'transfer', id: tr.id }, null, { variantId: l.variantId, lost: l.qtySent - received }, ctx.now);
        }
      }
    })();
    return c.json(loadTransfer(c, tr.id));
  });

  app.post('/v1/orgs/:org/transfers/:id/cancel', (c) => {
    const tr = loadTransfer(c, c.req.param('id'));
    need(c, 'stock.transfer.send', tr.fromShopId);
    if (tr.status !== 'draft') throw new ApiProblem(409, 'conflict', 'only drafts can be cancelled');
    const moved = orgOf(c).t.run("UPDATE transfers SET status = 'cancelled' WHERE org_id = @org AND id = @id AND status = 'draft'", { id: tr.id });
    if (!moved.changes) throw new ApiProblem(409, 'conflict', 'only drafts can be cancelled');
    return c.json(loadTransfer(c, tr.id));
  });

  // ------------------------------------------------------------ offline sync

  app.get('/v1/orgs/:org/shops/:shop/sync', (c) => {
    const shopId = c.req.param('shop');
    need(c, 'products.view');
    need(c, 'stock.view', shopId);
    const { t } = orgOf(c);
    const now = nowOf(c);
    const sinceRaw = c.req.query('since');
    const since = sinceRaw ? Number(Buffer.from(sinceRaw, 'base64url').toString('utf8')) || 0 : 0;
    const full = since === 0;
    const changed = t.all<{ id: string }>(
      `SELECT p.id FROM products p WHERE p.org_id = @org AND p.archived_at IS NULL AND (
         @full OR p.updated_at > @since
         OR EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.updated_at > @since)
         OR EXISTS (SELECT 1 FROM barcodes b JOIN product_variants v ON v.id = b.variant_id WHERE v.product_id = p.id AND b.created_at > @since))`,
      { full, since },
    );
    const products = loadProducts(t, changed.map((r) => r.id), { withCost: has(c, 'products.cost.view'), levelShops: [] });
    const variantIds = full
      ? t.all<{ variant_id: string }>('SELECT variant_id FROM stock_levels WHERE org_id = @org AND shop_id = @s', { s: shopId }).map((r) => r.variant_id)
      : t.all<{ variant_id: string }>('SELECT variant_id FROM stock_levels WHERE org_id = @org AND shop_id = @s AND (last_movement_at > @since OR @full)', { s: shopId, since, full }).map((r) => r.variant_id);
    const result: SyncResult = {
      cursor: Buffer.from(String(now)).toString('base64url'),
      full,
      products,
      levels: loadLevels(t, variantIds, [shopId]),
      categories: full || t.get('SELECT 1 FROM categories WHERE org_id = @org LIMIT 1')
        ? t.all<{ id: string; parent_id: string | null; name: string }>('SELECT id, parent_id, name FROM categories WHERE org_id = @org AND archived_at IS NULL ORDER BY sort').map((x) => ({ id: x.id, parentId: x.parent_id, name: x.name }))
        : [],
      tombstones: {
        products: full ? [] : t.all<{ id: string }>('SELECT id FROM products WHERE org_id = @org AND archived_at > @since', { since }).map((r) => r.id),
        variants: full ? [] : t.all<{ id: string }>('SELECT id FROM product_variants WHERE org_id = @org AND archived_at > @since', { since }).map((r) => r.id),
        barcodes: full ? [] : t.all<{ entity_id: string }>("SELECT entity_id FROM deleted_rows WHERE org_id = @org AND entity = 'barcode' AND deleted_at > @since", { since }).map((r) => r.entity_id),
      },
    };
    return c.json(result);
  });
}
