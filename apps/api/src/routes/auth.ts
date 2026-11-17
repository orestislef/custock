import type { Hono } from 'hono';
import { z } from 'zod';
import { LoginInput, OtpRequestInput, OtpVerifyInput, uuidv7 } from '@custock/core';
import { sha256, verifyPassword } from '@custock/db';
import { translator, pickLocale } from '@custock/i18n';
import type { AppEnv } from '../types';
import { issueTokens, revokeFamily, rotate } from '../lib/auth';
import { cfgOf, nowOf, requireAuth } from '../lib/context';
import { unauthorized } from '../lib/problem';
import { rateLimit } from '../lib/ratelimit';
import { platform } from '../lib/tenant';
import { devOutboxTransport } from '../lib/transport';

const OTP_TTL = 10 * 60_000;

// links customer records with the same verified email to the account
function linkCustomers(db: ReturnType<typeof platform>, userId: string, email: string) {
  db.run(
    'UPDATE customers SET user_id = @u WHERE email = @e AND user_id IS NULL AND email_verified_at IS NOT NULL AND erased_at IS NULL',
    { u: userId, e: email },
  );
}

export function authRoutes(app: Hono<AppEnv>) {
  const limited = rateLimit({ windowMs: 60_000, max: 20, prefix: 'auth' });

  app.post('/v1/auth/login', limited, async (c) => {
    const { email, password } = LoginInput.parse(await c.req.json());
    const db = platform(cfgOf(c).db);
    const user = db.get<{ id: string; password_hash: string | null; deleted_at: number | null }>(
      'SELECT id, password_hash, deleted_at FROM users WHERE email = @e',
      { e: email.trim().toLowerCase() },
    );
    if (!user || user.deleted_at || !verifyPassword(password, user.password_hash)) throw unauthorized('wrong email or password');
    linkCustomers(db, user.id, email.trim().toLowerCase());
    const { sessionId: _s, ...tokens } = await issueTokens(cfgOf(c), user.id, { userAgent: c.req.header('User-Agent') });
    return c.json(tokens);
  });

  app.post('/v1/auth/otp/request', limited, async (c) => {
    const input = OtpRequestInput.parse(await c.req.json());
    const cfg = cfgOf(c);
    const email = input.email.trim().toLowerCase();
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const now = nowOf(c);
    platform(cfg.db).run(
      'INSERT INTO otp_codes (id, email, code_hash, created_at, expires_at) VALUES (@id, @e, @h, @now, @exp)',
      { id: uuidv7(now), e: email, h: sha256(`${email}:${code}`), now, exp: now + OTP_TTL },
    );
    const locale = pickLocale(input.locale, c.get('locale'));
    const t = translator(locale, 'server');
    devOutboxTransport(cfg.db).send({
      channel: 'email', to: email, locale,
      title: t('email.otp.subject', { code }), body: t('email.otp.body', { code }),
    });
    return c.json(cfg.dev ? { sent: true, devCode: code } : { sent: true });
  });

  app.post('/v1/auth/otp/verify', limited, async (c) => {
    const input = OtpVerifyInput.parse(await c.req.json());
    const cfg = cfgOf(c);
    const db = platform(cfg.db);
    const email = input.email.trim().toLowerCase();
    const now = nowOf(c);
    const otp = db.get<{ id: string; code_hash: string; attempts: number; expires_at: number }>(
      'SELECT id, code_hash, attempts, expires_at FROM otp_codes WHERE email = @e AND used_at IS NULL ORDER BY created_at DESC LIMIT 1',
      { e: email },
    );
    if (!otp || otp.expires_at < now || otp.attempts >= 5) throw unauthorized('code expired');
    if (otp.code_hash !== sha256(`${email}:${input.code}`)) {
      db.run('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = @id', { id: otp.id });
      throw unauthorized('wrong code');
    }
    db.run('UPDATE otp_codes SET used_at = @now WHERE id = @id', { now, id: otp.id });
    let user = db.get<{ id: string }>('SELECT id FROM users WHERE email = @e AND deleted_at IS NULL', { e: email });
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
    const { refreshToken } = z.object({ refreshToken: z.string().min(10) }).parse(await c.req.json());
    return c.json(await rotate(cfgOf(c), refreshToken, c.req.header('User-Agent')));
  });

  app.post('/v1/auth/logout', requireAuth, (c) => {
    revokeFamily(cfgOf(c), c.get('user').sessionId);
    return c.body(null, 204);
  });
}
