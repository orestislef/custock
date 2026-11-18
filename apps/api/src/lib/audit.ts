// audit log rows and the permissions version bump

import { uuidv7, type BusinessAuditAction } from '@custock/core';
import type { Tenant } from './tenant';

export function audit(
  t: Tenant,
  actor: { id: string | null; kind?: 'member' | 'platform_admin' | 'system' | 'customer' },
  action: BusinessAuditAction,
  entity: { type: string; id: string } | null,
  before: unknown = null,
  after: unknown = null,
  now = Date.now(),
) {
  // a super admin acting inside a business: marked here and kept in the platform audit as well
  const kind = actor.kind ?? (t.viaPlatform ? 'platform_admin' : 'member');
  if (kind === 'platform_admin') {
    t.db.prepare(
      `INSERT INTO platform_audit (id, actor_id, action, org_id, entity_type, entity_id, details_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(uuidv7(now), actor.id, action, t.orgId, entity?.type ?? null, entity?.id ?? null, before == null && after == null ? null : JSON.stringify({ before, after }), now);
  }
  t.run(
    `INSERT INTO audit_log (id, org_id, actor_id, actor_kind, action, entity_type, entity_id, before_json, after_json, created_at)
     VALUES (@id, @org, @actor, @kind, @action, @etype, @eid, @before, @after, @now)`,
    {
      id: uuidv7(now), actor: actor.id, kind, action,
      etype: entity?.type ?? null, eid: entity?.id ?? null,
      before: before == null ? null : JSON.stringify(before), after: after == null ? null : JSON.stringify(after), now,
    },
  );
}

// any change to a member's access bumps their version, so apps refetch /me/context
export function bumpPerms(t: Tenant, membershipIds: string[] | 'all') {
  if (membershipIds === 'all') t.run('UPDATE memberships SET perms_version = perms_version + 1 WHERE org_id = @org');
  else if (membershipIds.length)
    t.run('UPDATE memberships SET perms_version = perms_version + 1 WHERE org_id = @org AND id IN (SELECT value FROM json_each(@ids))', { ids: membershipIds });
}

// a monotonic updated_at so etags always change
export function nextStamp(previous: number | null | undefined, now: number): number {
  return previous != null && previous >= now ? previous + 1 : now;
}
