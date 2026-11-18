// a lost or shared phone: the person sees how many other devices are signed in and can sign them
// all out. the device that asks stays signed in. their tokens stop working on the next request.

import type { Hono } from 'hono';
import type { AppEnv } from '../types';
import { cfgOf, nowOf } from '../lib/context';
import { platform } from '../lib/tenant';

export function sessionRoutes(app: Hono<AppEnv>) {
  const ownFamily = (db: ReturnType<typeof cfgOf>['db'], sessionId: string | null | undefined) =>
    sessionId ? platform(db).get<{ family_id: string }>('SELECT family_id FROM sessions WHERE id = @id', { id: sessionId })?.family_id ?? null : null;

  // how many other devices are signed in (one per sign in, a refresh keeps the same family)
  app.get('/v1/me/sessions', (c) => {
    const db = cfgOf(c).db;
    const user = c.get('user');
    const own = ownFamily(db, user.sessionId);
    const others = platform(db).get<{ n: number }>(
      `SELECT count(DISTINCT family_id) AS n FROM sessions
        WHERE user_id = @u AND revoked_at IS NULL AND expires_at > @now AND (@f IS NULL OR family_id != @f)`,
      { u: user.id, now: nowOf(c), f: own },
    )?.n ?? 0;
    return c.json({ others });
  });

  app.post('/v1/me/sessions/sign-out-others', (c) => {
    const db = cfgOf(c).db;
    const user = c.get('user');
    const own = ownFamily(db, user.sessionId);
    const r = platform(db).run(
      'UPDATE sessions SET revoked_at = @now WHERE user_id = @u AND revoked_at IS NULL AND (@f IS NULL OR family_id != @f)',
      { now: nowOf(c), u: user.id, f: own },
    );
    return c.json({ signedOut: r.changes });
  });
}
