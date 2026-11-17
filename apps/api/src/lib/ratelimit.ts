// rate limits. per ip in memory, per email in the database.
// the client ip is the socket address, or the rightmost X-Forwarded-For hop when we sit behind our
// own proxy (CUSTOCK_TRUSTED_PROXY=1). the leftmost hop is whatever the client wrote, so never that.

import type { Context, MiddlewareHandler } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';
import type { Db } from '@custock/db';
import type { AppEnv } from '../types';
import { ApiProblem } from './problem';
import { platform } from './tenant';

export function clientIp(c: Context<AppEnv>): string {
  const cfg = c.get('cfg');
  if (cfg.trustedProxy) {
    const hops = (c.req.header('x-forwarded-for') ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    if (hops.length) return hops[hops.length - 1]!;
  }
  try {
    return getConnInfo(c).remote.address ?? 'local';
  } catch {
    return 'local';
  }
}

export function rateLimit(opts: { windowMs: number; max: number; prefix: string }): MiddlewareHandler<AppEnv> {
  const hits = new Map<string, { count: number; reset: number }>();
  return async (c, next) => {
    if (c.get('cfg').rateLimit === false) return next();
    const key = `${opts.prefix}:${clientIp(c)}:${c.req.path}`;
    const t = Date.now();
    const h = hits.get(key);
    if (!h || h.reset < t) {
      hits.set(key, { count: 1, reset: t + opts.windowMs });
    } else {
      h.count++;
      if (h.count > opts.max) {
        c.header('Retry-After', String(Math.ceil((h.reset - t) / 1000)));
        throw new ApiProblem(429, 'rate_limited');
      }
    }
    if (hits.size > 10_000) for (const [k, v] of hits) if (v.reset < t) hits.delete(k);
    await next();
  };
}

// counts events per key in a window. returns false when the key is over the limit or locked.
export function throttle(db: Db, key: string, opts: { max: number; windowMs: number; now: number; lockMs?: number; count?: boolean }): boolean {
  const p = platform(db);
  const row = p.get<{ count: number; window_start: number; locked_until: number | null }>('SELECT count, window_start, locked_until FROM auth_throttle WHERE key = @k', { k: key });
  if (row?.locked_until && row.locked_until > opts.now) return false;
  const fresh = !row || row.window_start + opts.windowMs < opts.now;
  const count = fresh ? 0 : row!.count;
  if (count >= opts.max) {
    if (opts.lockMs) p.run('UPDATE auth_throttle SET locked_until = @u WHERE key = @k', { u: opts.now + opts.lockMs, k: key });
    return false;
  }
  if (opts.count !== false) {
    p.run(
      `INSERT INTO auth_throttle (key, count, window_start, locked_until) VALUES (@k, 1, @now, NULL)
       ON CONFLICT (key) DO UPDATE SET count = CASE WHEN @fresh THEN 1 ELSE count + 1 END,
         window_start = CASE WHEN @fresh THEN @now ELSE window_start END, locked_until = NULL`,
      { k: key, now: opts.now, fresh: fresh ? 1 : 0 },
    );
  }
  return true;
}

export function isThrottled(db: Db, key: string, max: number, windowMs: number, now: number): boolean {
  const row = platform(db).get<{ count: number; window_start: number; locked_until: number | null }>('SELECT count, window_start, locked_until FROM auth_throttle WHERE key = @k', { k: key });
  if (!row) return false;
  if (row.locked_until && row.locked_until > now) return true;
  return row.window_start + windowMs >= now && row.count >= max;
}

export function clearThrottle(db: Db, key: string) {
  platform(db).run('DELETE FROM auth_throttle WHERE key = @k', { k: key });
}
