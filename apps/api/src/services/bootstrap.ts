// a business from nothing: the org, its roles, the owner and maybe a first shop. used by the cli
// on a production server, where there is no seed data and no dev login. also new shops.

import { DEFAULT_ROLES, normalize, transliterate, uuidv7 } from '@custock/core';
import { randomToken, sha256, type Db } from '@custock/db';
import { audit, bumpPerms } from '../lib/audit';
import { platform, Tenant } from '../lib/tenant';
import { devOutboxTransport, emailMessage } from '../lib/transport';
import { ownerInviteEmail } from '../email/messages';

export const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

export function slugify(name: string): string {
  const s = transliterate(normalize(name)).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
  return s || 'shop';
}

export interface NewBusiness {
  name: string;
  slug: string;
  ownerEmail: string;
  // with a password the owner account is made now. without one the owner gets an invite link
  // (emailed when mail is live) and sets name and password themselves
  ownerName?: string;
  passwordHash?: string;
  // where the invite link points, CUSTOCK_PUBLIC_WEB_URL
  webUrl?: string;
  shopName?: string;
  locale?: 'en' | 'el' | 'ru';
  currency?: string;
  timezone?: string;
  country?: string;
  now?: number;
}

export class BootstrapError extends Error {}

export const OWNER_INVITE_TTL = 14 * 86_400_000;

export function createBusiness(db: Db, b: NewBusiness): { orgId: string; userId: string | null; shopId: string | null; inviteUrl: string | null } {
  const now = b.now ?? Date.now();
  const p = platform(db);
  const email = b.ownerEmail.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new BootstrapError(`not an email: ${b.ownerEmail}`);
  if (!SLUG.test(b.slug)) throw new BootstrapError(`slug must be lowercase letters, digits and dashes: ${b.slug}`);
  if (!b.name.trim()) throw new BootstrapError('the business needs a name');
  const invite = !b.passwordHash;
  if (!invite && !b.ownerName?.trim()) throw new BootstrapError('the owner needs a name');
  if (invite && !b.webUrl) throw new BootstrapError('the invite link needs CUSTOCK_PUBLIC_WEB_URL');
  // an existing account can still be invited: it signs in and accepts
  if (!invite && p.get('SELECT 1 FROM users WHERE email = @e', { e: email })) throw new BootstrapError(`${email} already has an account`);
  if (p.get('SELECT 1 FROM organizations WHERE slug = @s', { s: b.slug })) throw new BootstrapError(`the slug ${b.slug} is taken`);
  const orgId = uuidv7(now);
  const userId = invite ? null : uuidv7(now);
  let shopId: string | null = null;
  let inviteUrl: string | null = null;
  db.transaction(() => {
    p.run(
      `INSERT INTO organizations (id, name, slug, country, currency, timezone, default_locale, created_at)
       VALUES (@id, @name, @slug, @country, @currency, @tz, @locale, @now)`,
      { id: orgId, name: b.name.trim(), slug: b.slug, country: b.country ?? 'GR', currency: b.currency ?? 'EUR', tz: b.timezone ?? 'Europe/Athens', locale: b.locale ?? 'el', now },
    );
    const roleIds: Record<string, string> = {};
    for (const r of DEFAULT_ROLES) {
      const rid = uuidv7(now);
      roleIds[r.key] = rid;
      p.run(
        `INSERT INTO roles (id, org_id, template_key, name, rank, is_locked, created_at, updated_at)
         VALUES (@id, @org, @key, @name, @rank, @locked, @now, @now)`,
        { id: rid, org: orgId, key: r.key, name: r.key[0]!.toUpperCase() + r.key.slice(1), rank: r.rank, locked: r.locked ? 1 : 0, now },
      );
      for (const perm of r.permissions) p.run('INSERT INTO role_permissions (role_id, permission) VALUES (@r, @p)', { r: rid, p: perm });
    }
    const t = new Tenant(db, orgId);
    if (userId) {
      p.run(
        `INSERT INTO users (id, email, display_name, password_hash, email_verified_at, locale, created_at, updated_at)
         VALUES (@id, @e, @n, @h, NULL, @l, @now, @now)`,
        { id: userId, e: email, n: b.ownerName!.trim(), h: b.passwordHash!, l: b.locale ?? 'el', now },
      );
      const mid = uuidv7(now);
      t.run("INSERT INTO memberships (id, org_id, user_id, status, perms_version, joined_at) VALUES (@id, @org, @u, 'active', 1, @now)", { id: mid, u: userId, now });
      t.run(
        `INSERT INTO role_assignments (id, org_id, membership_id, role_id, scope_type, scope_id, granted_by, created_at)
         VALUES (@id, @org, @m, @r, 'org', @org, NULL, @now)`,
        { id: uuidv7(now), m: mid, r: roleIds.owner!, now },
      );
    }
    audit(t, { id: userId, kind: 'system' }, 'org.created', { type: 'org', id: orgId }, null, { name: b.name, slug: b.slug, owner: email }, now);
    if (b.shopName?.trim()) shopId = addShop(db, orgId, { name: b.shopName }, { id: userId, kind: 'system' }, now).id;
    // with an invite the link is made when the owner accepts it (join links need a person behind them)
    if (userId) ensureDefaultJoinLink(db, orgId, userId, now);
    if (invite) inviteUrl = inviteOwner(db, orgId, email, b.locale ?? 'el', b.webUrl!, now).url;
  })();
  return { orgId, userId, shopId, inviteUrl };
}

// an owner invite from the server setup: no inviter, so no rank or delegation checks apply. the
// link is emailed (it waits in the outbox until mail is live) and returned for the console.
export function inviteOwner(db: Db, orgId: string, email: string, locale: 'en' | 'el' | 'ru', webUrl: string, now = Date.now()): { id: string; url: string } {
  const t = new Tenant(db, orgId);
  const org = t.get<{ name: string }>('SELECT name FROM organizations WHERE id = @org');
  const role = t.get<{ id: string }>("SELECT id FROM roles WHERE org_id = @org AND template_key = 'owner'");
  if (!org || !role) throw new BootstrapError('no such business');
  const address = email.trim().toLowerCase();
  // an older owner invite for the same address stops working
  t.run('UPDATE invites SET revoked_at = @now WHERE org_id = @org AND email = @e AND role_id = @r AND accepted_at IS NULL AND revoked_at IS NULL', { now, e: address, r: role.id });
  const token = randomToken();
  const id = uuidv7(now);
  t.run(
    `INSERT INTO invites (id, org_id, email, role_id, scope_type, scope_id, token_hash, locale, invited_by, created_at, expires_at)
     VALUES (@id, @org, @e, @r, 'org', @org, @h, @l, NULL, @now, @exp)`,
    { id, e: address, r: role.id, h: sha256(token), l: locale, now, exp: now + OWNER_INVITE_TTL },
  );
  const url = `${webUrl.replace(/\/$/, '')}/invite/${token}`;
  devOutboxTransport(db, () => {}).send(emailMessage(ownerInviteEmail(locale, { org: org.name, url }), { orgId, to: address, locale, payload: { type: 'invite', inviteId: id } }));
  audit(t, { id: null, kind: 'system' }, 'invite.sent', { type: 'invite', id }, null, { email: address, role: 'owner' }, now);
  return { id, url };
}

export interface NewShop {
  name: string;
  slug?: string;
  city?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
}

// a shop with a slug unique in the org. everyone's permissions are refreshed so it shows up.
export function addShop(db: Db, orgId: string, s: NewShop, actor: { id: string | null; kind?: 'member' | 'system' }, now = Date.now()): { id: string; slug: string } {
  const t = new Tenant(db, orgId);
  const base = s.slug ?? slugify(s.name);
  if (!SLUG.test(base)) throw new BootstrapError(`slug must be lowercase letters, digits and dashes: ${base}`);
  let slug = base;
  for (let i = 2; t.get('SELECT 1 FROM shops WHERE org_id = @org AND slug = @s', { s: slug }); i++) {
    if (s.slug) throw new BootstrapError(`the shop slug ${s.slug} is taken`);
    slug = `${base.slice(0, 36)}-${i}`;
  }
  const id = uuidv7(now);
  t.run(
    `INSERT INTO shops (id, org_id, name, slug, city, address, phone, email, customer_visible, created_at)
     VALUES (@id, @org, @name, @slug, @city, @address, @phone, @email, 1, @now)`,
    { id, name: s.name.trim(), slug, city: s.city ?? null, address: s.address ?? null, phone: s.phone ?? null, email: s.email ?? null, now },
  );
  bumpPerms(t, 'all');
  audit(t, actor, 'shop.created', { type: 'shop', id }, null, { name: s.name, slug }, now);
  return { id, slug };
}

export const DEFAULT_JOIN_LABEL = 'Shop page';

// a new six character join code nobody uses yet
export function newJoinCode(db: Db): string {
  let code = '';
  do code = randomToken(5).replace(/[-_]/g, '').toLowerCase().slice(0, 6);
  while (code.length < 6 || platform(db).get('SELECT 1 FROM join_links WHERE code = @c', { c: code }));
  return code;
}

// every business starts with one way in for customers: a join link for the whole business, the one
// the shop page offers. made once, when the business has an owner account. returns the code, or
// null when the business already has an active one for the whole business.
export function ensureDefaultJoinLink(db: Db, orgId: string, createdBy: string, now = Date.now()): string | null {
  const t = new Tenant(db, orgId);
  const existing = t.get("SELECT 1 FROM join_links WHERE org_id = @org AND scope_type = 'org' AND disabled_at IS NULL AND (expires_at IS NULL OR expires_at > @now)", { now });
  if (existing) return null;
  const id = uuidv7(now);
  const code = newJoinCode(db);
  t.run(
    "INSERT INTO join_links (id, org_id, code, scope_type, scope_id, label, created_by, created_at) VALUES (@id, @org, @code, 'org', @org, @label, @u, @now)",
    { id, code, label: DEFAULT_JOIN_LABEL, u: createdBy, now },
  );
  audit(t, { id: createdBy, kind: 'system' }, 'joinlink.created', { type: 'join_link', id }, null, { code, label: DEFAULT_JOIN_LABEL }, now);
  return code;
}

// the first active owner of a business, for setup steps that need a person behind them
export function firstOwner(db: Db, orgId: string): string | null {
  return platform(db).get<{ user_id: string }>(
    `SELECT m.user_id FROM memberships m JOIN role_assignments a ON a.membership_id = m.id JOIN roles r ON r.id = a.role_id
      WHERE m.org_id = @o AND m.status = 'active' AND r.template_key = 'owner' ORDER BY m.joined_at LIMIT 1`,
    { o: orgId },
  )?.user_id ?? null;
}
