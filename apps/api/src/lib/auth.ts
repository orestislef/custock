// dev login provider: short access jwts, rotating refresh tokens with reuse detection.
// the real login server replaces the issuing part, verification stays the same shape.

import { SignJWT, jwtVerify } from 'jose';
import { randomToken, sha256 } from '@custock/db';
import { uuidv7 } from '@custock/core';
import type { Tokens } from '@custock/core';
import type { Config } from '../types';
import { platform } from './tenant';
import { unauthorized } from './problem';
import { policyIn, policyNumber } from './policy';

// lifetimes come from the policy engine: auth.accessMinutes for everyone, auth.sessionDays the
// shortest of the platform value and every business and role the person works in
const accessTtl = (cfg: Config) => policyNumber(cfg.db, 'auth.accessMinutes') * 60_000;
function refreshTtl(cfg: Config, userId: string): number {
  let days = policyNumber(cfg.db, 'auth.sessionDays');
  const orgs = platform(cfg.db).all<{ org_id: string }>("SELECT org_id FROM memberships WHERE user_id = @u AND status = 'active'", { u: userId });
  for (const o of orgs) days = Math.min(days, Number(policyIn(cfg.db, o.org_id, 'auth.sessionDays', { userId })));
  return days * 86_400_000;
}

// however often a session is refreshed, it ends this long after the first sign in
export const SESSION_FAMILY_MAX_MS = 90 * 86_400_000;

const key = (cfg: Config) => new TextEncoder().encode(cfg.jwtSecret);
const now = (cfg: Config) => (cfg.now ? cfg.now() : Date.now());

async function accessToken(cfg: Config, userId: string, sessionId: string): Promise<{ token: string; expiresAt: number }> {
  const expiresAt = now(cfg) + accessTtl(cfg);
  const token = await new SignJWT({ sid: sessionId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt(Math.floor(now(cfg) / 1000))
    .setExpirationTime(Math.floor(expiresAt / 1000))
    .setIssuer('custock-dev')
    .sign(key(cfg));
  return { token, expiresAt };
}

export async function issueTokens(
  cfg: Config,
  userId: string,
  opts: { familyId?: string; familyStartedAt?: number; userAgent?: string | null; deviceId?: string | null } = {},
): Promise<Tokens & { sessionId: string }> {
  const db = platform(cfg.db);
  const sessionId = uuidv7(now(cfg));
  const refreshToken = randomToken();
  const started = opts.familyStartedAt ?? now(cfg);
  const exp = Math.min(now(cfg) + refreshTtl(cfg, userId), started + SESSION_FAMILY_MAX_MS);
  cfg.db.transaction(() => {
    // a new sign in from a browser that was signed in before (it lost its token, or signed in
    // again on top) ends the session it had. a refresh keeps its family and its device
    if (!opts.familyId && opts.deviceId) {
      db.run(
        `UPDATE sessions SET revoked_at = @now
          WHERE user_id = @user AND device_id = @device AND revoked_at IS NULL`,
        { now: now(cfg), user: userId, device: opts.deviceId },
      );
    }
    db.run(
      `INSERT INTO sessions (id, user_id, family_id, refresh_hash, user_agent, device_id, created_at, expires_at, family_started_at)
       VALUES (@id, @user, @family, @hash, @ua, @device, @now, @exp, @started)`,
      {
        id: sessionId, user: userId, family: opts.familyId ?? sessionId, hash: sha256(refreshToken), ua: opts.userAgent ?? null,
        device: opts.deviceId ?? null, now: now(cfg), exp, started,
      },
    );
  })();
  const { token, expiresAt } = await accessToken(cfg, userId, sessionId);
  return { accessToken: token, refreshToken, expiresAt, sessionId };
}

interface SessionRow {
  id: string;
  user_id: string;
  family_id: string;
  family_started_at: number | null;
  created_at: number;
  expires_at: number;
  replaced_by: string | null;
  revoked_at: number | null;
  device_id: string | null;
}

// rotation: the old token is spent. presenting a spent token again kills the whole family.
export async function rotate(cfg: Config, refreshToken: string, userAgent?: string | null): Promise<Tokens> {
  const db = platform(cfg.db);
  const row = db.get<SessionRow>('SELECT id, user_id, family_id, family_started_at, created_at, expires_at, replaced_by, revoked_at, device_id FROM sessions WHERE refresh_hash = @h', { h: sha256(refreshToken) });
  if (!row) throw unauthorized('unknown refresh token');
  if (row.revoked_at || row.replaced_by) {
    db.run('UPDATE sessions SET revoked_at = coalesce(revoked_at, @now) WHERE family_id = @f', { now: now(cfg), f: row.family_id });
    throw unauthorized('refresh token reused, session family revoked');
  }
  if (row.expires_at < now(cfg)) throw unauthorized('refresh token expired');
  const started = row.family_started_at ?? row.created_at;
  if (started + SESSION_FAMILY_MAX_MS < now(cfg)) {
    db.run('UPDATE sessions SET revoked_at = coalesce(revoked_at, @now) WHERE family_id = @f', { now: now(cfg), f: row.family_id });
    throw unauthorized('session too old, sign in again');
  }
  // claim the old token first. if someone else already spent it, this is reuse.
  const marker = `pending:${uuidv7(now(cfg))}`;
  const claimed = db.run('UPDATE sessions SET replaced_by = @m WHERE id = @id AND replaced_by IS NULL AND revoked_at IS NULL', { m: marker, id: row.id });
  if (!claimed.changes) {
    db.run('UPDATE sessions SET revoked_at = coalesce(revoked_at, @now) WHERE family_id = @f', { now: now(cfg), f: row.family_id });
    throw unauthorized('refresh token reused, session family revoked');
  }
  const next = await issueTokens(cfg, row.user_id, { familyId: row.family_id, familyStartedAt: started, userAgent, deviceId: row.device_id });
  db.run('UPDATE sessions SET replaced_by = @next WHERE id = @id', { next: next.sessionId, id: row.id });
  return { accessToken: next.accessToken, refreshToken: next.refreshToken, expiresAt: next.expiresAt };
}

export function revokeFamily(cfg: Config, sessionId: string) {
  const db = platform(cfg.db);
  const row = db.get<{ family_id: string }>('SELECT family_id FROM sessions WHERE id = @id', { id: sessionId });
  if (row) db.run('UPDATE sessions SET revoked_at = coalesce(revoked_at, @now) WHERE family_id = @f', { now: now(cfg), f: row.family_id });
}

export async function verifyAccess(cfg: Config, token: string): Promise<{ userId: string; sessionId: string }> {
  try {
    const { payload } = await jwtVerify(token, key(cfg), { issuer: 'custock-dev', algorithms: ['HS256'], currentDate: new Date(now(cfg)) });
    if (!payload.sub || typeof payload.sid !== 'string') throw new Error('bad claims');
    return { userId: payload.sub, sessionId: payload.sid };
  } catch {
    throw unauthorized('invalid or expired token');
  }
}
