// web push subscriptions from the installed web app. the browser hands us its push service
// endpoint and keys, we keep them per user, optionally for one business only.

import type { Hono } from 'hono';
import { z } from 'zod';
import { PushSubscriptionInput, uuidv7 } from '@custock/core';
import type { AppEnv } from '../types';
import { cfgOf, nowOf } from '../lib/context';
import { ApiProblem, notFound } from '../lib/problem';
import { platform } from '../lib/tenant';
import { recomputePushOk } from '../lib/webpush';

// a person rarely has more browsers than this. the oldest goes when a new one comes in.
export const MAX_SUBSCRIPTIONS_PER_USER = 20;

export function pushRoutes(app: Hono<AppEnv>) {
  app.get('/v1/push/key', (c) => {
    const key = cfgOf(c).vapidPublicKey;
    if (!key) throw new ApiProblem(404, 'not_found', 'web push is not set up');
    return c.json({ publicKey: key });
  });

  app.post('/v1/me/push-subscriptions', async (c) => {
    const input = PushSubscriptionInput.parse(await c.req.json());
    const db = cfgOf(c).db;
    const p = platform(db);
    const user = c.get('user');
    const now = nowOf(c);
    const orgId = input.orgId ?? null;
    if (orgId) {
      // the person must belong to the business: on its team, or one of its customers
      const member = p.get("SELECT 1 FROM memberships WHERE org_id = @o AND user_id = @u AND status = 'active'", { o: orgId, u: user.id });
      const customer = p.get('SELECT 1 FROM customers WHERE org_id = @o AND user_id = @u AND erased_at IS NULL', { o: orgId, u: user.id });
      if (!member && !customer) throw notFound('org');
    }
    const ua = (c.req.header('User-Agent') ?? '').slice(0, 300) || null;
    db.transaction(() => {
      // the same browser signed in as someone else takes the subscription over
      const before = p.get<{ user_id: string }>('SELECT user_id FROM push_subscriptions WHERE endpoint = @e', { e: input.endpoint });
      p.run(
        `INSERT INTO push_subscriptions (id, user_id, org_id, endpoint, p256dh, auth, locale, user_agent, created_at, updated_at)
         VALUES (@id, @u, @o, @e, @k, @a, @l, @ua, @now, @now)
         ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id, org_id = excluded.org_id, p256dh = excluded.p256dh,
           auth = excluded.auth, locale = excluded.locale, user_agent = excluded.user_agent, updated_at = excluded.updated_at, failures = 0`,
        { id: uuidv7(now), u: user.id, o: orgId, e: input.endpoint, k: input.keys.p256dh, a: input.keys.auth, l: input.locale ?? user.locale, ua, now },
      );
      p.run(
        `DELETE FROM push_subscriptions WHERE user_id = @u AND id NOT IN (
           SELECT id FROM push_subscriptions WHERE user_id = @u ORDER BY updated_at DESC, rowid DESC LIMIT @max)`,
        { u: user.id, max: MAX_SUBSCRIPTIONS_PER_USER },
      );
      recomputePushOk(db, user.id, now);
      if (before && before.user_id !== user.id) recomputePushOk(db, before.user_id, now);
    })();
    return c.body(null, 204);
  });

  app.delete('/v1/me/push-subscriptions', async (c) => {
    const { endpoint } = z.object({ endpoint: z.string().max(1000) }).parse(await c.req.json());
    const db = cfgOf(c).db;
    const user = c.get('user');
    db.transaction(() => {
      platform(db).run('DELETE FROM push_subscriptions WHERE endpoint = @e AND user_id = @u', { e: endpoint, u: user.id });
      recomputePushOk(db, user.id, nowOf(c));
    })();
    return c.body(null, 204);
  });
}
