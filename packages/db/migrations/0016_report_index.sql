-- reports skip sales and losses someone took back with undo (a reversal points at them). that check
-- reads the movement id, which the report index did not hold, so every row of the period went back
-- to the table. the same index with the id at the end keeps those reports on the index alone.
CREATE INDEX movements_org_kind_time_id ON stock_movements(org_id, kind, recorded_at, shop_id, variant_id, qty_delta, unit_price_minor, id);
DROP INDEX IF EXISTS movements_org_kind_time;

-- whether a customer is subscribed (the super admin numbers, the customer lists) reads the status and
-- the scope too. with them in the index those checks never go back to the table.
CREATE INDEX subscriptions_org_customer_status ON customer_subscriptions(org_id, customer_id, status, scope_type, scope_id);
DROP INDEX IF EXISTS subscriptions_org_customer;
