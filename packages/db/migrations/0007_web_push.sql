-- web push (VAPID) subscriptions, one per browser or installed home screen app. the endpoint is
-- the browser's address at its push service and is unique: signing in as someone else on the same
-- browser moves it. org_id set means the home screen app of one business, which only gets that
-- business's pushes. null means every push of the user (the staff app, or the custock site).
CREATE TABLE push_subscriptions (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id),
  org_id         TEXT REFERENCES organizations(id),
  endpoint       TEXT NOT NULL UNIQUE,
  p256dh         TEXT NOT NULL,
  auth           TEXT NOT NULL,
  locale         TEXT CHECK (locale IN ('en','el','ru')),
  user_agent     TEXT,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  last_ok_at     INTEGER,
  failures       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX push_subscriptions_user ON push_subscriptions(user_id, org_id);
