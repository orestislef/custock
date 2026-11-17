// tiny in memory limiter, per key per window. enough for one process.

import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../types';
import { ApiProblem } from './problem';

export function rateLimit(opts: { windowMs: number; max: number; prefix: string }): MiddlewareHandler<AppEnv> {
  const hits = new Map<string, { count: number; reset: number }>();
  return async (c, next) => {
    if (c.get('cfg').rateLimit === false) return next();
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip') || 'local';
    const key = `${opts.prefix}:${ip}:${c.req.path}`;
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
