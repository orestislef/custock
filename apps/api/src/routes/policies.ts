// the policy engine over http: every limit and option at the level it is set
//
//   /v1/orgs/:org/policies                  business values, and what applies to the caller
//   /v1/orgs/:org/shops/:shop/policies      one shop
//   /v1/orgs/:org/roles/:role/policies      one role
//   /v1/orgs/:org/members/:m/policies       one person (a membership id)
//   /v1/orgs/:org/me/policies               the caller's own preferences
//   /v1/platform/policies                   super admin: the platform values
//   /v1/platform/businesses/:orgId/policies super admin: ceilings and delegation for one business
//
// reads are for people who can open the screen. writes go through lib/policy, which holds the
// authority rules.

import type { Context, Hono } from 'hono';
import { BusinessPolicyControlsPatch, effectiveAtScope, PolicyPatch, policyDef } from '@custock/core';
import type { AppEnv } from '../types';
import { cfgOf, nowOf, orgOf, requireAuth } from '../lib/context';
import { forbidden, notFound } from '../lib/problem';
import { platform } from '../lib/tenant';
import { isSuperadmin } from '../lib/platform-access';
import {
  businessPolicyControls, platformPolicyEntries, policiesFor, policyEntries, setBusinessPolicyControls, setPlatformPolicies, setPolicies,
  type PolicyActor,
} from '../lib/policy';

function actorOf(c: Context<AppEnv>): PolicyActor {
  const o = orgOf(c);
  const userId = c.get('user').id;
  return { userId, assignments: o.assignments, topology: o.topology, superadmin: isSuperadmin(cfgOf(c).db, userId) };
}

function holdsOrg(c: Context<AppEnv>, perm: string): boolean {
  const o = orgOf(c);
  return effectiveAtScope(o.assignments, o.topology, { scopeType: 'org', scopeId: o.topology.orgId }).perms.has(perm);
}

function memberUser(c: Context<AppEnv>): string {
  const row = platform(cfgOf(c).db).get<{ user_id: string }>(
    "SELECT user_id FROM memberships WHERE id = @m AND org_id = @o AND status != 'removed'",
    { m: c.req.param('m'), o: orgOf(c).org.id },
  );
  if (!row) throw notFound('member');
  return row.user_id;
}

function roleId(c: Context<AppEnv>): string {
  const row = platform(cfgOf(c).db).get<{ id: string }>('SELECT id FROM roles WHERE id = @r AND org_id = @o AND archived_at IS NULL', { r: c.req.param('role'), o: orgOf(c).org.id });
  if (!row) throw notFound('role');
  return row.id;
}

function shopId(c: Context<AppEnv>): string {
  const id = c.req.param('shop');
  if (!orgOf(c).topology.shops.includes(id ?? '')) throw notFound('shop');
  return id!;
}

export function policyRoutes(app: Hono<AppEnv>) {
  // ------------------------------------------------------------ business

  app.get('/v1/orgs/:org/policies', (c) => {
    const db = cfgOf(c).db;
    const org = orgOf(c).org;
    const shop = c.req.query('shop') || null;
    if (shop && !orgOf(c).topology.shops.includes(shop)) throw notFound('shop');
    return c.json({
      entries: policyEntries(db, org.id, actorOf(c), { level: 'business' }),
      // what applies to the caller: screens keep controls inside these without saying why
      mine: policiesFor(db, org.id, c.get('user').id, shop),
    });
  });

  app.patch('/v1/orgs/:org/policies', async (c) => {
    const patch = PolicyPatch.parse(await c.req.json());
    const db = cfgOf(c).db;
    setPolicies(db, orgOf(c).org.id, actorOf(c), { level: 'business' }, patch, nowOf(c));
    return c.json({ entries: policyEntries(db, orgOf(c).org.id, actorOf(c), { level: 'business' }) });
  });

  // ------------------------------------------------------------ shop

  app.get('/v1/orgs/:org/shops/:shop/policies', (c) => {
    const id = shopId(c);
    return c.json({ entries: policyEntries(cfgOf(c).db, orgOf(c).org.id, actorOf(c), { level: 'shop', shopId: id }) });
  });

  app.patch('/v1/orgs/:org/shops/:shop/policies', async (c) => {
    const id = shopId(c);
    const patch = PolicyPatch.parse(await c.req.json());
    const db = cfgOf(c).db;
    setPolicies(db, orgOf(c).org.id, actorOf(c), { level: 'shop', shopId: id }, patch, nowOf(c));
    return c.json({ entries: policyEntries(db, orgOf(c).org.id, actorOf(c), { level: 'shop', shopId: id }) });
  });

  // ------------------------------------------------------------ role

  app.get('/v1/orgs/:org/roles/:role/policies', (c) => {
    const actor = actorOf(c);
    if (!actor.superadmin && !holdsOrg(c, 'roles.manage')) throw forbidden('roles.manage');
    const id = roleId(c);
    return c.json({ entries: policyEntries(cfgOf(c).db, orgOf(c).org.id, actor, { level: 'role', roleId: id }) });
  });

  app.patch('/v1/orgs/:org/roles/:role/policies', async (c) => {
    const id = roleId(c);
    const patch = PolicyPatch.parse(await c.req.json());
    const db = cfgOf(c).db;
    setPolicies(db, orgOf(c).org.id, actorOf(c), { level: 'role', roleId: id }, patch, nowOf(c));
    return c.json({ entries: policyEntries(db, orgOf(c).org.id, actorOf(c), { level: 'role', roleId: id }) });
  });

  // ------------------------------------------------------------ person

  app.get('/v1/orgs/:org/members/:m/policies', (c) => {
    const actor = actorOf(c);
    const userId = memberUser(c);
    if (!actor.superadmin && userId !== actor.userId && !orgOf(c).access.shops.some((s) => s.perms.includes('members.view')) && !holdsOrg(c, 'members.view')) {
      throw forbidden('members.view');
    }
    return c.json({ entries: policyEntries(cfgOf(c).db, orgOf(c).org.id, actor, { level: 'user', userId }) });
  });

  app.patch('/v1/orgs/:org/members/:m/policies', async (c) => {
    const userId = memberUser(c);
    const patch = PolicyPatch.parse(await c.req.json());
    const db = cfgOf(c).db;
    setPolicies(db, orgOf(c).org.id, actorOf(c), { level: 'user', userId }, patch, nowOf(c));
    return c.json({ entries: policyEntries(db, orgOf(c).org.id, actorOf(c), { level: 'user', userId }) });
  });

  // the caller's own preferences: only the keys a person may set for themselves
  const own = (key: string) => policyDef(key)?.selfService === true;

  app.get('/v1/orgs/:org/me/policies', (c) => {
    const actor = actorOf(c);
    return c.json({ entries: policyEntries(cfgOf(c).db, orgOf(c).org.id, actor, { level: 'user', userId: actor.userId }, (d) => d.selfService === true) });
  });

  app.patch('/v1/orgs/:org/me/policies', async (c) => {
    const actor = actorOf(c);
    const patch = PolicyPatch.parse(await c.req.json());
    for (const key of Object.keys(patch)) if (!own(key)) throw forbidden(`${key} is not a personal preference`, 'self');
    const db = cfgOf(c).db;
    setPolicies(db, orgOf(c).org.id, actor, { level: 'user', userId: actor.userId }, patch, nowOf(c));
    return c.json({ entries: policyEntries(db, orgOf(c).org.id, actor, { level: 'user', userId: actor.userId }, (d) => d.selfService === true) });
  });

  // ------------------------------------------------------------ super admin

  const superadminOnly = (c: Context<AppEnv>) => {
    if (!isSuperadmin(cfgOf(c).db, c.get('user').id)) throw forbidden('super admins only');
  };
  const orgExists = (c: Context<AppEnv>) => {
    const id = c.req.param('orgId');
    if (!platform(cfgOf(c).db).get('SELECT 1 FROM organizations WHERE id = @o AND archived_at IS NULL', { o: id })) throw notFound('organization');
    return id!;
  };

  app.get('/v1/platform/policies', requireAuth, (c) => {
    superadminOnly(c);
    return c.json({ entries: platformPolicyEntries(cfgOf(c).db) });
  });

  app.patch('/v1/platform/policies', requireAuth, async (c) => {
    superadminOnly(c);
    const patch = PolicyPatch.parse(await c.req.json());
    setPlatformPolicies(cfgOf(c).db, c.get('user').id, patch, nowOf(c));
    return c.json({ entries: platformPolicyEntries(cfgOf(c).db) });
  });

  app.get('/v1/platform/businesses/:orgId/policies', requireAuth, (c) => {
    superadminOnly(c);
    return c.json({ controls: businessPolicyControls(cfgOf(c).db, orgExists(c)) });
  });

  app.patch('/v1/platform/businesses/:orgId/policies', requireAuth, async (c) => {
    superadminOnly(c);
    const id = orgExists(c);
    const patch = BusinessPolicyControlsPatch.parse(await c.req.json());
    return c.json({ controls: setBusinessPolicyControls(cfgOf(c).db, c.get('user').id, id, patch, nowOf(c)) });
  });
}
