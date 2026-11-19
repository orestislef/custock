// forgot password for accounts with a password (staff and super admins). customers sign in with
// an email code and have no password to forget: they get an email that says so, with a link to the
// sign in of the business they follow.
//
// - the request always answers the same, whether or not the email has an account, and does the
//   same work either way (the email is rendered in both cases) so timing does not tell either
// - limits: per ip, and per email (over the email limit nothing is sent, the answer stays the same)
// - the link works 30 minutes and once; only a hash of the token is stored; a newer request ends
//   the older open links
// - a reset signs out every session of that person, signs this one in, and sends a short notice
// - these emails go out during a platform wide email pause too: they are about account safety

import type { Hono } from 'hono';
import { PasswordForgotInput, PasswordResetInput, passwordProblem, uuidv7 } from '@custock/core';
import { hashPasswordAsync, randomToken, sha256 } from '@custock/db';
import { pickLocale } from '@custock/i18n';
import type { AppEnv } from '../types';
import { issueTokens } from '../lib/auth';
import { cfgOf, nowOf } from '../lib/context';
import { ApiProblem } from '../lib/problem';
import { policyNumber } from '../lib/policy';
import { clientIp, rateLimit, throttle } from '../lib/ratelimit';
import { clearAllLocks } from '../lib/lockout';
import { platform } from '../lib/tenant';
import { devOutboxTransport, emailMessage } from '../lib/transport';
import { codeSignInEmail, passwordChangedEmail, passwordResetEmail } from '../email/account';

const MIN = 60_000;
export const RESET_TTL = 30 * MIN;
// per ip: 10 requests an hour. per email: 3 links an hour
const IP_REQUESTS = { max: 10, windowMs: 60 * MIN };
const EMAIL_REQUESTS = { max: 3, windowMs: 60 * MIN };
// per ip: 20 attempts at a link in 15 minutes (tokens cannot be guessed, this only keeps noise down)
const IP_ATTEMPTS = { max: 20, windowMs: 15 * MIN };

const tooMany = () => new ApiProblem(429, 'rate_limited');
const expired = () => new ApiProblem(410, 'reset_expired', 'this link was used, expired or never existed');

interface ResetRow {
  id: string;
  user_id: string;
  expires_at: number;
  used_at: number | null;
}

function openReset(db: ReturnType<typeof platform>, token: string, now: number): ResetRow | null {
  const row = db.get<ResetRow & { deleted_at: number | null; password_hash: string | null }>(
    `SELECT r.id, r.user_id, r.expires_at, r.used_at, u.deleted_at, u.password_hash
       FROM password_resets r JOIN users u ON u.id = r.user_id WHERE r.token_hash = @h`,
    { h: sha256(`reset:${token}`) },
  );
  if (!row || row.used_at || row.expires_at < now || row.deleted_at || !row.password_hash) return null;
  return row;
}

export function passwordResetRoutes(app: Hono<AppEnv>) {
  const limited = rateLimit({ windowMs: 60_000, max: 20, prefix: 'pwreset' });

  app.post('/v1/auth/password/forgot', limited, async (c) => {
    const input = PasswordForgotInput.parse(await c.req.json());
    const cfg = cfgOf(c);
    const db = platform(cfg.db);
    const now = nowOf(c);
    const ip = clientIp(c);
    if (!throttle(cfg.db, `pwreset-ip:${ip}`, { ...IP_REQUESTS, now })) throw tooMany();
    const email = input.email.trim().toLowerCase();
    const user = db.get<{ id: string; locale: string | null; password_hash: string | null; deleted_at: number | null }>(
      'SELECT id, locale, password_hash, deleted_at FROM users WHERE email = @e',
      { e: email },
    );
    const token = randomToken();
    const locale = pickLocale(user?.locale ?? input.locale ?? undefined, c.get('locale'));
    const web = cfg.publicWebUrl.replace(/\/$/, '');
    // rendered for everyone, sent only to a real account under its limit
    const mail = passwordResetEmail(locale, { email, url: `${web}/admin/reset/${token}` });
    const underLimit = throttle(cfg.db, `pwreset-email:${email}`, { ...EMAIL_REQUESTS, now });
    if (user && !user.deleted_at && user.password_hash && underLimit) {
      db.run('UPDATE password_resets SET used_at = @now WHERE user_id = @u AND used_at IS NULL', { now, u: user.id });
      db.run(
        `INSERT INTO password_resets (id, user_id, token_hash, created_at, expires_at, ip)
         VALUES (@id, @u, @h, @now, @exp, @ip)`,
        { id: uuidv7(now), u: user.id, h: sha256(`reset:${token}`), now, exp: now + policyNumber(cfg.db, 'auth.resetMinutes') * MIN, ip },
      );
      devOutboxTransport(cfg.db).send(emailMessage(mail, { to: email, userId: user.id, locale, payload: { type: 'password_reset' } }));
    } else if (user && !user.deleted_at && !user.password_hash && underLimit) {
      // a customer: no password to reset, so tell them how to sign in, from the business they follow
      const follows = db.all<{ slug: string; name: string }>(
        `SELECT o.slug, o.name FROM customers cu JOIN organizations o ON o.id = cu.org_id
          WHERE cu.user_id = @u AND cu.erased_at IS NULL AND o.status = 'active' ORDER BY cu.created_at DESC`,
        { u: user.id },
      );
      const [first, ...rest] = follows;
      if (first) {
        const howTo = codeSignInEmail(locale, { email, shop: first.name, url: `${web}/s/${first.slug}/me`, others: rest.slice(0, 5).map((o) => o.name) });
        devOutboxTransport(cfg.db).send(emailMessage(howTo, { to: email, userId: user.id, locale, payload: { type: 'code_sign_in' } }));
      }
    }
    return c.json({ sent: true as const }, 202);
  });

  app.get('/v1/auth/password/reset/:token', limited, (c) => {
    const cfg = cfgOf(c);
    const now = nowOf(c);
    if (!throttle(cfg.db, `pwreset-try:${clientIp(c)}`, { ...IP_ATTEMPTS, now })) throw tooMany();
    const row = openReset(platform(cfg.db), c.req.param('token'), now);
    if (!row) throw expired();
    return c.json({ valid: true as const, expiresAt: row.expires_at });
  });

  app.post('/v1/auth/password/reset', limited, async (c) => {
    const input = PasswordResetInput.parse(await c.req.json());
    const cfg = cfgOf(c);
    const db = platform(cfg.db);
    const now = nowOf(c);
    if (!throttle(cfg.db, `pwreset-try:${clientIp(c)}`, { ...IP_ATTEMPTS, now })) throw tooMany();
    const row = openReset(db, input.token, now);
    if (!row) throw expired();
    const user = db.get<{ id: string; email: string; locale: string | null }>('SELECT id, email, locale FROM users WHERE id = @id', { id: row.user_id })!;
    if (passwordProblem(input.password, user.email) === 'sameAsEmail') throw new ApiProblem(400, 'validation', 'the password is the email', { password: 'sameAsEmail' });
    const hash = await hashPasswordAsync(input.password);
    const done = cfg.db.transaction(() => {
      // claim the link first: two tabs racing on the same link, only one wins
      const claimed = db.run('UPDATE password_resets SET used_at = @now WHERE id = @id AND used_at IS NULL', { now, id: row.id });
      if (!claimed.changes) return false;
      db.run('UPDATE password_resets SET used_at = @now WHERE user_id = @u AND used_at IS NULL', { now, u: user.id });
      db.run('UPDATE users SET password_hash = @h, email_verified_at = coalesce(email_verified_at, @now), updated_at = @now WHERE id = @id', { h: hash, now, id: user.id });
      // every session of this person ends, on every device
      db.run('UPDATE sessions SET revoked_at = coalesce(revoked_at, @now) WHERE user_id = @u', { now, u: user.id });
      return true;
    })();
    if (!done) throw expired();
    if (user.email) clearAllLocks(cfg.db, user.email);
    const locale = pickLocale(user.locale ?? undefined, c.get('locale'));
    const web = cfg.publicWebUrl.replace(/\/$/, '');
    devOutboxTransport(cfg.db).send(
      emailMessage(passwordChangedEmail(locale, { email: user.email, url: `${web}/admin/forgot` }), { to: user.email, userId: user.id, locale, payload: { type: 'password_changed' } }),
    );
    const { sessionId: _s, ...tokens } = await issueTokens(cfg, user.id, { userAgent: c.req.header('User-Agent'), deviceId: input.deviceId });
    return c.json(tokens);
  });
}
