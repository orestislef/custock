-- custock, draft schema. not final, for review.
--
-- written for sqlite, kept portable to postgres:
--   ids        uuid v7 as TEXT. sortable by time, can be made on the device (offline).
--   times      INTEGER, unix epoch milliseconds, utc. shown in the shop timezone.
--   money      INTEGER, minor units (cents) in the org currency. never floats.
--   quantity   INTEGER in base units. pieces = 1, kg/l/m are stored x1000 (grams, ml, mm).
--   booleans   INTEGER 0 or 1.
--   json       TEXT holding json, only for small flexible bits.
--   emails     stored trimmed and lowercased, so plain unique indexes work.
--   phones     stored as e164 (+306912345678).
--   org_id     on every business table, even when a parent already has it. every query filters on it.
--   soft delete via archived_at / deleted_at / erased_at. hard delete only for gdpr and org deletion.
--
-- polymorphic scopes (scope_type + scope_id) have no foreign key. the api checks them.

PRAGMA foreign_keys = ON;

-- =====================================================================
-- platform
-- =====================================================================

-- people who log in. id is the subject id from the auth server.
CREATE TABLE users (
  id             TEXT PRIMARY KEY,
  email          TEXT,
  phone          TEXT,
  display_name   TEXT,
  locale         TEXT NOT NULL DEFAULT 'en' CHECK (locale IN ('en','el','ru')),
  is_platform_admin INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  deleted_at     INTEGER
);
CREATE UNIQUE INDEX users_email_uq ON users(email) WHERE email IS NOT NULL AND deleted_at IS NULL;

-- one row per installed app. may live on the auth/fcm server instead, see 16-open-questions.
CREATE TABLE devices (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id),
  platform       TEXT NOT NULL CHECK (platform IN ('android','ios','web')),
  fcm_token      TEXT,
  app_version    TEXT,
  locale         TEXT,
  last_seen_at   INTEGER NOT NULL,
  revoked_at     INTEGER
);
CREATE UNIQUE INDEX devices_fcm_uq ON devices(fcm_token) WHERE fcm_token IS NOT NULL;
CREATE INDEX devices_user ON devices(user_id);

-- =====================================================================
-- tenancy
-- =====================================================================

CREATE TABLE organizations (
  id                    TEXT PRIMARY KEY,
  name                  TEXT NOT NULL,
  slug                  TEXT NOT NULL UNIQUE,
  country               TEXT NOT NULL DEFAULT 'GR',
  currency              TEXT NOT NULL DEFAULT 'EUR',
  timezone              TEXT NOT NULL DEFAULT 'Europe/Athens',
  default_locale        TEXT NOT NULL DEFAULT 'el' CHECK (default_locale IN ('en','el','ru')),
  logo_file_id          TEXT,
  brand_color           TEXT,
  allow_negative_stock  INTEGER NOT NULL DEFAULT 1,
  posts_need_approval   INTEGER NOT NULL DEFAULT 0,
  push_daily_cap        INTEGER NOT NULL DEFAULT 2,       -- max pushes per customer per day from this org
  quiet_hours           TEXT NOT NULL DEFAULT '22:00-09:00',
  support_access_until  INTEGER,
  created_at            INTEGER NOT NULL,
  archived_at           INTEGER
);

CREATE TABLE shops (
  id           TEXT PRIMARY KEY,
  org_id       TEXT NOT NULL REFERENCES organizations(id),
  name         TEXT NOT NULL,
  slug         TEXT NOT NULL,
  address      TEXT,
  city         TEXT,
  phone        TEXT,
  email        TEXT,
  timezone     TEXT,                    -- null means the org timezone
  lat          REAL,
  lng          REAL,
  opening_hours TEXT,                   -- json
  created_at   INTEGER NOT NULL,
  archived_at  INTEGER,
  UNIQUE (org_id, slug)
);
CREATE INDEX shops_org ON shops(org_id);

CREATE TABLE shop_groups (
  id           TEXT PRIMARY KEY,
  org_id       TEXT NOT NULL REFERENCES organizations(id),
  name         TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  archived_at  INTEGER
);
CREATE INDEX shop_groups_org ON shop_groups(org_id);

-- a shop can be in many groups
CREATE TABLE shop_group_shops (
  org_id     TEXT NOT NULL,
  group_id   TEXT NOT NULL REFERENCES shop_groups(id),
  shop_id    TEXT NOT NULL REFERENCES shops(id),
  added_at   INTEGER NOT NULL,
  PRIMARY KEY (group_id, shop_id)
);
CREATE INDEX shop_group_shops_shop ON shop_group_shops(shop_id);

-- =====================================================================
-- access: roles, members, invites
-- =====================================================================

-- default roles are copied into every new org, so each org can edit its own.
CREATE TABLE roles (
  id           TEXT PRIMARY KEY,
  org_id       TEXT NOT NULL REFERENCES organizations(id),
  template_key TEXT,                                   -- owner, admin, manager, staff, viewer. null for custom
  name         TEXT NOT NULL,                          -- custom roles: as typed. defaults: translated in the app by template_key
  rank         INTEGER NOT NULL CHECK (rank BETWEEN 1 AND 100),
  is_locked    INTEGER NOT NULL DEFAULT 0,             -- owner role
  created_by   TEXT REFERENCES users(id),
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  archived_at  INTEGER
);
CREATE INDEX roles_org ON roles(org_id);

CREATE TABLE role_permissions (
  role_id      TEXT NOT NULL REFERENCES roles(id),
  permission   TEXT NOT NULL,                          -- key from permissions.json, eg stock.adjust
  PRIMARY KEY (role_id, permission)
);

CREATE TABLE memberships (
  id             TEXT PRIMARY KEY,
  org_id         TEXT NOT NULL REFERENCES organizations(id),
  user_id        TEXT NOT NULL REFERENCES users(id),
  status         TEXT NOT NULL CHECK (status IN ('active','suspended','removed')),
  perms_version  INTEGER NOT NULL DEFAULT 1,           -- bumped on any change to this member's access
  joined_at      INTEGER NOT NULL,
  removed_at     INTEGER,
  UNIQUE (org_id, user_id)
);
CREATE INDEX memberships_user ON memberships(user_id);

CREATE TABLE role_assignments (
  id             TEXT PRIMARY KEY,
  org_id         TEXT NOT NULL,
  membership_id  TEXT NOT NULL REFERENCES memberships(id),
  role_id        TEXT NOT NULL REFERENCES roles(id),
  scope_type     TEXT NOT NULL CHECK (scope_type IN ('org','group','shop')),
  scope_id       TEXT NOT NULL,                        -- org id, group id or shop id
  granted_by     TEXT REFERENCES users(id),
  created_at     INTEGER NOT NULL,
  UNIQUE (membership_id, role_id, scope_type, scope_id)
);
CREATE INDEX role_assignments_scope ON role_assignments(org_id, scope_type, scope_id);

CREATE TABLE invites (
  id           TEXT PRIMARY KEY,
  org_id       TEXT NOT NULL REFERENCES organizations(id),
  email        TEXT NOT NULL,
  role_id      TEXT NOT NULL REFERENCES roles(id),
  scope_type   TEXT NOT NULL CHECK (scope_type IN ('org','group','shop')),
  scope_id     TEXT NOT NULL,
  token_hash   TEXT NOT NULL UNIQUE,                   -- only the hash, the token goes in the email
  locale       TEXT NOT NULL DEFAULT 'en',
  invited_by   TEXT NOT NULL REFERENCES users(id),
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  accepted_at  INTEGER,
  accepted_by  TEXT REFERENCES users(id),
  revoked_at   INTEGER
);
CREATE INDEX invites_org_email ON invites(org_id, email);

-- =====================================================================
-- files (images and exports in object storage)
-- =====================================================================

CREATE TABLE files (
  id           TEXT PRIMARY KEY,
  org_id       TEXT REFERENCES organizations(id),      -- null for platform files
  storage_key  TEXT NOT NULL UNIQUE,                   -- orgs/<org>/products/<uuid>.webp
  purpose      TEXT NOT NULL CHECK (purpose IN ('logo','product','post','export','import','avatar')),
  is_public    INTEGER NOT NULL DEFAULT 0,
  mime         TEXT NOT NULL,
  bytes        INTEGER NOT NULL,
  width        INTEGER,
  height       INTEGER,
  created_by   TEXT REFERENCES users(id),
  created_at   INTEGER NOT NULL,
  deleted_at   INTEGER
);
CREATE INDEX files_org ON files(org_id, purpose);

-- =====================================================================
-- catalog
-- =====================================================================

CREATE TABLE categories (
  id           TEXT PRIMARY KEY,
  org_id       TEXT NOT NULL REFERENCES organizations(id),
  parent_id    TEXT REFERENCES categories(id),
  name         TEXT NOT NULL,
  sort         INTEGER NOT NULL DEFAULT 0,
  archived_at  INTEGER
);
CREATE INDEX categories_org ON categories(org_id, parent_id);

CREATE TABLE products (
  id           TEXT PRIMARY KEY,
  org_id       TEXT NOT NULL REFERENCES organizations(id),
  category_id  TEXT REFERENCES categories(id),
  name         TEXT NOT NULL,                          -- in the org default language
  description  TEXT,
  brand        TEXT,
  uom          TEXT NOT NULL DEFAULT 'piece' CHECK (uom IN ('piece','kg','l','m')),
  tax_rate_bp  INTEGER NOT NULL DEFAULT 2400,          -- basis points. 2400 = 24%, 1300 = 13%, 600 = 6%
  track_stock  INTEGER NOT NULL DEFAULT 1,             -- 0 for services or things we do not count
  search_key   TEXT NOT NULL,                          -- normalised + transliterated name, see 09-languages
  created_by   TEXT REFERENCES users(id),
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  archived_at  INTEGER
);
CREATE INDEX products_org ON products(org_id, archived_at);
CREATE INDEX products_search ON products(org_id, search_key);

-- optional names in other languages (phase 2)
CREATE TABLE product_translations (
  product_id   TEXT NOT NULL REFERENCES products(id),
  locale       TEXT NOT NULL CHECK (locale IN ('en','el','ru')),
  name         TEXT NOT NULL,
  description  TEXT,
  PRIMARY KEY (product_id, locale)
);

-- every product has at least one variant. stock and barcodes live on variants.
CREATE TABLE product_variants (
  id           TEXT PRIMARY KEY,
  org_id       TEXT NOT NULL,
  product_id   TEXT NOT NULL REFERENCES products(id),
  sku          TEXT,
  options      TEXT,                                   -- json, {"size":"M","color":"black"}. null for the single default variant
  price_minor  INTEGER,                                -- retail price incl vat. null = no price yet
  cost_minor   INTEGER,                                -- last known unit cost. needs products.cost.view
  is_default   INTEGER NOT NULL DEFAULT 0,
  sort         INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  archived_at  INTEGER
);
CREATE INDEX variants_product ON product_variants(product_id);
CREATE UNIQUE INDEX variants_sku_uq ON product_variants(org_id, sku) WHERE sku IS NOT NULL AND archived_at IS NULL;

-- many barcodes per variant (ean on the item, ean on the box, our own label)
CREATE TABLE barcodes (
  id           TEXT PRIMARY KEY,
  org_id       TEXT NOT NULL,
  variant_id   TEXT NOT NULL REFERENCES product_variants(id),
  code         TEXT NOT NULL,                          -- as scanned
  code_norm    TEXT NOT NULL,                          -- normalised. retail codes become gtin-14, see 05-inventory
  symbology    TEXT,                                   -- ean13, ean8, upca, upce, itf14, code128, qr, internal
  pack_qty     INTEGER NOT NULL DEFAULT 1,             -- a box barcode can mean 12 pieces
  created_by   TEXT REFERENCES users(id),
  created_at   INTEGER NOT NULL
);
CREATE UNIQUE INDEX barcodes_org_code_uq ON barcodes(org_id, code_norm);
CREATE INDEX barcodes_variant ON barcodes(variant_id);

CREATE TABLE product_images (
  id           TEXT PRIMARY KEY,
  org_id       TEXT NOT NULL,
  product_id   TEXT NOT NULL REFERENCES products(id),
  variant_id   TEXT REFERENCES product_variants(id),   -- null = for all variants
  file_id      TEXT NOT NULL REFERENCES files(id),
  sort         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX product_images_product ON product_images(product_id);

-- per shop: price override, visibility, reorder point
CREATE TABLE shop_variant_settings (
  org_id               TEXT NOT NULL,
  shop_id              TEXT NOT NULL REFERENCES shops(id),
  variant_id           TEXT NOT NULL REFERENCES product_variants(id),
  price_override_minor INTEGER,
  is_listed            INTEGER NOT NULL DEFAULT 1,
  reorder_point        INTEGER,                        -- low stock alert when on_hand <= this
  reorder_qty          INTEGER,                        -- suggested amount to order
  updated_at           INTEGER NOT NULL,
  PRIMARY KEY (shop_id, variant_id)
);

-- scans that matched nothing, so a manager can fix them
CREATE TABLE unknown_scans (
  id           TEXT PRIMARY KEY,
  org_id       TEXT NOT NULL,
  shop_id      TEXT NOT NULL REFERENCES shops(id),
  code         TEXT NOT NULL,
  code_norm    TEXT NOT NULL,
  symbology    TEXT,
  scanned_by   TEXT NOT NULL REFERENCES users(id),
  scanned_at   INTEGER NOT NULL,
  times        INTEGER NOT NULL DEFAULT 1,
  resolved_at  INTEGER,
  resolved_variant_id TEXT REFERENCES product_variants(id)
);
CREATE UNIQUE INDEX unknown_scans_open_uq ON unknown_scans(org_id, shop_id, code_norm) WHERE resolved_at IS NULL;

-- =====================================================================
-- stock
-- =====================================================================

-- the ledger. append only. on hand = sum of qty_delta.
CREATE TABLE stock_movements (
  id               TEXT PRIMARY KEY,                   -- made on the device, also the idempotency key
  org_id           TEXT NOT NULL,
  shop_id          TEXT NOT NULL REFERENCES shops(id),
  variant_id       TEXT NOT NULL REFERENCES product_variants(id),
  qty_delta        INTEGER NOT NULL CHECK (qty_delta <> 0),
  kind             TEXT NOT NULL CHECK (kind IN (
                     'initial','receive','sale','return','adjust','damage',
                     'count','transfer_out','transfer_in','reversal')),
  reason           TEXT,                               -- found, lost, damaged, expired, theft, own_use, correction
  unit_price_minor INTEGER,                            -- sales and returns: the price at that moment
  unit_cost_minor  INTEGER,                            -- receives: the cost at that moment
  ref_type         TEXT,                               -- count, transfer, receipt, reversal
  ref_id           TEXT,
  batch_id         TEXT,                               -- groups a scan session ("receipt of 40 lines")
  note             TEXT,
  created_by       TEXT NOT NULL REFERENCES users(id),
  device_id        TEXT,
  occurred_at      INTEGER NOT NULL,                   -- device clock, what the user saw
  recorded_at      INTEGER NOT NULL                    -- server clock, the order of truth
);
CREATE INDEX movements_shop_variant ON stock_movements(shop_id, variant_id, recorded_at);
CREATE INDEX movements_org_time ON stock_movements(org_id, recorded_at);
CREATE INDEX movements_ref ON stock_movements(ref_type, ref_id);
CREATE INDEX movements_user ON stock_movements(org_id, created_by, recorded_at);

-- sqlite: block edits. postgres: same idea with a trigger function or revoked UPDATE/DELETE grants.
CREATE TRIGGER stock_movements_no_update BEFORE UPDATE ON stock_movements
BEGIN SELECT RAISE(ABORT, 'stock_movements is append only'); END;
CREATE TRIGGER stock_movements_no_delete BEFORE DELETE ON stock_movements
BEGIN SELECT RAISE(ABORT, 'stock_movements is append only'); END;

-- cached totals, updated in the same transaction as each movement. can be rebuilt from the ledger.
CREATE TABLE stock_levels (
  org_id            TEXT NOT NULL,
  shop_id           TEXT NOT NULL REFERENCES shops(id),
  variant_id        TEXT NOT NULL REFERENCES product_variants(id),
  on_hand           INTEGER NOT NULL DEFAULT 0,
  in_transit_in     INTEGER NOT NULL DEFAULT 0,        -- sent to this shop, not received yet
  low_alert_sent_at INTEGER,                           -- so we alert once per dip, not on every sale
  last_movement_at  INTEGER,
  PRIMARY KEY (shop_id, variant_id)
);
CREATE INDEX stock_levels_org ON stock_levels(org_id, variant_id);

CREATE TABLE stock_counts (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL,
  shop_id       TEXT NOT NULL REFERENCES shops(id),
  kind          TEXT NOT NULL CHECK (kind IN ('full','partial')),
  filter        TEXT,                                  -- json, eg {"category_id":"..."} for partial counts
  status        TEXT NOT NULL CHECK (status IN ('open','review','applied','cancelled')),
  started_by    TEXT NOT NULL REFERENCES users(id),
  started_at    INTEGER NOT NULL,
  submitted_at  INTEGER,
  applied_by    TEXT REFERENCES users(id),
  applied_at    INTEGER,
  uncounted_policy TEXT CHECK (uncounted_policy IN ('ignore','set_zero'))  -- asked on apply for full counts
);
CREATE INDEX stock_counts_shop ON stock_counts(shop_id, status);

CREATE TABLE stock_count_lines (
  count_id      TEXT NOT NULL REFERENCES stock_counts(id),
  org_id        TEXT NOT NULL,
  variant_id    TEXT NOT NULL REFERENCES product_variants(id),
  counted_qty   INTEGER NOT NULL,
  expected_qty  INTEGER NOT NULL,                      -- on hand at the moment of the last count of this line (server side)
  counted_by    TEXT NOT NULL REFERENCES users(id),
  counted_at    INTEGER NOT NULL,
  PRIMARY KEY (count_id, variant_id)
);

CREATE TABLE transfers (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL,
  from_shop_id  TEXT NOT NULL REFERENCES shops(id),
  to_shop_id    TEXT NOT NULL REFERENCES shops(id),
  status        TEXT NOT NULL CHECK (status IN ('draft','sent','received','cancelled')),
  note          TEXT,
  created_by    TEXT NOT NULL REFERENCES users(id),
  created_at    INTEGER NOT NULL,
  sent_by       TEXT REFERENCES users(id),
  sent_at       INTEGER,
  received_by   TEXT REFERENCES users(id),
  received_at   INTEGER,
  CHECK (from_shop_id <> to_shop_id)
);
CREATE INDEX transfers_to ON transfers(to_shop_id, status);
CREATE INDEX transfers_from ON transfers(from_shop_id, status);

CREATE TABLE transfer_lines (
  transfer_id   TEXT NOT NULL REFERENCES transfers(id),
  org_id        TEXT NOT NULL,
  variant_id    TEXT NOT NULL REFERENCES product_variants(id),
  qty_sent      INTEGER NOT NULL CHECK (qty_sent > 0),
  qty_received  INTEGER CHECK (qty_received >= 0),
  PRIMARY KEY (transfer_id, variant_id)
);

-- =====================================================================
-- customers
-- =====================================================================

CREATE TABLE customers (
  id                 TEXT PRIMARY KEY,
  org_id             TEXT NOT NULL REFERENCES organizations(id),
  user_id            TEXT REFERENCES users(id),        -- set when they use the app with an account
  name               TEXT,
  email              TEXT,
  email_verified_at  INTEGER,
  phone              TEXT,
  phone_verified_at  INTEGER,
  locale             TEXT NOT NULL DEFAULT 'el' CHECK (locale IN ('en','el','ru')),
  birthday           TEXT,                             -- 'MM-DD', no year
  -- current consent per channel, cached from the consents ledger
  email_ok           INTEGER NOT NULL DEFAULT 0,
  push_ok            INTEGER NOT NULL DEFAULT 0,
  sms_ok             INTEGER NOT NULL DEFAULT 0,
  source             TEXT NOT NULL CHECK (source IN ('join_link','app','staff','import')),
  join_link_id       TEXT,
  search_key         TEXT,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL,
  erased_at          INTEGER                           -- gdpr erase: personal fields wiped, row kept for counts
);
CREATE UNIQUE INDEX customers_org_email_uq ON customers(org_id, email) WHERE email IS NOT NULL AND erased_at IS NULL;
CREATE UNIQUE INDEX customers_org_phone_uq ON customers(org_id, phone) WHERE phone IS NOT NULL AND erased_at IS NULL;
CREATE UNIQUE INDEX customers_org_user_uq ON customers(org_id, user_id) WHERE user_id IS NOT NULL;
CREATE INDEX customers_search ON customers(org_id, search_key);

-- who follows what. most specific row wins, see 06-customers-and-comms.
CREATE TABLE customer_subscriptions (
  id             TEXT PRIMARY KEY,
  org_id         TEXT NOT NULL,
  customer_id    TEXT NOT NULL REFERENCES customers(id),
  scope_type     TEXT NOT NULL CHECK (scope_type IN ('org','group','shop')),
  scope_id       TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('pending','subscribed','unsubscribed')),
  source         TEXT,
  join_link_id   TEXT,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  UNIQUE (customer_id, scope_type, scope_id)
);
CREATE INDEX customer_subscriptions_scope ON customer_subscriptions(org_id, scope_type, scope_id, status);

-- consent ledger. append only. proof of who agreed to what, when, and to which wording.
CREATE TABLE consents (
  id             TEXT PRIMARY KEY,
  org_id         TEXT NOT NULL,
  customer_id    TEXT NOT NULL REFERENCES customers(id),
  channel        TEXT NOT NULL CHECK (channel IN ('email','push','sms')),
  granted        INTEGER NOT NULL,                     -- 1 granted, 0 withdrawn
  text_version   TEXT NOT NULL,                        -- the exact consent wording, eg 'el-2026-11'
  source         TEXT NOT NULL,                        -- join_page, app, unsubscribe_link, staff, import, double_opt_in
  ip             TEXT,
  user_agent     TEXT,
  created_at     INTEGER NOT NULL
);
CREATE INDEX consents_customer ON consents(customer_id, channel, created_at);

CREATE TABLE customer_tags (
  org_id       TEXT NOT NULL,
  customer_id  TEXT NOT NULL REFERENCES customers(id),
  tag          TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (customer_id, tag)
);
CREATE INDEX customer_tags_tag ON customer_tags(org_id, tag);

CREATE TABLE customer_interests (
  org_id       TEXT NOT NULL,
  customer_id  TEXT NOT NULL REFERENCES customers(id),
  category_id  TEXT NOT NULL REFERENCES categories(id),
  PRIMARY KEY (customer_id, category_id)
);

CREATE TABLE customer_notes (
  id           TEXT PRIMARY KEY,
  org_id       TEXT NOT NULL,
  customer_id  TEXT NOT NULL REFERENCES customers(id),
  body         TEXT NOT NULL,
  author_id    TEXT NOT NULL REFERENCES users(id),
  created_at   INTEGER NOT NULL,
  deleted_at   INTEGER
);
CREATE INDEX customer_notes_customer ON customer_notes(customer_id);

-- QR codes and links that let people join
CREATE TABLE join_links (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL,
  code          TEXT NOT NULL UNIQUE,                  -- short random code: <domain>/j/<code>
  scope_type    TEXT NOT NULL CHECK (scope_type IN ('org','group','shop')),
  scope_id      TEXT NOT NULL,
  label         TEXT,                                  -- "window poster", "instagram bio", "receipt"
  default_tags  TEXT,                                  -- json array, added to everyone who joins here
  created_by    TEXT NOT NULL REFERENCES users(id),
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER,
  disabled_at   INTEGER
);
CREATE INDEX join_links_org ON join_links(org_id);

-- "tell me when it is back"
CREATE TABLE stock_alerts (
  id           TEXT PRIMARY KEY,
  org_id       TEXT NOT NULL,
  customer_id  TEXT NOT NULL REFERENCES customers(id),
  variant_id   TEXT NOT NULL REFERENCES product_variants(id),
  shop_id      TEXT REFERENCES shops(id),              -- null = any shop of the org
  status       TEXT NOT NULL CHECK (status IN ('waiting','notified','cancelled')),
  created_at   INTEGER NOT NULL,
  notified_at  INTEGER
);
CREATE UNIQUE INDEX stock_alerts_waiting_uq ON stock_alerts(customer_id, variant_id, COALESCE(shop_id, '')) WHERE status = 'waiting';
CREATE INDEX stock_alerts_variant ON stock_alerts(variant_id, status);

-- =====================================================================
-- comms
-- =====================================================================

CREATE TABLE posts (
  id                TEXT PRIMARY KEY,
  org_id            TEXT NOT NULL,
  kind              TEXT NOT NULL CHECK (kind IN ('news','offer','new_arrival','back_in_stock','event')),
  status            TEXT NOT NULL CHECK (status IN ('draft','pending_approval','scheduled','sending','sent','cancelled','failed')),
  default_locale    TEXT NOT NULL CHECK (default_locale IN ('en','el','ru')),
  channels          TEXT NOT NULL,                     -- json array of feed, push, email
  audience          TEXT NOT NULL,                     -- json: scopes, tags, interests, locales, filters
  cover_file_id     TEXT REFERENCES files(id),
  scheduled_at      INTEGER,
  valid_until       INTEGER,                           -- offer end, drops off the feed after
  author_id         TEXT NOT NULL REFERENCES users(id),
  approved_by       TEXT REFERENCES users(id),
  sent_at           INTEGER,
  recipients_count  INTEGER,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  deleted_at        INTEGER
);
CREATE INDEX posts_org_status ON posts(org_id, status, scheduled_at);

CREATE TABLE post_translations (
  post_id   TEXT NOT NULL REFERENCES posts(id),
  locale    TEXT NOT NULL CHECK (locale IN ('en','el','ru')),
  title     TEXT NOT NULL,
  body      TEXT NOT NULL,
  PRIMARY KEY (post_id, locale)
);

-- which scopes a post was sent to, resolved at send time. used for the feed.
CREATE TABLE post_scopes (
  post_id     TEXT NOT NULL REFERENCES posts(id),
  org_id      TEXT NOT NULL,
  scope_type  TEXT NOT NULL CHECK (scope_type IN ('org','group','shop')),
  scope_id    TEXT NOT NULL,
  PRIMARY KEY (post_id, scope_type, scope_id)
);
CREATE INDEX post_scopes_scope ON post_scopes(org_id, scope_type, scope_id);

CREATE TABLE post_products (
  post_id     TEXT NOT NULL REFERENCES posts(id),
  variant_id  TEXT NOT NULL REFERENCES product_variants(id),
  sort        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (post_id, variant_id)
);

CREATE TABLE post_media (
  post_id   TEXT NOT NULL REFERENCES posts(id),
  file_id   TEXT NOT NULL REFERENCES files(id),
  sort      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (post_id, file_id)
);

-- one row per customer per channel per message. the send queue and the stats.
CREATE TABLE deliveries (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL,
  post_id       TEXT REFERENCES posts(id),             -- null for system messages (back in stock, double opt in)
  alert_id      TEXT REFERENCES stock_alerts(id),
  customer_id   TEXT NOT NULL REFERENCES customers(id),
  channel       TEXT NOT NULL CHECK (channel IN ('push','email','sms')),
  status        TEXT NOT NULL CHECK (status IN ('queued','held','sent','failed','bounced','opened','clicked','skipped')),
  skip_reason   TEXT,                                  -- no_consent, cap_reached, suppressed, no_device
  error         TEXT,
  provider_id   TEXT,
  send_after    INTEGER,                               -- quiet hours push this forward
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE UNIQUE INDEX deliveries_post_uq ON deliveries(post_id, customer_id, channel) WHERE post_id IS NOT NULL;
CREATE INDEX deliveries_queue ON deliveries(status, send_after);
CREATE INDEX deliveries_customer ON deliveries(customer_id, created_at);

-- emails that bounced or complained. platform wide, protects the sending reputation of everyone.
CREATE TABLE email_suppressions (
  email       TEXT PRIMARY KEY,
  reason      TEXT NOT NULL CHECK (reason IN ('hard_bounce','complaint','manual')),
  created_at  INTEGER NOT NULL
);

-- =====================================================================
-- reports: daily rollups so dashboards stay fast on sqlite
-- =====================================================================

CREATE TABLE daily_shop_stats (
  org_id               TEXT NOT NULL,
  shop_id              TEXT NOT NULL,
  day                  TEXT NOT NULL,                  -- 'YYYY-MM-DD' in the shop timezone
  sales_qty            INTEGER NOT NULL DEFAULT 0,
  sales_value_minor    INTEGER NOT NULL DEFAULT 0,
  returns_qty          INTEGER NOT NULL DEFAULT 0,
  received_qty         INTEGER NOT NULL DEFAULT 0,
  received_cost_minor  INTEGER NOT NULL DEFAULT 0,
  shrink_qty           INTEGER NOT NULL DEFAULT 0,     -- damage + negative adjust + negative count
  shrink_cost_minor    INTEGER NOT NULL DEFAULT 0,
  new_customers        INTEGER NOT NULL DEFAULT 0,
  unsubscribes         INTEGER NOT NULL DEFAULT 0,
  posts_sent           INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (shop_id, day)
);

CREATE TABLE daily_variant_stats (
  org_id        TEXT NOT NULL,
  shop_id       TEXT NOT NULL,
  variant_id    TEXT NOT NULL,
  day           TEXT NOT NULL,
  sold_qty      INTEGER NOT NULL DEFAULT 0,
  received_qty  INTEGER NOT NULL DEFAULT 0,
  closing_qty   INTEGER NOT NULL,                      -- on hand at end of day
  PRIMARY KEY (shop_id, variant_id, day)
);

CREATE TABLE join_link_stats_daily (
  org_id        TEXT NOT NULL,
  join_link_id  TEXT NOT NULL REFERENCES join_links(id),
  day           TEXT NOT NULL,
  opens         INTEGER NOT NULL DEFAULT 0,
  signups       INTEGER NOT NULL DEFAULT 0,
  confirmed     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (join_link_id, day)
);

-- =====================================================================
-- audit and jobs
-- =====================================================================

CREATE TABLE audit_log (
  id            TEXT PRIMARY KEY,
  org_id        TEXT,                                  -- null for platform events
  actor_id      TEXT REFERENCES users(id),
  actor_kind    TEXT NOT NULL CHECK (actor_kind IN ('member','platform_admin','system','customer')),
  action        TEXT NOT NULL,                         -- role.assigned, product.price_changed, customers.exported ...
  entity_type   TEXT,
  entity_id     TEXT,
  before_json   TEXT,
  after_json    TEXT,
  ip            TEXT,
  created_at    INTEGER NOT NULL
);
CREATE INDEX audit_org_time ON audit_log(org_id, created_at);
CREATE INDEX audit_entity ON audit_log(entity_type, entity_id);

-- simple job queue in the database. one worker, no extra services.
CREATE TABLE jobs (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL,                         -- send_post, send_alerts, rollup_day, cleanup_files, weekly_report
  payload       TEXT NOT NULL,                         -- json
  run_at        INTEGER NOT NULL,
  attempts      INTEGER NOT NULL DEFAULT 0,
  max_attempts  INTEGER NOT NULL DEFAULT 5,
  locked_until  INTEGER,
  last_error    TEXT,
  done_at       INTEGER,
  created_at    INTEGER NOT NULL
);
CREATE INDEX jobs_ready ON jobs(done_at, run_at);
