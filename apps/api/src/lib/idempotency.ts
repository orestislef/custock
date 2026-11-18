// Idempotency-Key on creates: the same key from the same user within 24 hours returns the first result

import type { Context } from 'hono';
import type { AppEnv } from '../types';
import { cfgOf, nowOf } from './context';
import { platform } from './tenant';

const DAY = 86_400_000;

export async function idempotent(c: Context<AppEnv>, run: () => Promise<{ status: number; body: unknown }> | { status: number; body: unknown }) {
  const raw = c.req.header('Idempotency-Key');
  if (!raw) {
    const r = await run();
    return c.json(r.body as object, r.status as 200);
  }
  const db = platform(cfgOf(c).db);
  const user = c.get('user').id;
  const key = `${c.req.param('org') ?? '-'}|${c.req.method}|${c.req.path}|${raw}`;
  const now = nowOf(c);
  db.run('DELETE FROM idempotency_keys WHERE created_at < @old', { old: now - DAY });
  const hit = db.get<{ status: number; response: string; path: string }>('SELECT status, response, path FROM idempotency_keys WHERE user_id = @u AND key = @k', { u: user, k: key });
  if (hit) {
    c.header('Idempotent-Replay', 'true');
    return c.json(JSON.parse(hit.response) as object, hit.status as 200);
  }
  // the work and the record of it happen without a pause between them: an await here would let a
  // second request with the same key pass the check above before this one is written down
  const out = run();
  const r = out instanceof Promise ? await out : out;
  if (r.status < 300) {
    db.run(
      'INSERT OR IGNORE INTO idempotency_keys (user_id, key, org_id, method, path, status, response, created_at) VALUES (@u, @k, @o, @m, @p, @s, @r, @now)',
      { u: user, k: key, o: c.req.param('org') ?? null, m: c.req.method, p: c.req.path, s: r.status, r: JSON.stringify(r.body), now },
    );
  }
  return c.json(r.body as object, r.status as 200);
}
