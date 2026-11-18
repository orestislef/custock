// dev only tools: what would have been sent, and running due jobs now

import type { Hono } from 'hono';
import type { DevOutboxItem } from '@custock/core';
import type { AppEnv } from '../types';
import { cfgOf, requireAuth } from '../lib/context';
import { forbidden, notFound } from '../lib/problem';
import { clampLimit, parseJson, platform } from '../lib/tenant';
import { runJobs } from '../worker';

export function devRoutes(app: Hono<AppEnv>) {
  app.use('/v1/dev/*', async (c, next) => {
    if (!cfgOf(c).dev) throw notFound();
    await next();
  });
  // the email preview shows made up content only, the rest needs a signed in owner or admin
  app.use('/v1/dev/*', (c, next) => (c.req.path.startsWith('/v1/dev/emails') ? next() : requireAuth(c, next)));

  // owners and admins see what their businesses would have sent
  app.get('/v1/dev/outbox', (c) => {
    const db = cfgOf(c).db;
    const orgs = platform(db)
      .all<{ org_id: string }>(
        `SELECT DISTINCT m.org_id FROM memberships m JOIN role_assignments a ON a.membership_id = m.id JOIN roles r ON r.id = a.role_id
          WHERE m.user_id = @u AND m.status = 'active' AND a.scope_type = 'org' AND r.rank >= 80`,
        { u: c.get('user').id },
      )
      .map((r) => r.org_id);
    if (!orgs.length) throw forbidden('owners and admins only');
    const rows = platform(db).all<{ id: string; channel: DevOutboxItem['channel']; org_id: string | null; user_id: string | null; customer_id: string | null; to_address: string | null; locale: string | null; title: string | null; body: string | null; html: string | null; payload: string | null; created_at: number }>(
      `SELECT id, channel, org_id, user_id, customer_id, to_address, locale, title, body, html, payload, created_at FROM dev_outbox
        WHERE org_id IN (SELECT value FROM json_each(@orgs)) ORDER BY created_at DESC, id DESC LIMIT @lim`,
      { orgs: JSON.stringify(orgs), lim: clampLimit(c.req.query('limit'), 100, 500) },
    );
    const items: DevOutboxItem[] = rows.map((r) => ({
      id: r.id, channel: r.channel, orgId: r.org_id, userId: r.user_id, customerId: r.customer_id, to: r.to_address, locale: r.locale,
      title: r.title, body: r.body, html: r.html, payload: parseJson(r.payload, null), createdAt: r.created_at,
    }));
    return c.json(items);
  });

  app.post('/v1/dev/run-jobs', async (c) => {
    const cfg = cfgOf(c);
    const ran = await runJobs({ cfg }, cfg.now ? cfg.now() : Date.now());
    return c.json({ ran });
  });
}
