-- forgot password: one time links for accounts with a password. only a hash of the token is kept.
-- a newer request ends the older open ones, a used or expired link never works again.

CREATE TABLE password_resets (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  token_hash  TEXT NOT NULL UNIQUE,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  used_at     INTEGER,
  ip          TEXT
);
CREATE INDEX password_resets_user ON password_resets(user_id, used_at);
