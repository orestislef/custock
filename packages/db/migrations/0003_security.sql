-- fixes from the security review

-- contact details are matched exactly, never by substring, and only for callers allowed to see them
ALTER TABLE customers ADD COLUMN contact_key TEXT;
CREATE INDEX customers_contact ON customers(org_id, contact_key);

-- what someone asked for on a join page waits with the confirmation token and applies only on click
ALTER TABLE join_confirmations ADD COLUMN scope_type TEXT;
ALTER TABLE join_confirmations ADD COLUMN scope_id TEXT;
ALTER TABLE join_confirmations ADD COLUMN email_news INTEGER NOT NULL DEFAULT 0;
ALTER TABLE join_confirmations ADD COLUMN push INTEGER NOT NULL DEFAULT 0;
ALTER TABLE join_confirmations ADD COLUMN locale TEXT;
ALTER TABLE join_confirmations ADD COLUMN source TEXT;
ALTER TABLE join_confirmations ADD COLUMN ip TEXT;
ALTER TABLE join_confirmations ADD COLUMN user_agent TEXT;

-- per email throttles for login and one time codes, kept across restarts
CREATE TABLE auth_throttle (
  key           TEXT PRIMARY KEY,
  count         INTEGER NOT NULL,
  window_start  INTEGER NOT NULL,
  locked_until  INTEGER
);

-- rows that are really deleted (barcodes), so offline phones learn about it through sync
CREATE TABLE deleted_rows (
  org_id      TEXT NOT NULL,
  entity      TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  deleted_at  INTEGER NOT NULL
);
CREATE INDEX deleted_rows_time ON deleted_rows(org_id, entity, deleted_at);

-- account email changes wait for a code sent to the new address
CREATE TABLE email_changes (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  new_email   TEXT NOT NULL,
  code_hash   TEXT NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  used_at     INTEGER
);
CREATE INDEX email_changes_user ON email_changes(user_id, created_at);
