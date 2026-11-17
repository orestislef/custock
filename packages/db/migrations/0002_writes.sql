-- stage 2: idempotency keys for creates. same key from the same user within 24 hours returns the first answer.
CREATE TABLE idempotency_keys (
  user_id     TEXT NOT NULL,
  key         TEXT NOT NULL,
  org_id      TEXT,
  method      TEXT NOT NULL,
  path        TEXT NOT NULL,
  status      INTEGER NOT NULL,
  response    TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, key)
);
CREATE INDEX idempotency_keys_time ON idempotency_keys(created_at);

-- one job of a kind per dedupe key while it is pending (nightly rollups, send batches)
ALTER TABLE jobs ADD COLUMN dedupe_key TEXT;
CREATE UNIQUE INDEX jobs_dedupe_uq ON jobs(dedupe_key) WHERE dedupe_key IS NOT NULL AND done_at IS NULL;
