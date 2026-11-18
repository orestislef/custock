-- the platform level above every business: super admins, their invites and their audit trail.
-- a super admin is not a member of any business. access comes from users.platform_role and is
-- resolved where every other permission is (apps/api/src/lib/context.ts).

ALTER TABLE users ADD COLUMN platform_role TEXT CHECK (platform_role IN ('superadmin'));
UPDATE users SET platform_role = 'superadmin' WHERE is_platform_admin = 1;

-- invites to become a super admin. the link is the proof, an existing account signs in and accepts
CREATE TABLE platform_invites (
  id           TEXT PRIMARY KEY,
  email        TEXT NOT NULL,
  role         TEXT NOT NULL DEFAULT 'superadmin' CHECK (role IN ('superadmin')),
  token_hash   TEXT NOT NULL UNIQUE,
  locale       TEXT NOT NULL DEFAULT 'en',
  invited_by   TEXT REFERENCES users(id),
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  accepted_at  INTEGER,
  accepted_by  TEXT REFERENCES users(id),
  revoked_at   INTEGER
);
CREATE INDEX platform_invites_email ON platform_invites(email);

-- every super admin action: inside a business (also in that business's audit_log, marked
-- platform_admin) and above them (businesses created, owners and super admins invited)
CREATE TABLE platform_audit (
  id            TEXT PRIMARY KEY,
  actor_id      TEXT REFERENCES users(id),
  action        TEXT NOT NULL,
  org_id        TEXT,
  entity_type   TEXT,
  entity_id     TEXT,
  details_json  TEXT,
  created_at    INTEGER NOT NULL
);
CREATE INDEX platform_audit_time ON platform_audit(created_at);
CREATE INDEX platform_audit_org ON platform_audit(org_id, created_at);

-- what a super admin decides for each business: features switched off (a json array of keys,
-- empty means everything on), limits (null means none) and whether the business is paused
ALTER TABLE organizations ADD COLUMN disabled_features TEXT NOT NULL DEFAULT '[]';
ALTER TABLE organizations ADD COLUMN max_shops INTEGER;
ALTER TABLE organizations ADD COLUMN max_staff INTEGER;
ALTER TABLE organizations ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended'));
ALTER TABLE organizations ADD COLUMN status_changed_at INTEGER;

-- platform wide emergency switches: pause_email, pause_push, pause_signups, pause_invites
CREATE TABLE platform_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_by  TEXT REFERENCES users(id),
  updated_at  INTEGER NOT NULL
);
