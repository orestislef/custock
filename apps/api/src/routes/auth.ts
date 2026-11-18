import type { Hono } from 'hono';
import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { LoginInput, OtpRequestInput, OtpVerifyInput, uuidv7 } from '@custock/core';
import { burnPasswordCheckAsync, sha256, verifyPasswordAsync, type Db } from '@custock/db';
import { pickLocale } from '@custock/i18n';
import type { AppEnv } from '../types';
import { issueTokens, revokeFamily, rotate } from '../lib/auth';
import { cfgOf, nowOf, requireAuth } from '../lib/context';
import { ApiProblem, unauthorized } from '../lib/problem';
import { clientIp, rateLimit, throttle } from '../lib/ratelimit';
import { clearLock, isLocked, recordFailure, waitBackoff } from '../lib/lockout';
import { platform } from '../lib/tenant';
import { devOutboxTransport } from '../lib/transport';
import { emailMessage } from '../lib/transport';
import { otpEmail } from '../email/messages';
import { policyNumber } from '../lib/policy';

const MIN = 60_000;
// per email: 5 wrong passwords in 15 minutes locks login for 15 minutes
// attempts and lock length from the policy engine (auth.loginAttempts, auth.lockMinutes)
const loginFails = (db: Db) => ({ max: policyNumber(db, 'auth.loginAttempts'), windowMs: 15 * MIN, lockMs: policyNumber(db, 'auth.lockMinutes') * MIN });
// codes: 5 an hour per address from one ip, 20 an hour per address in total, 30 an hour per ip.
// 5 wrong codes in 15 minutes lock codes for that address from that ip for 15 minutes
const OTP_REQUESTS = { max: 5, windowMs: 60 * MIN };
const OTP_REQUESTS_PER_EMAIL = { max: 20, windowMs: 60 * MIN };
const OTP_REQUESTS_PER_IP = { max: 30, windowMs: 60 * MIN };
const OTP_FAILS = { max: 5, windowMs: 15 * MIN, lockMs: 15 * MIN };

const tooMany = () => new ApiProblem(429, 'rate_limited');

// links customer records with the same verified email to the account
function linkCustomers(db: ReturnType<typeof platform>, userId: string, email: string) {
  db.run(
    'UPDATE customers SET user_id = @u WHERE email = @e AND user_id IS NULL AND email_verified_at IS NOT NULL AND erased_at IS NULL',
    { u: userId, e: email },
  );
}

export function authRoutes(app: Hono<AppEnv>) {
  const limited = rateLimit({ windowMs: 60_000, max: (c) => policyNumber(cfgOf(c).db, 'rate.authPerMinute'), prefix: 'auth' });
  // with the real login server in charge, our own login endpoints do not exist
  app.use('/v1/auth/*', async (c, next) => {
    if (cfgOf(c).auth?.mode === 'jwks' && c.req.path !== '/v1/auth/logout') throw new ApiProblem(404, 'not_found', 'sign in through the login server');
    await next();
  });

  app.post('/v1/auth/login', limited, async (c) => {
    const input = LoginInput.parse(await c.req.json());
    const cfg = cfgOf(c);
    const db = platform(cfg.db);
    const email = input.email.trim().toLowerCase();
    const now = nowOf(c);
    const ip = clientIp(c);
    const fails = loginFails(cfg.db);
    // locked for this address from this ip only; from everywhere else it only gets slower
    if (isLocked(cfg.db, 'login', email, ip, fails, now)) throw tooMany();
    await waitBackoff(cfg.db, 'login', email, now, cfg.rateLimit !== false);
    const user = db.get<{ id: string; password_hash: string | null; deleted_at: number | null }>(
      'SELECT id, password_hash, deleted_at FROM users WHERE email = @e',
      { e: email },
    );
    // the same work for unknown emails, so timing does not tell who has an account
    const ok = user && !user.deleted_at && user.password_hash ? await verifyPasswordAsync(input.password, user.password_hash) : (await burnPasswordCheckAsync(input.password), false);
    if (!ok || !user) {
      if (!recordFailure(cfg.db, 'login', email, ip, fails, now)) throw tooMany();
      throw unauthorized('wrong email or password');
    }
    clearLock(cfg.db, 'login', email, ip);
    linkCustomers(db, user.id, email);
    const { sessionId: _s, ...tokens } = await issueTokens(cfg, user.id, { userAgent: c.req.header('User-Agent') });
    return c.json(tokens);
  });

  app.post('/v1/auth/otp/request', limited, async (c) => {
    const input = OtpRequestInput.parse(await c.req.json());
    const cfg = cfgOf(c);
    const email = input.email.trim().toLowerCase();
    const now = nowOf(c);
    const ip = clientIp(c);
    if (isLocked(cfg.db, 'otpfail', email, ip, OTP_FAILS, now)) throw tooMany();
    // the volume limits (per ip, per address over every ip) are off only when tests switch rate limits off
    const volume = cfg.rateLimit !== false;
    if (volume && !throttle(cfg.db, `otpreq-ip:${ip}`, { ...OTP_REQUESTS_PER_IP, now })) throw tooMany();
    if (!throttle(cfg.db, `otpreq:${email}:${ip}`, { ...OTP_REQUESTS, now })) throw tooMany();
    if (volume && !throttle(cfg.db, `otpreq-all:${email}`, { ...OTP_REQUESTS_PER_EMAIL, now })) throw tooMany();
    const code = String(randomInt(100000, 1000000));
    platform(cfg.db).run(
      'INSERT INTO otp_codes (id, email, code_hash, created_at, expires_at) VALUES (@id, @e, @h, @now, @exp)',
      { id: uuidv7(now), e: email, h: sha256(`${email}:${code}`), now, exp: now + policyNumber(cfg.db, 'auth.otpMinutes') * MIN },
    );
    const locale = pickLocale(input.locale, c.get('locale'));
    devOutboxTransport(cfg.db).send(emailMessage(otpEmail(locale, { code }), { to: email, locale, payload: { type: 'otp' } }));
    return c.json(cfg.dev ? { sent: true, devCode: code } : { sent: true });
  });

  app.post('/v1/auth/otp/verify', limited, async (c) => {
    const input = OtpVerifyInput.parse(await c.req.json());
    const cfg = cfgOf(c);
    const db = platform(cfg.db);
    const email = input.email.trim().toLowerCase();
    const now = nowOf(c);
    const ip = clientIp(c);
    if (isLocked(cfg.db, 'otpfail', email, ip, OTP_FAILS, now)) throw tooMany();
    await waitBackoff(cfg.db, 'otpfail', email, now, cfg.rateLimit !== false);
    const otp = db.get<{ id: string; code_hash: string; attempts: number; expires_at: number }>(
      'SELECT id, code_hash, attempts, expires_at FROM otp_codes WHERE email = @e AND used_at IS NULL ORDER BY created_at DESC LIMIT 1',
      { e: email },
    );
    if (!otp || otp.expires_at < now || otp.attempts >= 5) throw unauthorized('code expired');
    if (otp.code_hash !== sha256(`${email}:${input.code}`)) {
      db.run('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = @id', { id: otp.id });
      // locked for this ip. the code itself stops after 5 wrong tries, a new one can be asked for
      if (!recordFailure(cfg.db, 'otpfail', email, ip, OTP_FAILS, now)) throw tooMany();
      throw unauthorized('wrong code');
    }
    const existing = db.get<{ id: string; password_hash: string | null }>('SELECT id, password_hash FROM users WHERE email = @e AND deleted_at IS NULL', { e: email });
    // codes are for customer accounts. staff with a password sign in with it (dev allows both).
    if (existing?.password_hash && !cfg.dev) throw unauthorized('sign in with your password');
    db.run('UPDATE otp_codes SET used_at = @now WHERE id = @id', { now, id: otp.id });
    clearLock(cfg.db, 'otpfail', email, ip);
    let user = existing ? { id: existing.id } : undefined;
    if (!user) {
      user = { id: uuidv7(now) };
      db.run(
        'INSERT INTO users (id, email, display_name, email_verified_at, locale, created_at, updated_at) VALUES (@id, @e, NULL, @now, @l, @now, @now)',
        { id: user.id, e: email, now, l: c.get('locale') },
      );
    } else {
      db.run('UPDATE users SET email_verified_at = coalesce(email_verified_at, @now) WHERE id = @id', { now, id: user.id });
    }
    linkCustomers(db, user.id, email);
    const { sessionId: _s, ...tokens } = await issueTokens(cfg, user.id, { userAgent: c.req.header('User-Agent') });
    return c.json(tokens);
  });

  app.post('/v1/auth/refresh', limited, async (c) => {
    const { refreshToken } = z.object({ refreshToken: z.string().min(10).max(200) }).parse(await c.req.json());
    return c.json(await rotate(cfgOf(c), refreshToken, c.req.header('User-Agent')));
  });

  app.post('/v1/auth/logout', requireAuth, (c) => {
    if (c.get('user').sessionId) revokeFamily(cfgOf(c), c.get('user').sessionId);
    return c.body(null, 204);
  });
}
