// a lost or shared phone: the person sees every device signed in to the account, signs one of them
// out, or all the others at once. the device that asks stays signed in. their tokens stop working
// on the next request. a device is a sign in and every refresh after it (one session family).

import type { Hono } from 'hono';
import { deviceOf, type SessionDevice } from '@custock/core';
import type { AppEnv } from '../types';
import { cfgOf, nowOf } from '../lib/context';
import { ApiProblem, notFound } from '../lib/problem';
import { platform } from '../lib/tenant';
import { isSuperadmin } from '../lib/platform-access';
import { platformAudit } from '../services/platform';

type Db = ReturnType<typeof cfgOf>['db'];

const ownFamily = (db: Db, sessionId: string | null | undefined) =>
  sessionId ? platform(db).get<{ family_id: string }>('SELECT family_id FROM sessions WHERE id = @id', { id: sessionId })?.family_id ?? null : null;

// the live end of each family: not spent by a refresh, not revoked, not expired
function devicesOf(db: Db, userId: string, own: string | null, now: number): SessionDevice[] {
  const rows = platform(db).all<{ family_id: string; user_agent: string | null; created_at: number; started: number }>(
    `SELECT s.family_id, s.user_agent, s.created_at,
            coalesce(s.family_started_at, (SELECT min(f.created_at) FROM sessions f WHERE f.family_id = s.family_id)) AS started
       FROM sessions s
      WHERE s.user_id = @u AND s.revoked_at IS NULL AND s.replaced_by IS NULL AND s.expires_at > @now
      ORDER BY s.created_at DESC`,
    { u: userId, now },
  );
  const seen = new Set<string>();
  const out: SessionDevice[] = [];
  for (const r of rows) {
    if (seen.has(r.family_id)) continue;
    seen.add(r.family_id);
    out.push({ id: r.family_id, current: r.family_id === own, ...deviceOf(r.user_agent), lastUsedAt: r.created_at, signedInAt: r.started });
  }
  // this device first, then the most recently used
  return out.sort((a, b) => Number(b.current) - Number(a.current) || b.lastUsedAt - a.lastUsedAt);
}

export function sessionRoutes(app: Hono<AppEnv>) {
  app.get('/v1/me/sessions', (c) => {
    const db = cfgOf(c).db;
    const user = c.get('user');
    const devices = devicesOf(db, user.id, ownFamily(db, user.sessionId), nowOf(c));
    return c.json({ others: devices.filter((d) => !d.current).length, devices });
  });

  // one device, by its id from the list. only the person's own, and not the one asking
  app.delete('/v1/me/sessions/:id', (c) => {
    const db = cfgOf(c).db;
    const user = c.get('user');
    const now = nowOf(c);
    const id = c.req.param('id');
    const own = ownFamily(db, user.sessionId);
    const device = devicesOf(db, user.id, own, now).find((d) => d.id === id);
    if (!device) throw notFound('device');
    if (device.current) throw new ApiProblem(409, 'conflict', 'this device signs out from its own menu');
    platform(db).run('UPDATE sessions SET revoked_at = coalesce(revoked_at, @now) WHERE user_id = @u AND family_id = @f', { now, u: user.id, f: id });
    if (isSuperadmin(db, user.id)) {
      platformAudit(db, user.id, 'superadmin.device_signed_out', { entity: { type: 'user', id: user.id }, before: { browser: device.browser, os: device.os } }, now);
    }
    return c.body(null, 204);
  });

  app.post('/v1/me/sessions/sign-out-others', (c) => {
    const db = cfgOf(c).db;
    const user = c.get('user');
    const now = nowOf(c);
    const own = ownFamily(db, user.sessionId);
    const others = devicesOf(db, user.id, own, now).filter((d) => !d.current).length;
    platform(db).run(
      'UPDATE sessions SET revoked_at = @now WHERE user_id = @u AND revoked_at IS NULL AND (@f IS NULL OR family_id != @f)',
      { now, u: user.id, f: own },
    );
    if (others && isSuperadmin(db, user.id)) {
      platformAudit(db, user.id, 'superadmin.others_signed_out', { entity: { type: 'user', id: user.id }, after: { devices: others } }, now);
    }
    // devices, not rows: a device that refreshed ten times is still one device
    return c.json({ signedOut: others });
  });
}
