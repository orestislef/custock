-- errors seen in production, for the super admin. one row per issue: occurrences with the same
-- fingerprint (kind, normalized message, top stack frame, route) are counted on the same row, with
-- the newest example kept. nothing personal is stored: messages and stacks are scrubbed before
-- they get here, and user and org are ids only. kept 30 days, at most 500 issues.

CREATE TABLE error_events (
  id           TEXT PRIMARY KEY,
  fingerprint  TEXT NOT NULL UNIQUE,
  kind         TEXT NOT NULL CHECK (kind IN ('api', 'worker', 'send', 'storage', 'client')),
  title        TEXT NOT NULL,
  route        TEXT,
  frame        TEXT,
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'ignored')),
  count        INTEGER NOT NULL DEFAULT 1,
  first_seen   INTEGER NOT NULL,
  last_seen    INTEGER NOT NULL,
  resolved_at  INTEGER,
  notified_at  INTEGER,
  -- json: message, stack, method, route, status, release, userId, orgId, browser, os, build, requestId
  example      TEXT NOT NULL
);

CREATE INDEX error_events_list ON error_events (status, last_seen DESC);
CREATE INDEX error_events_seen ON error_events (last_seen);
CREATE INDEX error_events_notified ON error_events (notified_at) WHERE notified_at IS NOT NULL;
