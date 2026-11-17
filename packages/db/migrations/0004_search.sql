-- search and report speed. the FTS5 tables are created from code right after this file, and only
-- when the sqlite build has FTS5 (see FIXUPS in src/open.ts). without it the api falls back to LIKE.

-- covering index: sales reports read only the index
CREATE INDEX movements_org_kind_time ON stock_movements(org_id, kind, recorded_at, shop_id, variant_id, qty_delta, unit_price_minor);
CREATE INDEX movements_org_shop_time ON stock_movements(org_id, shop_id, recorded_at);
CREATE INDEX customers_org_created ON customers(org_id, created_at);
CREATE INDEX stock_alerts_org_status ON stock_alerts(org_id, status, variant_id);
CREATE INDEX deliveries_org_post ON deliveries(org_id, post_id, status);
CREATE INDEX variants_org_product ON product_variants(org_id, product_id);
CREATE INDEX subscriptions_org_customer ON customer_subscriptions(org_id, customer_id);
CREATE INDEX products_org_name ON products(org_id, name);
