// variants and photos of a product form: the full list comes in, the database follows it.
// cost only with products.cost.edit, a changed price only with products.price.edit (a new
// variant may start with a price), barcodes unique per org, removed variants archived when they
// have history and deleted when they do not.

import type { Context } from 'hono';
import { normalizeBarcode, uuidv7, type VariantInput } from '@custock/core';
import type { AppEnv } from '../types';
import { audit } from '../lib/audit';
import { cfgOf, has, nowOf, orgOf } from '../lib/context';
import { ApiProblem, badRequest, forbidden, notFound } from '../lib/problem';
import { setFileBase, uploadKeyFromUrl } from './catalog';
import { photoStoreOf } from '../routes/uploads';
import { confirmFiles } from '../lib/files';

export function attachBarcode(c: Context<AppEnv>, variantId: string, raw: string, packQty = 1, symbology?: string | null) {
  const { t } = orgOf(c);
  const n = normalizeBarcode(raw, symbology);
  const taken = t.get<{ variant_id: string; name: string }>(
    `SELECT b.variant_id, p.name FROM barcodes b JOIN product_variants v ON v.id = b.variant_id JOIN products p ON p.id = v.product_id
      WHERE b.org_id = @org AND b.code_norm = @n`,
    { n: n.codeNorm },
  );
  if (taken) {
    if (taken.variant_id === variantId) return;
    throw new ApiProblem(409, 'barcode_taken', taken.name);
  }
  const now = nowOf(c);
  t.run(
    'INSERT INTO barcodes (id, org_id, variant_id, code, code_norm, symbology, pack_qty, created_by, created_at) VALUES (@id, @org, @v, @code, @n, @sym, @pack, @u, @now)',
    { id: uuidv7(now), v: variantId, code: n.code, n: n.codeNorm, sym: symbology ?? (n.kind === 'gtin' ? 'ean13' : n.kind), pack: packQty, u: c.get('user').id, now },
  );
  t.run('UPDATE unknown_scans SET resolved_at = @now, resolved_variant_id = @v WHERE org_id = @org AND code_norm = @n AND resolved_at IS NULL', { now, v: variantId, n: n.codeNorm });
}

function removeBarcode(c: Context<AppEnv>, id: string) {
  const { t } = orgOf(c);
  t.run('DELETE FROM barcodes WHERE org_id = @org AND id = @id', { id });
  t.run("INSERT INTO deleted_rows (org_id, entity, entity_id, deleted_at) VALUES (@org, 'barcode', @id, @now)", { id, now: nowOf(c) });
}

function newPrice(c: Context<AppEnv>, variantId: string, price: number) {
  const { t } = orgOf(c);
  const now = nowOf(c);
  t.run("UPDATE price_history SET valid_to = @now WHERE org_id = @org AND variant_id = @v AND shop_id IS NULL AND source = 'base' AND valid_to IS NULL", { now, v: variantId });
  t.run(
    "INSERT INTO price_history (id, org_id, variant_id, shop_id, price_minor, source, valid_from, changed_by) VALUES (@id, @org, @v, NULL, @p, 'base', @now, @u)",
    { id: uuidv7(now), v: variantId, p: price, now, u: c.get('user').id },
  );
}

function skuTaken(c: Context<AppEnv>, sku: string | null | undefined, except: string | null): boolean {
  if (!sku) return false;
  return !!orgOf(c).t.get('SELECT 1 FROM product_variants WHERE org_id = @org AND sku = @s AND archived_at IS NULL AND (@x IS NULL OR id != @x)', { s: sku, x: except });
}

export function applyVariants(c: Context<AppEnv>, productId: string, variants: VariantInput[], create: boolean) {
  const { t } = orgOf(c);
  const now = nowOf(c);
  const canPrice = has(c, 'products.price.edit');
  const canCost = has(c, 'products.cost.edit');

  // the same code twice in one form is a typo, not two products
  const seen = new Set<string>();
  for (const v of variants) {
    for (const b of v.barcodes ?? []) {
      const n = normalizeBarcode(b.code).codeNorm;
      if (seen.has(n)) throw badRequest('the same barcode twice', { barcodes: 'duplicate' });
      seen.add(n);
    }
  }
  const skus = variants.map((v) => v.sku).filter(Boolean);
  if (new Set(skus).size !== skus.length) throw badRequest('the same sku twice', { sku: 'duplicate' });

  const existing = create
    ? []
    : t.all<{ id: string; price_minor: number | null; cost_minor: number | null }>(
        'SELECT id, price_minor, cost_minor FROM product_variants WHERE org_id = @org AND product_id = @p AND archived_at IS NULL',
        { p: productId },
      );
  const ids: string[] = [];
  variants.forEach((v, i) => {
    if (v.id) {
      const ex = existing.find((x) => x.id === v.id);
      if (!ex) throw notFound('variant');
      if (v.priceMinor !== undefined && v.priceMinor !== ex.price_minor) {
        if (!canPrice) throw forbidden('products.price.edit');
        if (v.priceMinor != null) newPrice(c, ex.id, v.priceMinor);
      }
      if (v.costMinor !== undefined && v.costMinor !== ex.cost_minor && !canCost) throw forbidden('products.cost.edit');
      if (v.sku !== undefined && skuTaken(c, v.sku, ex.id)) throw new ApiProblem(409, 'conflict', 'sku in use');
      t.run(
        `UPDATE product_variants SET
           sku = CASE WHEN @hasSku THEN @sku ELSE sku END,
           options = CASE WHEN @hasOptions THEN @options ELSE options END,
           price_minor = CASE WHEN @hasPrice THEN @price ELSE price_minor END,
           cost_minor = CASE WHEN @hasCost THEN @cost ELSE cost_minor END,
           is_default = @def, sort = @i, updated_at = @now
         WHERE org_id = @org AND id = @id`,
        {
          id: ex.id, hasSku: v.sku !== undefined, sku: v.sku ?? null, hasOptions: v.options !== undefined, options: v.options ? JSON.stringify(v.options) : null,
          hasPrice: v.priceMinor !== undefined, price: v.priceMinor ?? null, hasCost: v.costMinor !== undefined && canCost, cost: v.costMinor ?? null,
          def: i === 0 ? 1 : 0, i, now,
        },
      );
      ids.push(ex.id);
    } else {
      if (skuTaken(c, v.sku, null)) throw new ApiProblem(409, 'conflict', 'sku in use');
      const id = uuidv7(now);
      t.run(
        `INSERT INTO product_variants (id, org_id, product_id, sku, options, price_minor, cost_minor, is_default, sort, created_at, updated_at)
         VALUES (@id, @org, @p, @sku, @options, @price, @cost, @def, @i, @now, @now)`,
        {
          id, p: productId, sku: v.sku ?? null, options: v.options ? JSON.stringify(v.options) : null, price: v.priceMinor ?? null,
          cost: canCost ? v.costMinor ?? null : null, def: i === 0 ? 1 : 0, i, now,
        },
      );
      if (v.priceMinor != null) newPrice(c, id, v.priceMinor);
      ids.push(id);
    }
  });

  // barcodes: first take away what is no longer wanted anywhere, then add, so a code can move
  // between two variants of the same product in one save
  const wanted = new Map<string, { code: string; packQty: number }[]>();
  variants.forEach((v, i) => {
    if (v.barcodes) wanted.set(ids[i]!, v.barcodes.map((b) => ({ code: b.code, packQty: b.packQty ?? 1 })));
  });
  for (const [vid, list] of wanted) {
    const want = new Set(list.map((b) => normalizeBarcode(b.code).codeNorm));
    const have = t.all<{ id: string; code_norm: string }>('SELECT id, code_norm FROM barcodes WHERE org_id = @org AND variant_id = @v', { v: vid });
    for (const b of have) if (!want.has(b.code_norm)) removeBarcode(c, b.id);
  }
  for (const [vid, list] of wanted) for (const b of list) attachBarcode(c, vid, b.code, b.packQty);

  // variants left out: archived with history, deleted without
  for (const ex of existing) {
    if (ids.includes(ex.id)) continue;
    const history =
      t.get('SELECT 1 FROM stock_movements WHERE org_id = @org AND variant_id = @v LIMIT 1', { v: ex.id }) ||
      t.get('SELECT 1 FROM stock_alerts WHERE org_id = @org AND variant_id = @v LIMIT 1', { v: ex.id }) ||
      t.get('SELECT 1 FROM post_products pp JOIN posts p ON p.id = pp.post_id WHERE p.org_id = @org AND pp.variant_id = @v LIMIT 1', { v: ex.id }) ||
      t.get('SELECT 1 FROM stock_count_lines WHERE org_id = @org AND variant_id = @v LIMIT 1', { v: ex.id }) ||
      t.get('SELECT 1 FROM transfer_lines WHERE org_id = @org AND variant_id = @v LIMIT 1', { v: ex.id });
    if (history) {
      t.run('UPDATE product_variants SET archived_at = @now, is_default = 0, updated_at = @now WHERE org_id = @org AND id = @v', { now, v: ex.id });
      audit(t, { id: c.get('user').id }, 'variant.archived', { type: 'product_variant', id: ex.id }, null, null, now);
    } else {
      for (const b of t.all<{ id: string }>('SELECT id FROM barcodes WHERE org_id = @org AND variant_id = @v', { v: ex.id })) removeBarcode(c, b.id);
      t.run('DELETE FROM shop_variant_settings WHERE org_id = @org AND variant_id = @v', { v: ex.id });
      t.run('DELETE FROM stock_levels WHERE org_id = @org AND variant_id = @v', { v: ex.id });
      t.run('DELETE FROM price_history WHERE org_id = @org AND variant_id = @v', { v: ex.id });
      t.run('DELETE FROM product_images WHERE org_id = @org AND variant_id = @v', { v: ex.id });
      t.run('DELETE FROM product_variants WHERE org_id = @org AND id = @v', { v: ex.id });
      t.run("INSERT INTO deleted_rows (org_id, entity, entity_id, deleted_at) VALUES (@org, 'variant', @v, @now)", { v: ex.id, now });
    }
  }
}

// photos: https anywhere, or a file uploaded to this org through presignUpload
export function applyImages(c: Context<AppEnv>, productId: string, urls: string[]) {
  const { t, org } = orgOf(c);
  const cfg = cfgOf(c);
  const now = nowOf(c);
  setFileBase(cfg.apiPublicUrl);
  const fileIds: string[] = [];
  for (const url of urls) {
    const uploadKey = uploadKeyFromUrl(url);
    if (uploadKey) {
      const f = t.get<{ id: string }>('SELECT id FROM files WHERE org_id = @org AND storage_key = @k AND deleted_at IS NULL', { k: uploadKey });
      if (!f || !(uploadKey.startsWith(`uploads/${org.id}/`) || uploadKey.startsWith(`orgs/${org.id}/`))) throw badRequest('unknown upload', { imageUrls: 'not_found' });
      fileIds.push(f.id);
      continue;
    }
    if (!url.startsWith('https://')) throw badRequest('photos must be https', { imageUrls: 'https' });
    let f = t.get<{ id: string }>('SELECT id FROM files WHERE org_id = @org AND storage_key = @k', { k: url });
    if (!f) {
      f = { id: uuidv7(now) };
      t.run(
        "INSERT INTO files (id, org_id, storage_key, purpose, is_public, mime, bytes, created_by, created_at) VALUES (@id, @org, @k, 'product', 1, 'image/jpeg', 0, @u, @now)",
        { id: f.id, k: url, u: c.get('user').id, now },
      );
    }
    fileIds.push(f.id);
  }
  const before = t.all<{ file_id: string }>('SELECT file_id FROM product_images WHERE org_id = @org AND product_id = @p AND variant_id IS NULL', { p: productId }).map((r) => r.file_id);
  t.run('DELETE FROM product_images WHERE org_id = @org AND product_id = @p AND variant_id IS NULL', { p: productId });
  fileIds.forEach((fid, i) =>
    t.run('INSERT INTO product_images (id, org_id, product_id, variant_id, file_id, sort) VALUES (@id, @org, @p, NULL, @f, @i)', { id: uuidv7(now), p: productId, f: fid, i }),
  );
  // the photos are in use now, so they count toward storage and are never purged as unused slots
  confirmFiles(cfg.db, fileIds, now);
  dropUnusedFiles(c, before.filter((id) => !fileIds.includes(id)));
}

// photos we stored ourselves that nothing uses any more: the row is marked deleted and the object
// goes, best effort, after the answer
export function dropUnusedFiles(c: Context<AppEnv>, fileIds: string[]) {
  if (!fileIds.length) return;
  const { t } = orgOf(c);
  const now = nowOf(c);
  const keys: string[] = [];
  for (const id of fileIds) {
    const f = t.get<{ storage_key: string }>(
      `SELECT storage_key FROM files f WHERE f.org_id = @org AND f.id = @id AND f.deleted_at IS NULL
         AND (f.storage_key LIKE 'uploads/%' OR f.storage_key LIKE 'orgs/%')
         AND NOT EXISTS (SELECT 1 FROM product_images i WHERE i.file_id = f.id)
         AND NOT EXISTS (SELECT 1 FROM posts p WHERE p.cover_file_id = f.id)
         AND NOT EXISTS (SELECT 1 FROM post_media m WHERE m.file_id = f.id)
         AND NOT EXISTS (SELECT 1 FROM shops s WHERE s.image_file_id = f.id)
         AND NOT EXISTS (SELECT 1 FROM organizations o WHERE o.logo_file_id = f.id)`,
      { id },
    );
    if (!f) continue;
    t.run('UPDATE files SET deleted_at = @now WHERE org_id = @org AND id = @id', { now, id });
    keys.push(f.storage_key);
  }
  const store = photoStoreOf(cfgOf(c));
  for (const k of keys) void store.remove(k);
}
