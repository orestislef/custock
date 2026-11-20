-- orders and price requests from customers (thinking/19-orders.md)

-- off: no orders. quote: every order asks for a price. priced: orders at the shown prices when every
-- line has one, a request for a price otherwise
ALTER TABLE organizations ADD COLUMN customer_orders TEXT NOT NULL DEFAULT 'off' CHECK (customer_orders IN ('off', 'quote', 'priced'));
-- null: the business setting. 'off': this shop takes no orders
ALTER TABLE shops ADD COLUMN customer_orders TEXT CHECK (customer_orders IN ('off'));

-- the number people use for an order, per business, from 1001
CREATE TABLE order_counters (
  org_id       TEXT PRIMARY KEY REFERENCES organizations(id),
  next_number  INTEGER NOT NULL
);

CREATE TABLE orders (
  id                 TEXT PRIMARY KEY,
  org_id             TEXT NOT NULL REFERENCES organizations(id),
  shop_id            TEXT NOT NULL REFERENCES shops(id),
  number             INTEGER NOT NULL,
  customer_id        TEXT NOT NULL REFERENCES customers(id),
  status             TEXT NOT NULL CHECK (status IN ('requested', 'quoted', 'confirmed', 'ready', 'completed', 'declined', 'rejected', 'cancelled', 'expired')),
  -- 1: sent at the shown prices, the shop only confirms
  priced             INTEGER NOT NULL DEFAULT 0,
  note               TEXT,
  -- the day the customer needs it, YYYY-MM-DD in the business's time zone
  wanted_on          TEXT,
  locale             TEXT NOT NULL DEFAULT 'el' CHECK (locale IN ('en', 'el', 'ru')),
  currency           TEXT NOT NULL,
  -- null while the price is not known yet
  total_minor        INTEGER,
  quote_valid_until  INTEGER,
  quote_message      TEXT,
  quoted_by          TEXT REFERENCES users(id),
  quoted_at          INTEGER,
  cancel_reason      TEXT,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL,
  closed_at          INTEGER,
  UNIQUE (org_id, number)
);
CREATE INDEX orders_org_list ON orders(org_id, status, updated_at);
CREATE INDEX orders_shop_list ON orders(org_id, shop_id, status, updated_at);
CREATE INDEX orders_customer ON orders(org_id, customer_id, created_at);
CREATE INDEX orders_quote_expiry ON orders(quote_valid_until) WHERE status = 'quoted';

CREATE TABLE order_lines (
  order_id          TEXT NOT NULL REFERENCES orders(id),
  org_id            TEXT NOT NULL REFERENCES organizations(id),
  line_no           INTEGER NOT NULL,
  variant_id        TEXT NOT NULL REFERENCES product_variants(id),
  product_id        TEXT NOT NULL REFERENCES products(id),
  -- the name when ordered, so the order still reads right after a rename or an archive
  product_name      TEXT NOT NULL,
  uom               TEXT NOT NULL,
  tax_rate_bp       INTEGER NOT NULL,
  -- base units (pieces, grams, ml, mm) like the ledger
  qty               INTEGER NOT NULL CHECK (qty > 0),
  requested_qty     INTEGER NOT NULL CHECK (requested_qty > 0),
  -- with VAT, per piece or per kg/l/m. null while not known
  unit_price_minor  INTEGER,
  line_total_minor  INTEGER,
  note              TEXT,
  PRIMARY KEY (order_id, line_no)
);
CREATE INDEX order_lines_variant ON order_lines(org_id, variant_id);

-- every step, who did it and what changed
CREATE TABLE order_events (
  id          TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL REFERENCES organizations(id),
  order_id    TEXT NOT NULL REFERENCES orders(id),
  at          INTEGER NOT NULL,
  actor_type  TEXT NOT NULL CHECK (actor_type IN ('customer', 'staff', 'system')),
  actor_id    TEXT,
  kind        TEXT NOT NULL,
  data        TEXT
);
CREATE INDEX order_events_order ON order_events(order_id, at);

-- the new permissions for the roles every business already has
INSERT OR IGNORE INTO role_permissions (role_id, permission)
  SELECT r.id, p.key FROM roles r, (SELECT 'orders.view' AS key UNION ALL SELECT 'orders.quote' UNION ALL SELECT 'orders.fulfil') p
   WHERE r.template_key IN ('owner', 'admin', 'manager') AND r.archived_at IS NULL;
INSERT OR IGNORE INTO role_permissions (role_id, permission)
  SELECT r.id, p.key FROM roles r, (SELECT 'orders.view' AS key UNION ALL SELECT 'orders.fulfil') p
   WHERE r.template_key = 'staff' AND r.archived_at IS NULL;
INSERT OR IGNORE INTO role_permissions (role_id, permission)
  SELECT id, 'orders.view' FROM roles WHERE template_key = 'viewer' AND archived_at IS NULL;
