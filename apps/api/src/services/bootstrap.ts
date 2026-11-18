// a business from nothing: the org, its roles, the owner and maybe a first shop. used by the cli
// on a production server, where there is no seed data and no dev login. also new shops.

import { DEFAULT_ROLES, normalize, transliterate, uuidv7 } from '@custock/core';
import type { Db } from '@custock/db';
import { audit, bumpPerms } from '../lib/audit';
import { platform, Tenant } from '../lib/tenant';

export const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

export function slugify(name: string): string {
  const s = transliterate(normalize(name)).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
  return s || 'shop';
}

export interface NewBusiness {
  name: string;
  slug: string;
  ownerEmail: string;
  ownerName: string;
  passwordHash: string;
  shopName?: string;
  locale?: 'en' | 'el' | 'ru';
  currency?: string;
  timezone?: string;
  country?: string;
  now?: number;
}

export class BootstrapError extends Error {}

export function createBusiness(db: Db, b: NewBusiness): { orgId: string; userId: string; shopId: string | null } {
  const now = b.now ?? Date.now();
  const p = platform(db);
  const email = b.ownerEmail.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new BootstrapError(`not an email: ${b.ownerEmail}`);
  if (!SLUG.test(b.slug)) throw new BootstrapError(`slug must be lowercase letters, digits and dashes: ${b.slug}`);
  if (!b.name.trim()) throw new BootstrapError('the business needs a name');
  if (!b.ownerName.trim()) throw new BootstrapError('the owner needs a name');
  if (p.get('SELECT 1 FROM users WHERE email = @e', { e: email })) throw new BootstrapError(`${email} already has an account`);
  if (p.get('SELECT 1 FROM organizations WHERE slug = @s', { s: b.slug })) throw new BootstrapError(`the slug ${b.slug} is taken`);
  const orgId = uuidv7(now);
  const userId = uuidv7(now);
  let shopId: string | null = null;
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
    p.run(
      `INSERT INTO users (id, email, display_name, password_hash, email_verified_at, locale, created_at, updated_at)
       VALUES (@id, @e, @n, @h, NULL, @l, @now, @now)`,
      { id: userId, e: email, n: b.ownerName.trim(), h: b.passwordHash, l: b.locale ?? 'el', now },
    );
    const t = new Tenant(db, orgId);
    const mid = uuidv7(now);
    t.run("INSERT INTO memberships (id, org_id, user_id, status, perms_version, joined_at) VALUES (@id, @org, @u, 'active', 1, @now)", { id: mid, u: userId, now });
    t.run(
      `INSERT INTO role_assignments (id, org_id, membership_id, role_id, scope_type, scope_id, granted_by, created_at)
       VALUES (@id, @org, @m, @r, 'org', @org, NULL, @now)`,
      { id: uuidv7(now), m: mid, r: roleIds.owner!, now },
    );
    audit(t, { id: userId, kind: 'system' }, 'org.created', { type: 'org', id: orgId }, null, { name: b.name, slug: b.slug, owner: email }, now);
    if (b.shopName?.trim()) shopId = addShop(db, orgId, { name: b.shopName }, { id: userId, kind: 'system' }, now).id;
  })();
  return { orgId, userId, shopId };
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
