// tokens from the real login server (CUSTOCK_AUTH_MODE=jwks): RS256 or ES256, checked against the
// server's JWKS, issuer and audience. sub is our user id. a user row is made on first sight.

import { jwtVerify, type JWTVerifyGetKey } from 'jose';
import { pickLocale } from '@custock/i18n';
import type { Db } from '@custock/db';
import type { AuthUser } from '../types';
import { unauthorized } from './problem';
import { platform } from './tenant';

export interface ExternalAuth {
  mode: 'jwks';
  issuer: string;
  audience: string;
  // createRemoteJWKSet(new URL(...)) in production, createLocalJWKSet(...) in tests
  keys: JWTVerifyGetKey;
}

interface Claims {
  sub?: string;
  email?: unknown;
  email_verified?: unknown;
  name?: unknown;
  locale?: unknown;
}

export async function verifyExternal(db: Db, auth: ExternalAuth, token: string, now: number): Promise<AuthUser> {
  let claims: Claims;
  try {
    const { payload } = await jwtVerify(token, auth.keys, {
      issuer: auth.issuer,
      audience: auth.audience,
      algorithms: ['RS256', 'ES256'],
      currentDate: new Date(now),
    });
    claims = payload as Claims;
  } catch {
    throw unauthorized('invalid or expired token');
  }
  const sub = typeof claims.sub === 'string' ? claims.sub : '';
  if (!sub || sub.length > 128) throw unauthorized('token without a subject');
  const p = platform(db);
  let user = p.get<{ id: string; email: string | null; display_name: string | null; locale: string; deleted_at: number | null }>(
    'SELECT id, email, display_name, locale, deleted_at FROM users WHERE id = @id',
    { id: sub },
  );
  if (!user) {
    const rawEmail = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : null;
    // an email already on another account is not taken over: the new user starts without one
    const email = rawEmail && !p.get('SELECT 1 FROM users WHERE email = @e AND deleted_at IS NULL', { e: rawEmail }) ? rawEmail : null;
    const verified = email && claims.email_verified === true ? now : null;
    const name = typeof claims.name === 'string' ? claims.name.slice(0, 120) : null;
    const locale = pickLocale(typeof claims.locale === 'string' ? claims.locale : null, 'el');
    p.run(
      `INSERT INTO users (id, email, display_name, email_verified_at, locale, created_at, updated_at)
       VALUES (@id, @email, @name, @verified, @locale, @now, @now)`,
      { id: sub, email, name, verified, locale, now },
    );
    // customer records with the same confirmed address belong to this person
    if (email && verified) {
      p.run(
        'UPDATE customers SET user_id = @u WHERE email = @e AND user_id IS NULL AND email_verified_at IS NOT NULL AND erased_at IS NULL',
        { u: sub, e: email },
      );
    }
    user = { id: sub, email, display_name: name, locale, deleted_at: null };
  }
  if (user.deleted_at) throw unauthorized('user gone');
  return { id: user.id, sessionId: '', email: user.email, displayName: user.display_name, locale: pickLocale(user.locale) };
}
