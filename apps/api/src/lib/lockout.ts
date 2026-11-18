// sign in lockouts. wrong passwords or codes lock that address only for the ip they came from
// (email + ip), so nobody can lock someone else out from another place. across every ip the
// address gets a growing delay instead of a lock: slow for guessing, never closed, and a password
// reset clears all of it.

import type { Db } from '@custock/db';
import { isThrottled, throttle } from './ratelimit';
import { platform } from './tenant';

const MIN = 60_000;

export type LockKind = 'login' | 'otpfail';

// per address over every ip: the first failures cost nothing, then each one waits longer
export const EMAIL_BACKOFF = { free: 10, windowMs: 60 * MIN, stepMs: 250, maxMs: 4000 };

const lockKey = (kind: LockKind, email: string, ip: string) => `${kind}:${email}:${ip}`;
const allKey = (kind: LockKind, email: string) => `${kind}-all:${email}`;

export function isLocked(db: Db, kind: LockKind, email: string, ip: string, opts: { max: number; windowMs: number }, now: number): boolean {
  return isThrottled(db, lockKey(kind, email, ip), opts.max, opts.windowMs, now);
}

// counts a failure. false when this ip is now locked for this address.
export function recordFailure(db: Db, kind: LockKind, email: string, ip: string, opts: { max: number; windowMs: number; lockMs: number }, now: number): boolean {
  throttle(db, allKey(kind, email), { max: Number.MAX_SAFE_INTEGER, windowMs: EMAIL_BACKOFF.windowMs, now });
  return throttle(db, lockKey(kind, email, ip), { ...opts, now });
}

// how long to wait before answering, from the failures for this address over every ip
export function backoffMs(db: Db, kind: LockKind, email: string, now: number): number {
  const row = platform(db).get<{ count: number; window_start: number }>('SELECT count, window_start FROM auth_throttle WHERE key = @k', { k: allKey(kind, email) });
  if (!row || row.window_start + EMAIL_BACKOFF.windowMs < now) return 0;
  const over = row.count - EMAIL_BACKOFF.free;
  if (over <= 0) return 0;
  return Math.min(EMAIL_BACKOFF.maxMs, EMAIL_BACKOFF.stepMs * 2 ** (over - 1));
}

export async function waitBackoff(db: Db, kind: LockKind, email: string, now: number, enabled = true): Promise<void> {
  const ms = enabled ? backoffMs(db, kind, email, now) : 0;
  if (ms > 0) await new Promise((r) => setTimeout(r, ms));
}

// a successful sign in from this ip clears its lock, a password reset clears every lock of the address
export function clearLock(db: Db, kind: LockKind, email: string, ip: string) {
  platform(db).run('DELETE FROM auth_throttle WHERE key = @k', { k: lockKey(kind, email, ip) });
}

export function clearAllLocks(db: Db, email: string) {
  const p = platform(db);
  for (const kind of ['login', 'otpfail'] as const) {
    p.run("DELETE FROM auth_throttle WHERE key = @all OR substr(key, 1, length(@prefix)) = @prefix", { all: allKey(kind, email), prefix: `${kind}:${email}:` });
  }
  // the older keys (address only), from before ip keyed locks
  p.run("DELETE FROM auth_throttle WHERE key IN (@a, @b)", { a: `login:${email}`, b: `otpfail:${email}` });
}
