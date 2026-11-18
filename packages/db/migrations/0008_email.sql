-- emails keep their html next to the plain text, so the outbox shows and sends exactly that
ALTER TABLE dev_outbox ADD COLUMN html TEXT;

-- the first owner of a business is invited by the server setup, not by a person, so invited_by may
-- be empty. sqlite cannot drop a not null, the table is copied over.
CREATE TABLE invites_new (
  id           TEXT PRIMARY KEY,
  org_id       TEXT NOT NULL REFERENCES organizations(id),
  email        TEXT NOT NULL,
  role_id      TEXT NOT NULL REFERENCES roles(id),
  scope_type   TEXT NOT NULL CHECK (scope_type IN ('org','group','shop')),
  scope_id     TEXT NOT NULL,
  token_hash   TEXT NOT NULL UNIQUE,
  locale       TEXT NOT NULL DEFAULT 'en',
  invited_by   TEXT REFERENCES users(id),
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  accepted_at  INTEGER,
  accepted_by  TEXT REFERENCES users(id),
  revoked_at   INTEGER
);
INSERT INTO invites_new (id, org_id, email, role_id, scope_type, scope_id, token_hash, locale, invited_by, created_at, expires_at, accepted_at, accepted_by, revoked_at)
  SELECT id, org_id, email, role_id, scope_type, scope_id, token_hash, locale, invited_by, created_at, expires_at, accepted_at, accepted_by, revoked_at FROM invites;
DROP TABLE invites;
ALTER TABLE invites_new RENAME TO invites;
CREATE INDEX invites_org_email ON invites(org_id, email);
