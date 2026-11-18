-- custock:foreign-keys-off (the files table is copied below, see migrate() in packages/db/src/open.ts)
-- a category gets an optional picture: one of the built in icons (icon_key, the keys live in
-- packages/core/src/category-icons.ts) or its own photo (image_file_id). setting one clears the other.
ALTER TABLE categories ADD COLUMN icon_key TEXT;
ALTER TABLE categories ADD COLUMN image_file_id TEXT REFERENCES files(id);

-- category photos are their own kind of file. sqlite cannot change a check constraint, so the
-- files table is copied over. the tables that point at files keep pointing at it by name, and every
-- key is checked before the migration commits.
CREATE TABLE files_new (
  id           TEXT PRIMARY KEY,
  org_id       TEXT REFERENCES organizations(id),
  storage_key  TEXT NOT NULL UNIQUE,
  purpose      TEXT NOT NULL CHECK (purpose IN ('logo','shop','product','post','export','import','avatar','category')),
  is_public    INTEGER NOT NULL DEFAULT 0,
  mime         TEXT NOT NULL,
  bytes        INTEGER NOT NULL,
  width        INTEGER,
  height       INTEGER,
  created_by   TEXT REFERENCES users(id),
  created_at   INTEGER NOT NULL,
  deleted_at   INTEGER,
  confirmed_at INTEGER
);
INSERT INTO files_new (id, org_id, storage_key, purpose, is_public, mime, bytes, width, height, created_by, created_at, deleted_at, confirmed_at)
  SELECT id, org_id, storage_key, purpose, is_public, mime, bytes, width, height, created_by, created_at, deleted_at, confirmed_at FROM files;
DROP TABLE files;
ALTER TABLE files_new RENAME TO files;
CREATE INDEX files_org ON files(org_id, purpose);
CREATE INDEX files_unconfirmed ON files(created_at) WHERE confirmed_at IS NULL AND deleted_at IS NULL;
