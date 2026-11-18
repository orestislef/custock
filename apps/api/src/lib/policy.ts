// the policy engine on the server: reads every level of a key from the database, resolves the value
// in force (packages/core/src/policies.ts), and changes values with the authority rules:
//
//   - platform values and business ceilings: super admins only
//   - business and shop values: the key's permission, and the super admin lets the business change it
//   - role values: roles.manage, a role below the actor's rank, never a role the actor holds
//   - user values: members.manage over every assignment of a person below the actor's rank, never
//     the actor themselves. people change only their own preferences (selfService keys)
//   - nobody gives a value beyond their own effective value; super admin values bind owners
//
// business values of the older settings live in their organizations columns. they are kept inside
// the ceilings here (written through), so every place that reads a column stays right.

import {
  coerce, effectiveAtScope, inBounds, isPlatformActor, canManageMember, POLICIES, policyDef, resolvePolicy, within, hasLevel, uuidv7,
  type AccessAssignment, type PolicyDef, type PolicyLayers, type PolicyPatch, type PolicyValue, type PolicyEntry, type Topology,
  type BusinessPolicyControl, type BusinessPolicyControlsPatch, type PlatformPolicyEntry, type ErrorCode,
  type BusinessAuditAction, type PlatformAuditAction,
} from '@custock/core';
import type { Db } from '@custock/db';
import { ApiProblem } from './problem';
import { platform } from './tenant';

type Level = 'platform' | 'limit' | 'delegate' | 'business' | 'shop' | 'role' | 'user';
interface Row { level: Level; org_id: string; target_id: string; key: string; value_json: string }

const parse = (def: PolicyDef, json: string): PolicyValue | null => {
  try {
    return coerce(def, JSON.parse(json));
  } catch {
    return null;
  }
};

// ------------------------------------------------------------------ reading

// platform values change rarely and are read on hot paths (sign in, rate limits): kept in memory
// per database, dropped on every write through this module
const platformCache = new WeakMap<Db, Map<string, PolicyValue>>();

function platformValues(db: Db): Map<string, PolicyValue> {
  let m = platformCache.get(db);
  if (m) return m;
  m = new Map();
  for (const r of platform(db).all<Row>("SELECT level, org_id, target_id, key, value_json FROM policy_values WHERE level = 'platform'")) {
    const def = policyDef(r.key);
    const v = def ? parse(def, r.value_json) : null;
    if (def && v !== null) m.set(r.key, v);
  }
  platformCache.set(db, m);
  return m;
}

// the env var of a key replaces its built in default, the stored platform value replaces both
function envDefault(def: PolicyDef): PolicyValue {
  const raw = def.env ? process.env[def.env] : undefined;
  return raw !== undefined ? coerce(def, raw) ?? def.default : def.default;
}

export function platformPolicy(db: Db, key: string): PolicyValue {
  const def = policyDef(key);
  if (!def) throw new Error(`unknown policy ${key}`);
  return platformValues(db).get(key) ?? envDefault(def);
}

// number shorthand for limits read in code
export function policyNumber(db: Db, key: string): number {
  return Number(platformPolicy(db, key));
}

interface OrgRows {
  limit: Map<string, PolicyValue>;
  delegate: Map<string, boolean>;
  business: Map<string, PolicyValue>;
  shop: Map<string, Map<string, PolicyValue>>;
  role: Map<string, Map<string, PolicyValue>>;
  user: Map<string, Map<string, PolicyValue>>;
  columns: Record<string, unknown>;
}

const COLUMN_KEYS = POLICIES.filter((p) => p.column);

function orgRows(db: Db, orgId: string): OrgRows {
  const out: OrgRows = { limit: new Map(), delegate: new Map(), business: new Map(), shop: new Map(), role: new Map(), user: new Map(), columns: {} };
  for (const r of platform(db).all<Row>('SELECT level, org_id, target_id, key, value_json FROM policy_values WHERE org_id = @o', { o: orgId })) {
    const def = policyDef(r.key);
    if (!def) continue;
    if (r.level === 'delegate') {
      out.delegate.set(r.key, r.value_json === 'true');
      continue;
    }
    const v = parse(def, r.value_json);
    if (v === null) continue;
    if (r.level === 'limit') out.limit.set(r.key, v);
    else if (r.level === 'business') out.business.set(r.key, v);
    else if (r.level === 'shop' || r.level === 'role' || r.level === 'user') {
      const m = out[r.level];
      const inner = m.get(r.target_id) ?? new Map<string, PolicyValue>();
      inner.set(r.key, v);
      m.set(r.target_id, inner);
    }
  }
  const cols = COLUMN_KEYS.map((p) => p.column!).join(', ');
  out.columns = platform(db).get<Record<string, unknown>>(`SELECT ${cols} FROM organizations WHERE id = @o`, { o: orgId }) ?? {};
  return out;
}

function businessValue(def: PolicyDef, rows: OrgRows): PolicyValue | null {
  if (def.column) {
    const raw = rows.columns[def.column];
    return raw === undefined || raw === null ? null : coerce(def, raw);
  }
  return rows.business.get(def.key) ?? null;
}

export function delegated(rows: OrgRows, def: PolicyDef): boolean {
  return rows.delegate.get(def.key) ?? def.delegatedByDefault === true;
}

// the role ids a person holds in the business
export function roleIdsOf(db: Db, orgId: string, userId: string): string[] {
  return platform(db)
    .all<{ role_id: string }>(
      `SELECT DISTINCT a.role_id FROM role_assignments a JOIN memberships m ON m.id = a.membership_id
        WHERE a.org_id = @o AND m.user_id = @u AND m.status = 'active'`,
      { o: orgId, u: userId },
    )
    .map((r) => r.role_id);
}

function layersFor(db: Db, def: PolicyDef, rows: OrgRows, who: { shopId?: string | null; roleIds?: readonly string[]; userId?: string | null }): PolicyLayers {
  return {
    platform: platformValues(db).get(def.key) ?? envDefault(def),
    limit: rows.limit.get(def.key) ?? null,
    business: businessValue(def, rows),
    shop: who.shopId ? rows.shop.get(who.shopId)?.get(def.key) ?? null : null,
    roles: (who.roleIds ?? []).map((r) => rows.role.get(r)?.get(def.key)).filter((v): v is PolicyValue => v !== undefined),
    user: who.userId ? rows.user.get(who.userId)?.get(def.key) ?? null : null,
  };
}

// the value in force for a key in a business, for a shop, a set of roles and a person when given
export function policyIn(db: Db, orgId: string, key: string, who: { shopId?: string | null; userId?: string | null; roleIds?: readonly string[] } = {}): PolicyValue {
  const def = policyDef(key);
  if (!def) throw new Error(`unknown policy ${key}`);
  if (!hasLevel(def, 'business')) return platformPolicy(db, key);
  const rows = orgRows(db, orgId);
  const roleIds = who.roleIds ?? (who.userId ? roleIdsOf(db, orgId, who.userId) : []);
  return resolvePolicy(def, layersFor(db, def, rows, { ...who, roleIds }));
}

// every business key in force for one person, for screens that hide what is over a limit
export function policiesFor(db: Db, orgId: string, userId: string, shopId?: string | null): Record<string, PolicyValue> {
  const rows = orgRows(db, orgId);
  const roleIds = roleIdsOf(db, orgId, userId);
  const out: Record<string, PolicyValue> = {};
  for (const def of POLICIES) {
    out[def.key] = hasLevel(def, 'business') ? resolvePolicy(def, layersFor(db, def, rows, { shopId, roleIds, userId })) : platformPolicy(db, def.key);
  }
  return out;
}

// ------------------------------------------------------------------ who is acting

export interface PolicyActor {
  userId: string;
  assignments: readonly AccessAssignment[];
  topology: Topology;
  superadmin: boolean;
}

const refuse = (status: 403 | 400 | 422, code: ErrorCode, detail: string) => new ApiProblem(status as 403, code, detail);

function holdsAtOrg(actor: PolicyActor, perm: string): boolean {
  return effectiveAtScope(actor.assignments, actor.topology, { scopeType: 'org', scopeId: actor.topology.orgId }).perms.has(perm);
}
function holdsAtShop(actor: PolicyActor, perm: string, shopId: string): boolean {
  return effectiveAtScope(actor.assignments, actor.topology, { scopeType: 'shop', scopeId: shopId }).perms.has(perm);
}
function orgRank(actor: PolicyActor): number {
  return effectiveAtScope(actor.assignments, actor.topology, { scopeType: 'org', scopeId: actor.topology.orgId }).rank;
}

// the actor's own value of a key: nobody hands out more than they have
function actorOwn(db: Db, rows: OrgRows, def: PolicyDef, actor: PolicyActor, shopId?: string | null): PolicyValue {
  const roleIds = actor.assignments.map((a) => a.roleId).filter((r) => r !== 'platform');
  return resolvePolicy(def, layersFor(db, def, rows, { shopId, roleIds, userId: actor.userId }));
}

function checkValue(def: PolicyDef, raw: unknown, upper: PolicyValue): PolicyValue {
  const v = coerce(def, raw);
  if (v === null || !inBounds(def, raw as PolicyValue)) throw refuse(422, 'validation', `${def.key}: not a value for this setting`);
  if (!within(def, v, upper)) throw refuse(422, 'limit_reached', `${def.key}: outside what is allowed here`);
  return v;
}

// ------------------------------------------------------------------ writing

function put(db: Db, level: Level, orgId: string, targetId: string, key: string, value: PolicyValue | boolean | null, actorId: string | null, now: number) {
  if (value === null) {
    platform(db).run('DELETE FROM policy_values WHERE level = @l AND org_id = @o AND target_id = @t AND key = @k', { l: level, o: orgId, t: targetId, k: key });
  } else {
    platform(db).run(
      `INSERT INTO policy_values (level, org_id, target_id, key, value_json, updated_by, updated_at) VALUES (@l, @o, @t, @k, @v, @by, @now)
       ON CONFLICT (level, org_id, target_id, key) DO UPDATE SET value_json = excluded.value_json, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
      { l: level, o: orgId, t: targetId, k: key, v: JSON.stringify(value), by: actorId, now },
    );
  }
  if (level === 'platform') platformCache.delete(db);
}

function auditBusiness(db: Db, orgId: string, actor: { id: string | null; superadmin: boolean }, action: BusinessAuditAction, entity: { type: string; id: string }, before: unknown, after: unknown, now: number) {
  platform(db).run(
    `INSERT INTO audit_log (id, org_id, actor_id, actor_kind, action, entity_type, entity_id, before_json, after_json, created_at)
     VALUES (@id, @org, @actor, @kind, @action, @et, @eid, @b, @a, @now)`,
    { id: uuidv7(now), org: orgId, actor: actor.id, kind: actor.superadmin ? 'platform_admin' : 'member', action, et: entity.type, eid: entity.id, b: JSON.stringify(before), a: JSON.stringify(after), now },
  );
  if (actor.superadmin) auditPlatform(db, actor.id, action, orgId, entity, before, after, now);
}

function auditPlatform(db: Db, actorId: string | null, action: PlatformAuditAction | BusinessAuditAction, orgId: string | null, entity: { type: string; id: string } | null, before: unknown, after: unknown, now: number) {
  platform(db).run(
    `INSERT INTO platform_audit (id, actor_id, action, org_id, entity_type, entity_id, details_json, created_at)
     VALUES (@id, @a, @action, @org, @et, @eid, @d, @now)`,
    { id: uuidv7(now), a: actorId, action, org: orgId, et: entity?.type ?? null, eid: entity?.id ?? null, d: JSON.stringify({ before, after }), now },
  );
}

// a column key whose business value left the bounds above (a lower ceiling, a stricter platform
// value) is written back inside them, so code reading the column follows at once
function clampColumns(db: Db, orgIds: readonly string[], keys: readonly PolicyDef[] = COLUMN_KEYS) {
  for (const orgId of orgIds) {
    const rows = orgRows(db, orgId);
    for (const def of keys) {
      if (!def.column) continue;
      const current = businessValue(def, rows);
      const eff = resolvePolicy(def, layersFor(db, def, rows, {}));
      if (current === null || current === eff) continue;
      const v = typeof eff === 'boolean' ? (eff ? 1 : 0) : eff;
      platform(db).run(`UPDATE organizations SET ${def.column} = @v WHERE id = @o`, { v, o: orgId });
    }
  }
}

function writeColumn(db: Db, def: PolicyDef, orgId: string, v: PolicyValue) {
  platform(db).run(`UPDATE organizations SET ${def.column!} = @v WHERE id = @o`, { v: typeof v === 'boolean' ? (v ? 1 : 0) : v, o: orgId });
}

// super admin: platform values for everyone
export function setPlatformPolicies(db: Db, actorId: string, patch: PolicyPatch, now = Date.now()) {
  const before: Record<string, PolicyValue | null> = {};
  const after: Record<string, PolicyValue | null> = {};
  const changed: PolicyDef[] = [];
  db.transaction(() => {
    for (const [key, raw] of Object.entries(patch)) {
      const def = policyDef(key);
      if (!def) throw refuse(422, 'validation', `${key}: unknown setting`);
      before[key] = platformValues(db).get(key) ?? null;
      let v: PolicyValue | null = null;
      if (raw !== null) {
        v = coerce(def, raw);
        if (v === null || !inBounds(def, raw)) throw refuse(422, 'validation', `${key}: not a value for this setting`);
      }
      put(db, 'platform', '', '', key, v, actorId, now);
      after[key] = v;
      changed.push(def);
    }
    const orgs = platform(db).all<{ id: string }>('SELECT id FROM organizations WHERE archived_at IS NULL').map((r) => r.id);
    clampColumns(db, orgs, changed);
  })();
  auditPlatform(db, actorId, 'policies.platform_changed', null, null, before, after, now);
}

export function platformPolicyEntries(db: Db): PlatformPolicyEntry[] {
  return POLICIES.map((def) => ({ key: def.key, value: platformValues(db).get(def.key) ?? null, default: envDefault(def), effective: platformPolicy(db, def.key) }));
}

// super admin: the ceiling and the delegation switch of each business key for one business
export function businessPolicyControls(db: Db, orgId: string): BusinessPolicyControl[] {
  const rows = orgRows(db, orgId);
  return POLICIES.filter((d) => hasLevel(d, 'business')).map((def) => {
    const layers = layersFor(db, def, rows, {});
    return {
      key: def.key,
      limit: rows.limit.get(def.key) ?? null,
      delegated: delegated(rows, def),
      business: resolvePolicy(def, layers),
      platform: layers.platform as PolicyValue,
    };
  });
}

export function setBusinessPolicyControls(db: Db, actorId: string, orgId: string, patch: BusinessPolicyControlsPatch, now = Date.now()) {
  const before = businessPolicyControls(db, orgId);
  const touched: PolicyDef[] = [];
  db.transaction(() => {
    for (const [key, change] of Object.entries(patch)) {
      const def = policyDef(key);
      if (!def || !hasLevel(def, 'business')) throw refuse(422, 'validation', `${key}: not a business setting`);
      if (change.limit !== undefined) {
        let v: PolicyValue | null = null;
        if (change.limit !== null) {
          v = coerce(def, change.limit);
          if (v === null || !inBounds(def, change.limit)) throw refuse(422, 'validation', `${key}: not a value for this setting`);
        }
        put(db, 'limit', orgId, '', key, v, actorId, now);
      }
      if (change.delegated !== undefined) put(db, 'delegate', orgId, '', key, change.delegated, actorId, now);
      touched.push(def);
    }
    clampColumns(db, [orgId], touched);
    platform(db).run('UPDATE memberships SET perms_version = perms_version + 1 WHERE org_id = @o', { o: orgId });
  })();
  const after = businessPolicyControls(db, orgId);
  const pick = (list: BusinessPolicyControl[]) => Object.fromEntries(list.filter((c) => touched.some((d) => d.key === c.key)).map((c) => [c.key, { limit: c.limit, delegated: c.delegated }]));
  auditPlatform(db, actorId, 'policies.business_controls_changed', orgId, { type: 'org', id: orgId }, pick(before), pick(after), now);
  return after;
}

// ------------------------------------------------------------------ business, shop, role, user

type Target = { level: 'business' } | { level: 'shop'; shopId: string } | { level: 'role'; roleId: string } | { level: 'user'; userId: string };

interface RoleRow { id: string; rank: number; is_locked: number }

function canTouch(db: Db, rows: OrgRows, def: PolicyDef, actor: PolicyActor, target: Target): boolean {
  if (!hasLevel(def, target.level)) return false;
  const self = target.level === 'user' && target.userId === actor.userId;
  // people change their own preferences, nothing else about themselves
  if (self) return def.selfService === true;
  if (actor.superadmin) return true;
  if (!delegated(rows, def)) return false;
  switch (target.level) {
    case 'business':
      return !!def.permission && holdsAtOrg(actor, def.permission);
    case 'shop':
      return holdsAtShop(actor, def.shopPermission ?? def.permission ?? 'shop.settings.manage', target.shopId);
    case 'role': {
      const role = platform(db).get<RoleRow>('SELECT id, rank, is_locked FROM roles WHERE id = @r AND org_id = @o AND archived_at IS NULL', { r: target.roleId, o: actor.topology.orgId });
      if (!role || role.is_locked) return false;
      if (!holdsAtOrg(actor, 'roles.manage')) return false;
      if (actor.assignments.some((a) => a.roleId === role.id)) return false;
      return role.rank < orgRank(actor);
    }
    case 'user': {
      const assignments = targetAssignments(db, actor.topology.orgId, target.userId);
      if (!assignments.length) return false;
      // every part of the person's access has to be the actor's to manage
      return assignments.every((a) => canManageMember({ actor: { userId: actor.userId, assignments: actor.assignments }, topology: actor.topology, target: { userId: target.userId, assignments }, scope: { scopeType: a.scopeType, scopeId: a.scopeId } }).ok);
    }
  }
}

function targetAssignments(db: Db, orgId: string, userId: string): AccessAssignment[] {
  return platform(db)
    .all<{ id: string; role_id: string; rank: number; scope_type: 'org' | 'group' | 'shop'; scope_id: string }>(
      `SELECT a.id, a.role_id, r.rank, a.scope_type, a.scope_id FROM role_assignments a
         JOIN roles r ON r.id = a.role_id JOIN memberships m ON m.id = a.membership_id
        WHERE a.org_id = @o AND m.user_id = @u AND m.status = 'active' AND r.archived_at IS NULL`,
      { o: orgId, u: userId },
    )
    .map((r) => ({ id: r.id, roleId: r.role_id, rank: r.rank, permissions: [], scopeType: r.scope_type, scopeId: r.scope_id }));
}

function stopFor(target: Target): 'business' | 'shop' | 'role' | 'user' {
  return target.level;
}

function layersAt(db: Db, orgId: string, def: PolicyDef, rows: OrgRows, target: Target): PolicyLayers {
  if (target.level === 'shop') return layersFor(db, def, rows, { shopId: target.shopId });
  if (target.level === 'role') return layersFor(db, def, rows, { roleIds: [target.roleId] });
  if (target.level === 'user') return layersFor(db, def, rows, { userId: target.userId, roleIds: roleIdsOf(db, orgId, target.userId) });
  return layersFor(db, def, rows, {});
}

function valueAt(def: PolicyDef, rows: OrgRows, target: Target): PolicyValue | null {
  if (target.level === 'business') return businessValue(def, rows);
  if (target.level === 'shop') return rows.shop.get(target.shopId)?.get(def.key) ?? null;
  if (target.level === 'role') return rows.role.get(target.roleId)?.get(def.key) ?? null;
  return rows.user.get(target.userId)?.get(def.key) ?? null;
}

function targetIdOf(target: Target): string {
  return target.level === 'shop' ? target.shopId : target.level === 'role' ? target.roleId : target.level === 'user' ? target.userId : '';
}

// the keys of one level as a screen shows them, with what the actor may change
export function policyEntries(db: Db, orgId: string, actor: PolicyActor, target: Target, filter?: (def: PolicyDef) => boolean): PolicyEntry[] {
  const rows = orgRows(db, orgId);
  return POLICIES.filter((def) => hasLevel(def, target.level) && (!filter || filter(def))).map((def) => {
    const layers = layersAt(db, orgId, def, rows, target);
    return {
      key: def.key,
      value: valueAt(def, rows, target),
      inherited: resolvePolicy(def, layers, stopFor(target)),
      effective: resolvePolicy(def, layers, target.level === 'user' ? undefined : (({ business: 'shop', shop: 'role', role: 'user' }) as const)[target.level as 'business' | 'shop' | 'role']),
      editable: canTouch(db, rows, def, actor, target),
    };
  });
}

export function setPolicies(db: Db, orgId: string, actor: PolicyActor, target: Target, patch: PolicyPatch, now = Date.now()) {
  const rows = orgRows(db, orgId);
  const before: Record<string, PolicyValue | null> = {};
  const after: Record<string, PolicyValue | null> = {};
  db.transaction(() => {
    for (const [key, raw] of Object.entries(patch)) {
      const def = policyDef(key);
      if (!def || !hasLevel(def, target.level)) throw refuse(422, 'validation', `${key}: not a setting for this level`);
      if (!canTouch(db, rows, def, actor, target)) {
        const self = target.level === 'user' && target.userId === actor.userId;
        throw refuse(403, self ? 'self' : 'forbidden', `${key}: not yours to change`);
      }
      before[key] = valueAt(def, rows, target);
      const layers = layersAt(db, orgId, def, rows, target);
      const upper = resolvePolicy(def, layers, stopFor(target));
      let v: PolicyValue | null = null;
      if (raw !== null) {
        v = checkValue(def, raw, upper);
        // nobody gives more than they have themselves (preferences have no such bound)
        const own = target.level === 'role' || target.level === 'user';
        if (own && !actor.superadmin && def.cap !== 'free' && !(target.level === 'user' && target.userId === actor.userId)) {
          if (!within(def, v, actorOwn(db, rows, def, actor))) throw refuse(403, 'ceiling', `${key}: more than your own`);
        }
      } else if (def.column && target.level === 'business') {
        // a column always holds a value: taking it away means back to what the level above says
        v = upper;
      }
      if (def.column && target.level === 'business') writeColumn(db, def, orgId, v as PolicyValue);
      else put(db, target.level, orgId, targetIdOf(target), key, v, actor.userId, now);
      after[key] = v;
    }
    platform(db).run('UPDATE memberships SET perms_version = perms_version + 1 WHERE org_id = @o', { o: orgId });
  })();
  const entity = target.level === 'business' ? { type: 'organization', id: orgId } : { type: target.level, id: targetIdOf(target) };
  auditBusiness(db, orgId, { id: actor.userId, superadmin: actor.superadmin }, `policies.${target.level}_changed`, entity, before, after, now);
}

// a new business starts from the platform values of the column keys
export function applyPlatformDefaults(db: Db, orgId: string) {
  const values = platformValues(db);
  for (const def of COLUMN_KEYS) {
    const v = values.get(def.key);
    if (v !== undefined) writeColumn(db, def, orgId, v);
  }
}

export function isPlatformPolicyActor(assignments: readonly AccessAssignment[]): boolean {
  return isPlatformActor({ userId: '', assignments });
}
