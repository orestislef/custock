// the platform level: /v1/platform for super admins, /v1/platform-invites for the people they
// invite, and the guards that apply what a super admin decided (features, paused businesses,
// limits, platform wide pauses, the storage free tier) to every other route in one place.

import type { Context, Hono, MiddlewareHandler } from 'hono';
import { z } from 'zod';
import {
  Feature, NewBusinessInput, normalizeBarcode, OrgControlsPatch, PlatformInviteInput, PlatformSettingsPatch, uuidv7,
  type PlatformInvitePreview,
  LIMITS, passwordProblem, zLine, zNewPassword,
} from '@custock/core';
import { hashPasswordAsync } from '@custock/db';
import type { AppEnv } from '../types';
import { issueTokens } from '../lib/auth';
import { cfgOf, nowOf, requireAuth } from '../lib/context';
import { ApiProblem, forbidden, notFound } from '../lib/problem';
import { rateLimit } from '../lib/ratelimit';
import { decodeCursor, platform } from '../lib/tenant';
import { photoStoreOf } from './uploads';
import { isSuperadmin, orgFlags, platformPaused, platformSettings, shopsUsed, staffUsed, storageRefusal } from '../lib/platform-access';
import {
  auditPage, businessDetail, claimPlatformInvite, createBusinessFor, deleteBusinessEverything, inviteOwnerFor, inviteSuperAdmin, listBusinesses, openPlatformInvite,
  orgControls, overview, removeSuperAdmin, resendOwnerInvite, resendSuperAdminInvite, revokeOwnerInvite, revokeSuperAdminInvite,
  setOrgControls, setPlatformSettings, suggestSlug, superAdmins,
} from '../services/platform';

const requireSuperadmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!isSuperadmin(cfgOf(c).db, c.get('user').id)) throw forbidden('super admins only');
  await next();
};

const mail = (c: Context<AppEnv>) => ({ webUrl: cfgOf(c).publicWebUrl, emailed: !!cfgOf(c).sending?.email, now: nowOf(c) });

// ---------------------------------------------------------------- guards

// which feature a business route belongs to. dashboard cards stay, they are the home screen
function featureFor(method: string, rest: string): Feature | null {
  if (/^\/posts(\/|$)/.test(rest)) return 'posts';
  if (/^\/transfers(\/|$)/.test(rest)) return 'transfers';
  if (/^\/counts(\/|$)/.test(rest) || /^\/shops\/[^/]+\/counts$/.test(rest)) return 'counts';
  if (/^\/reports\/(sales|top-sellers|most-wanted|join-links|shrinkage)$/.test(rest)) return 'reports';
  if (method === 'POST' && rest === '/uploads/presign') return 'uploads';
  return null;
}

const featureOff = (f: string) => new ApiProblem(403, 'feature_off', `${f} is switched off for this business`);
const paused = () => new ApiProblem(403, 'org_suspended', 'this business is paused');

async function bodyBytes(c: Context<AppEnv>): Promise<number> {
  try {
    const b = (await c.req.json()) as { bytes?: unknown };
    return typeof b?.bytes === 'number' && b.bytes > 0 ? b.bytes : 0;
  } catch {
    return 0;
  }
}

function storageGuard(c: Context<AppEnv>, bytes: number) {
  const why = storageRefusal(cfgOf(c).db, bytes, nowOf(c));
  if (why) throw new ApiProblem(403, 'storage_full', why);
}

// /v1/orgs/:org/*, after orgContext
const orgGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  const ctx = c.get('org');
  const db = cfgOf(c).db;
  const user = c.get('user');
  if (ctx.access.suspended && !isSuperadmin(db, user.id)) throw paused();
  const rest = c.req.path.replace(/^\/v1\/orgs\/[^/]+/, '');
  const feature = featureFor(c.req.method, rest);
  if (feature && ctx.access.disabledFeatures?.includes(feature)) throw featureOff(feature);
  if (c.req.method === 'POST' && rest === '/invites') {
    if (platformPaused(db, 'pause_invites')) throw new ApiProblem(403, 'platform_paused', 'new staff invites are paused');
    const f = orgFlags(db, ctx.org.id);
    if (f?.maxStaff != null && staffUsed(db, ctx.org.id, nowOf(c)) >= f.maxStaff) throw new ApiProblem(403, 'limit_reached', `this business can have ${f.maxStaff} staff`);
  }
  if (c.req.method === 'POST' && rest === '/shops') {
    const f = orgFlags(db, ctx.org.id);
    if (f?.maxShops != null && shopsUsed(db, ctx.org.id) >= f.maxShops) throw new ApiProblem(403, 'limit_reached', `this business can have ${f.maxShops} shops`);
  }
  if (c.req.method === 'POST' && rest === '/uploads/presign') storageGuard(c, await bodyBytes(c));
  await next();
};

// a path part as text. a broken %-escape is a link that leads nowhere: 404, not a server error
function decodePart(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch {
    throw notFound();
  }
}

// the business behind a customer facing route, when the path names one
function orgForCustomerPath(c: Context<AppEnv>): string | null {
  const db = cfgOf(c).db;
  const p = platform(db);
  const path = c.req.path;
  let m = path.match(/^\/v1\/(?:public|c)\/join\/([^/]+)$/);
  if (m) return p.get<{ org_id: string }>('SELECT org_id FROM join_links WHERE code = @c', { c: decodePart(m[1]!) })?.org_id ?? null;
  m = path.match(/^\/v1\/(?:public|c)\/orgs\/([^/]+)/);
  if (m) return p.get<{ id: string }>('SELECT id FROM organizations WHERE slug = @s', { s: decodePart(m[1]!) })?.id ?? null;
  m = path.match(/^\/v1\/public\/p\/([^/]+)$/);
  if (m) {
    const raw = decodePart(m[1]!);
    const sep = raw.indexOf(':');
    const slug = sep > 0 && !/^https?$/i.test(raw.slice(0, sep)) ? raw.slice(0, sep) : null;
    const n = normalizeBarcode(slug ? raw.slice(sep + 1) : raw);
    return p.get<{ org_id: string }>(
      `SELECT b.org_id FROM barcodes b JOIN organizations o ON o.id = b.org_id
        WHERE (b.code_norm = @n OR b.code = @raw) AND (@slug IS NULL OR o.slug = @slug) AND o.archived_at IS NULL ORDER BY o.created_at LIMIT 1`,
      { n: n.codeNorm, raw: n.code, slug },
    )?.org_id ?? null;
  }
  return null;
}

// /v1/public/* and /v1/c/*: a paused business or one with its customer pages off is not available,
// and new signups stop while the platform pause is on
const customerGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  const db = cfgOf(c).db;
  const signup = c.req.method === 'POST' && /^\/v1\/(public|c)\/join\/[^/]+$/.test(c.req.path);
  if (signup && platformPaused(db, 'pause_signups')) throw new ApiProblem(403, 'platform_paused', 'new signups are paused');
  const orgId = orgForCustomerPath(c);
  if (orgId) {
    const f = orgFlags(db, orgId);
    if (f?.status === 'suspended') throw new ApiProblem(403, 'org_suspended', 'not available right now');
    if (f?.disabledFeatures.includes('customer_pages')) throw featureOff('customer_pages');
  }
  await next();
};

// a profile photo, any purpose the person uploads for themselves
const meUploadGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.req.method === 'POST' && /^\/v1\/me\/uploads\/presign$/.test(c.req.path)) storageGuard(c, await bodyBytes(c));
  await next();
};

// registered in app.ts right after the auth and org context middleware, before every route
export function platformGuards(app: Hono<AppEnv>) {
  app.use('/v1/orgs/:org', orgGuard);
  app.use('/v1/orgs/:org/*', orgGuard);
  app.use('/v1/public/*', customerGuard);
  app.use('/v1/c/*', customerGuard);
  app.use('/v1/me/*', meUploadGuard);
}

// ---------------------------------------------------------------- routes

export function platformRoutes(app: Hono<AppEnv>) {
  app.use('/v1/platform/*', requireAuth, requireSuperadmin);

  app.get('/v1/platform/overview', (c) => c.json(overview(cfgOf(c).db, nowOf(c))));
  app.get('/v1/platform/businesses', (c) => c.json(listBusinesses(cfgOf(c).db, nowOf(c))));
  app.get('/v1/platform/businesses/:orgId', (c) => c.json(businessDetail(cfgOf(c).db, c.req.param('orgId'), nowOf(c))));
  app.get('/v1/platform/slug', (c) => c.json({ slug: suggestSlug(cfgOf(c).db, z.string().trim().min(1).max(80).parse(c.req.query('name'))) }));

  app.post('/v1/platform/businesses', async (c) => {
    const input = NewBusinessInput.parse(await c.req.json());
    return c.json(createBusinessFor(cfgOf(c).db, c.get('user').id, input, mail(c)), 201);
  });

  app.post('/v1/platform/businesses/:orgId/owner-invites', async (c) => {
    const input = PlatformInviteInput.parse(await c.req.json());
    return c.json(inviteOwnerFor(cfgOf(c).db, c.get('user').id, c.req.param('orgId'), input, mail(c)), 201);
  });
  app.post('/v1/platform/businesses/:orgId/owner-invites/:id/resend', (c) =>
    c.json(resendOwnerInvite(cfgOf(c).db, c.get('user').id, c.req.param('orgId'), c.req.param('id'), mail(c)), 201));
  app.delete('/v1/platform/businesses/:orgId/owner-invites/:id', (c) => {
    revokeOwnerInvite(cfgOf(c).db, c.get('user').id, c.req.param('orgId'), c.req.param('id'), nowOf(c));
    return c.body(null, 204);
  });

  // the whole business with everything in it. the slug typed again is the confirmation
  app.delete('/v1/platform/businesses/:orgId', async (c) => {
    const { confirm } = z.object({ confirm: z.string().min(1).max(60) }).parse(await c.req.json());
    const db = cfgOf(c).db;
    const org = platform(db).get<{ slug: string }>('SELECT slug FROM organizations WHERE id = @id', { id: c.req.param('orgId') });
    if (!org) throw notFound('organization');
    if (confirm !== org.slug) throw new ApiProblem(400, 'validation', 'type the business web address to confirm', { confirm: 'mismatch' });
    const store = photoStoreOf(cfgOf(c));
    const r = await deleteBusinessEverything(db, c.req.param('orgId'), c.get('user').id, {
      removeObject: (k) => store.remove(k), log: (l) => console.log(l), now: nowOf(c),
    });
    return c.json({ accountsClosed: r.accountsClosed, objects: r.objects, rows: Object.values(r.rows).reduce((a, b) => a + b, 0) });
  });

  app.patch('/v1/platform/businesses/:orgId/controls', async (c) => {
    const patch = OrgControlsPatch.parse(await c.req.json());
    return c.json(setOrgControls(cfgOf(c).db, c.get('user').id, c.req.param('orgId'), patch, nowOf(c)));
  });

  app.get('/v1/platform/settings', (c) => c.json(platformSettings(cfgOf(c).db)));
  app.patch('/v1/platform/settings', async (c) => {
    const patch = PlatformSettingsPatch.parse(await c.req.json());
    return c.json(setPlatformSettings(cfgOf(c).db, c.get('user').id, patch, nowOf(c)));
  });

  app.get('/v1/platform/audit', (c) => c.json(auditPage(cfgOf(c).db, decodeCursor(c.req.query('cursor')), 50)));

  app.get('/v1/platform/superadmins', (c) => c.json(superAdmins(cfgOf(c).db, c.get('user').id, nowOf(c))));
  app.post('/v1/platform/superadmin-invites', async (c) => {
    const input = PlatformInviteInput.parse(await c.req.json());
    return c.json(inviteSuperAdmin(cfgOf(c).db, c.get('user').id, input, mail(c)), 201);
  });
  app.post('/v1/platform/superadmin-invites/:id/resend', (c) => c.json(resendSuperAdminInvite(cfgOf(c).db, c.get('user').id, c.req.param('id'), mail(c)), 201));
  app.delete('/v1/platform/superadmin-invites/:id', (c) => {
    revokeSuperAdminInvite(cfgOf(c).db, c.get('user').id, c.req.param('id'), nowOf(c));
    return c.body(null, 204);
  });
  app.delete('/v1/platform/superadmins/:userId', (c) => {
    removeSuperAdmin(cfgOf(c).db, c.get('user').id, c.req.param('userId'), nowOf(c));
    return c.body(null, 204);
  });

  // what the super admin decided for a business, readable by anyone working there
  app.get('/v1/orgs/:org/controls', (c) => c.json(orgControls(cfgOf(c).db, c.get('org').org.id)));

  // ------------------------------------------------------------ super admin invites
  // like staff invites: the link is the proof. a brand new person sets a name and password, an
  // email that already has an account signs in and accepts, so a link never takes over an account.

  const inviteLimit = rateLimit({ windowMs: 60_000, max: 30, prefix: 'platform-invite' });

  app.get('/v1/platform-invites/:token', inviteLimit, (c) => {
    const db = cfgOf(c).db;
    const inv = openPlatformInvite(db, c.req.param('token'), nowOf(c));
    const p = platform(db);
    const inviter = inv.invited_by ? p.get<{ n: string | null }>('SELECT coalesce(display_name, email) AS n FROM users WHERE id = @id', { id: inv.invited_by })?.n ?? null : null;
    const accountExists = !!p.get('SELECT 1 FROM users WHERE email = @e AND deleted_at IS NULL', { e: inv.email });
    const body: PlatformInvitePreview = { email: inv.email, invitedBy: inviter, accountExists, expiresAt: inv.expires_at };
    return c.json(body);
  });

  app.post('/v1/platform-invites/register', inviteLimit, async (c) => {
    const input = z.object({
      token: z.string().min(10).max(200),
      displayName: zLine(LIMITS.personName),
      password: zNewPassword,
      locale: z.enum(['en', 'el', 'ru']).optional(),
    }).parse(await c.req.json());
    const cfg = cfgOf(c);
    if (cfg.auth?.mode === 'jwks') throw notFound('accounts are made on the login server');
    const db = cfg.db;
    const now = nowOf(c);
    const inv = openPlatformInvite(db, input.token, now);
    const p = platform(db);
    if (p.get('SELECT 1 FROM users WHERE email = @e', { e: inv.email })) throw new ApiProblem(409, 'account_exists', 'sign in with that account, then accept');
    if (passwordProblem(input.password, inv.email) === 'sameAsEmail') throw new ApiProblem(400, 'validation', 'the password is the email', { password: 'sameAsEmail' });
    // the email counts as verified only when the invite really went out by email
    const emailed = !!p.get("SELECT 1 FROM dev_outbox WHERE channel = 'email' AND sent_at IS NOT NULL AND json_extract(payload, '$.inviteId') = @id", { id: inv.id });
    const userId = uuidv7(now);
    const hash = await hashPasswordAsync(input.password);
    db.transaction(() => {
      p.run(
        `INSERT INTO users (id, email, display_name, password_hash, email_verified_at, locale, created_at, updated_at)
         VALUES (@id, @e, @n, @h, @v, @l, @now, @now)`,
        { id: userId, e: inv.email, n: input.displayName, h: hash, v: emailed ? now : null, l: input.locale ?? inv.locale ?? c.get('locale'), now },
      );
      claimPlatformInvite(db, inv, userId, now);
    })();
    const { sessionId: _s, ...tokens } = await issueTokens(cfg, userId, { userAgent: c.req.header('User-Agent') });
    return c.json(tokens, 201);
  });

  app.post('/v1/platform-invites/accept', requireAuth, async (c) => {
    const { token } = z.object({ token: z.string().min(10).max(200) }).parse(await c.req.json());
    const db = cfgOf(c).db;
    const now = nowOf(c);
    const inv = openPlatformInvite(db, token, now);
    const user = c.get('user');
    if ((user.email ?? '').toLowerCase() !== inv.email) throw forbidden('different email', 'invite_email_mismatch');
    claimPlatformInvite(db, inv, user.id, now);
    return c.body(null, 204);
  });
}

