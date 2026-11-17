// barcode detach (with a tombstone for offline phones) and the review list of negative stock
// accepted from offline phones in strict mode

import type { Hono } from 'hono';
import type { AppEnv } from '../types';
import { audit } from '../lib/audit';
import { cfgOf, need, nowOf, orgOf, productNameSql, readerLocale, shopsFor } from '../lib/context';
import { notFound } from '../lib/problem';
import { parseJson } from '../lib/tenant';
import { variantLabel } from '../services/catalog';

export function stockExtraRoutes(app: Hono<AppEnv>) {
  app.delete('/v1/orgs/:org/variants/:variant/barcodes/:id', (c) => {
    need(c, 'products.edit');
    const { t } = orgOf(c);
    const now = nowOf(c);
    const row = t.get<{ id: string; code: string }>('SELECT id, code FROM barcodes WHERE org_id = @org AND id = @id AND variant_id = @v', { id: c.req.param('id'), v: c.req.param('variant') });
    if (!row) throw notFound('barcode');
    cfgOf(c).db.transaction(() => {
      t.run('DELETE FROM barcodes WHERE org_id = @org AND id = @id', { id: row.id });
      t.run("INSERT INTO deleted_rows (org_id, entity, entity_id, deleted_at) VALUES (@org, 'barcode', @id, @now)", { id: row.id, now });
      t.run('UPDATE products SET updated_at = @now WHERE org_id = @org AND id = (SELECT product_id FROM product_variants WHERE org_id = @org AND id = @v)', { now, v: c.req.param('variant') });
      audit(t, { id: c.get('user').id }, 'barcode.detached', { type: 'barcode', id: row.id }, { code: row.code }, null, now);
    })();
    return c.body(null, 204);
  });

  app.get('/v1/orgs/:org/review/negative', (c) => {
    const shops = shopsFor(c, 'stock.adjust', c.req.query('shopId') || null);
    if (!shops.length) need(c, 'stock.adjust');
    const { t } = orgOf(c);
    const rows = t.all<{ entity_id: string; after_json: string | null; shop_id: string; variant_id: string; qty_delta: number; name: string; options: string | null; created_by_name: string | null; recorded_at: number }>(
      `SELECT a.entity_id, a.after_json, m.shop_id, m.variant_id, m.qty_delta, ${productNameSql('p')} AS name, v.options, u.display_name AS created_by_name, m.recorded_at
         FROM audit_log a JOIN stock_movements m ON m.id = a.entity_id
         JOIN product_variants v ON v.id = m.variant_id JOIN products p ON p.id = v.product_id
         LEFT JOIN users u ON u.id = m.created_by
        WHERE a.org_id = @org AND m.org_id = @org AND a.action = 'stock.negative_accepted_offline'
          AND m.shop_id IN (SELECT value FROM json_each(@shops)) ORDER BY m.recorded_at DESC LIMIT 200`,
      { shops, loc: readerLocale(c, orgOf(c).org.default_locale) },
    );
    return c.json(
      rows.map((r) => ({
        movementId: r.entity_id,
        shopId: r.shop_id,
        variantId: r.variant_id,
        name: variantLabel(r.name, r.options, readerLocale(c, orgOf(c).org.default_locale)),
        qtyDelta: r.qty_delta,
        onHandAfter: parseJson<{ onHand?: number }>(r.after_json, {}).onHand ?? 0,
        createdByName: r.created_by_name,
        recordedAt: r.recorded_at,
      })),
    );
  });
}
