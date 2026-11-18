-- pre launch security fixes.

-- an upload slot is only a promise. a file counts toward the storage meter once it is confirmed:
-- the bytes arrived (local storage) or it was put on a product, post, logo or profile. slots
-- never used are purged after an hour. everything stored before this counts as confirmed.
ALTER TABLE files ADD COLUMN confirmed_at INTEGER;
UPDATE files SET confirmed_at = created_at;
CREATE INDEX files_unconfirmed ON files(created_at) WHERE confirmed_at IS NULL AND deleted_at IS NULL;

-- the notice to the old address after a login email change carries a one click way back,
-- 7 days. only a hash of the token is kept.
CREATE TABLE email_reverts (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id),
  token_hash   TEXT NOT NULL UNIQUE,
  old_email    TEXT NOT NULL,
  new_email    TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  used_at      INTEGER
);
CREATE INDEX email_reverts_user ON email_reverts(user_id);

-- a fresh code by email confirms deleting an account that has no password
CREATE TABLE account_codes (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id),
  purpose      TEXT NOT NULL CHECK (purpose IN ('delete')),
  code_hash    TEXT NOT NULL,
  attempts     INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  used_at      INTEGER
);
CREATE INDEX account_codes_user ON account_codes(user_id, purpose, used_at);

-- a refresh session family ends 90 days after the first sign in, however often it is refreshed
ALTER TABLE sessions ADD COLUMN family_started_at INTEGER;
UPDATE sessions SET family_started_at = (SELECT min(s2.created_at) FROM sessions s2 WHERE s2.family_id = sessions.family_id);
