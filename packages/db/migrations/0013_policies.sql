-- the policy engine (packages/core/src/policies.ts): values for every limit and option at the
-- levels platform, limit (a super admin's ceiling for one business), delegate (whether the
-- business may change a key), business, shop, role and user. business values of the older
-- settings stay in their organizations columns; this table holds everything else.

CREATE TABLE policy_values (
  level       TEXT NOT NULL CHECK (level IN ('platform','limit','delegate','business','shop','role','user')),
  org_id      TEXT NOT NULL DEFAULT '',   -- '' for platform values
  target_id   TEXT NOT NULL DEFAULT '',   -- the shop, role or user id, '' otherwise
  key         TEXT NOT NULL,
  value_json  TEXT NOT NULL,
  updated_by  TEXT,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (level, org_id, target_id, key)
);
CREATE INDEX policy_values_org ON policy_values(org_id, level);

-- changing push limits is its own permission now, owners and admins have it from the start
INSERT OR IGNORE INTO role_permissions (role_id, permission)
  SELECT id, 'settings.push' FROM roles WHERE template_key IN ('owner', 'admin') AND archived_at IS NULL;
