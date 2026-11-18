// what a super admin does above the businesses: the list and overview, new businesses and their
// owner invites, per business controls (features, limits, paused), platform wide pauses, other
// super admins and their invites. every write lands in platform_audit with before and after.

import {
  FEATURES, uuidv7,
  type BusinessCreated, type Feature, type MoneyByCurrency, type OrgControls, type OrgControlsPatch, type PendingInvite,
  type PlatformAuditEntry, type PlatformBusiness, type PlatformBusinessDetail, type PlatformOverview, type PlatformSettings,
  type PlatformSettingsPatch, type SuperAdmins,
} from '@custock/core';
import { randomToken, sha256, type Db } from '@custock/db';
import { pickLocale } from '@custock/i18n';
import { ApiProblem, badRequest, notFound } from '../lib/problem';
import { orgFlags, platformSettings, storageBytes, storageUse } from '../lib/platform-access';
import { encodeCursor, parseJson, platform, Tenant } from '../lib/tenant';
import { localDayStart } from '../lib/time';
import { devOutboxTransport, emailMessage } from '../lib/transport';
import { superadminInviteEmail } from '../email/platform';
import { BootstrapError, createBusiness as bootstrapBusiness, inviteOwner as bootstrapInviteOwner, OWNER_INVITE_TTL, slugify, SLUG } from './bootstrap';

const DAY = 86_400_000;
export const PLATFORM_INVITE_TTL = 7 * DAY;

type Locale3 = 'en' | 'el' | 'ru';

export function platformAudit(
  db: Db,
  actorId: string | null,
  action: string,
  target: { orgId?: string | null; entity?: { type: string; id: string } | null; before?: unknown; after?: unknown } = {},
  now = Date.now(),
) {
  const details = target.before === undefined && target.after === undefined ? null : JSON.stringify({ before: target.before ?? null, after: target.after ?? null });
  platform(db).run(
    `INSERT INTO platform_audit (id, actor_id, action, org_id, entity_type, entity_id, details_json, created_at)
     VALUES (@id, @a, @action, @org, @et, @eid, @d, @now)`,
    { id: uuidv7(now), a: actorId, action, org: target.orgId ?? null, et: target.entity?.type ?? null, eid: target.entity?.id ?? null, d: details, now },
  );
}

// ---------------------------------------------------------------- businesses

interface OrgListRow {
  id: string; name: string; slug: string; created_at: number; default_locale: Locale3; currency: string; timezone: string;
  status: 'active' | 'suspended'; disabled_features: string;
}

function ownersOf(db: Db, orgId: string) {
  return new Tenant(db, orgId).all<{ user_id: string; name: string | null; email: string | null }>(
    `SELECT DISTINCT m.user_id, u.display_name AS name, u.email
       FROM memberships m JOIN role_assignments a ON a.membership_id = m.id JOIN roles r ON r.id = a.role_id JOIN users u ON u.id = m.user_id
      WHERE m.org_id = @org AND m.status = 'active' AND r.template_key = 'owner' AND a.scope_type = 'org' AND u.deleted_at IS NULL
      ORDER BY m.joined_at`,
  ).map((r) => ({ userId: r.user_id, name: r.name, email: r.email }));
}

function ownerRoleId(db: Db, orgId: string): string | null {
  return new Tenant(db, orgId).get<{ id: string }>("SELECT id FROM roles WHERE org_id = @org AND template_key = 'owner'")?.id ?? null;
}

function pendingOwnerInvites(db: Db, orgId: string, now: number): PendingInvite[] {
  const role = ownerRoleId(db, orgId);
  if (!role) return [];
  return new Tenant(db, orgId).all<{ id: string; email: string; created_at: number; expires_at: number }>(
    `SELECT id, email, created_at, expires_at FROM invites
      WHERE org_id = @org AND role_id = @r AND accepted_at IS NULL AND revoked_at IS NULL ORDER BY created_at DESC`,
    { r: role },
  ).map((r) => ({ id: r.id, email: r.email, createdAt: r.created_at, expiresAt: r.expires_at, expired: r.expires_at < now }));
}

// staff of a business: active members, a super admin who also happens to be a member not counted
function staffCount(db: Db, orgId: string): number {
  return new Tenant(db, orgId).get<{ n: number }>(
    `SELECT count(*) AS n FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.org_id = @org AND m.status = 'active' AND u.platform_role IS NULL`,
  )!.n;
}

function counts(db: Db, orgId: string) {
  const t = new Tenant(db, orgId);
  const n = (sql: string) => t.get<{ n: number }>(sql)!.n;
  return {
    shops: n('SELECT count(*) AS n FROM shops WHERE org_id = @org AND archived_at IS NULL'),
    staff: staffCount(db, orgId),
    products: n('SELECT count(*) AS n FROM products WHERE org_id = @org AND archived_at IS NULL'),
    // confirmed: following at least one shop, not just signed up
    customers: n(
      `SELECT count(*) AS n FROM customers c WHERE c.org_id = @org AND c.erased_at IS NULL
         AND EXISTS (SELECT 1 FROM customer_subscriptions s WHERE s.org_id = @org AND s.customer_id = c.id AND s.status = 'subscribed')`,
    ),
  };
}

function businessOf(db: Db, r: OrgListRow, now: number): PlatformBusiness {
  const disabled = parseJson<string[]>(r.disabled_features, []);
  return {
    orgId: r.id,
    name: r.name,
    slug: r.slug,
    createdAt: r.created_at,
    defaultLocale: r.default_locale,
    currency: r.currency,
    status: r.status,
    disabledFeatures: FEATURES.filter((f) => disabled.includes(f)),
    owners: ownersOf(db, r.id),
    counts: counts(db, r.id),
    pendingOwnerInvites: pendingOwnerInvites(db, r.id, now),
    storageBytes: storageBytes(db, r.id),
  };
}

const ORG_LIST_COLUMNS = 'id, name, slug, created_at, default_locale, currency, timezone, status, disabled_features';

export function listBusinesses(db: Db, now = Date.now()): PlatformBusiness[] {
  return platform(db)
    .all<OrgListRow>(`SELECT ${ORG_LIST_COLUMNS} FROM organizations WHERE archived_at IS NULL ORDER BY name COLLATE NOCASE`)
    .map((r) => businessOf(db, r, now));
}

function orgRowById(db: Db, orgId: string): OrgListRow {
  const r = platform(db).get<OrgListRow>(`SELECT ${ORG_LIST_COLUMNS} FROM organizations WHERE id = @id AND archived_at IS NULL`, { id: orgId });
  if (!r) throw notFound('organization');
  return r;
}

export function orgControls(db: Db, orgId: string): OrgControls {
  const f = orgFlags(db, orgId);
  if (!f) throw notFound('organization');
  const c = counts(db, orgId);
  return { status: f.status, disabledFeatures: f.disabledFeatures, maxShops: f.maxShops, maxStaff: f.maxStaff, shops: c.shops, staff: c.staff };
}

export function businessDetail(db: Db, orgId: string, now = Date.now()): PlatformBusinessDetail {
  const r = orgRowById(db, orgId);
  const shops = new Tenant(db, orgId).all<{ id: string; name: string }>('SELECT id, name FROM shops WHERE org_id = @org AND archived_at IS NULL ORDER BY created_at, name');
  return { ...businessOf(db, r, now), controls: orgControls(db, orgId), shops };
}

// money per currency: sales of every business, in each business's own day
function salesSince(db: Db, org: OrgListRow, from: number): number {
  const v = new Tenant(db, org.id).get<{ v: number | null }>(
    `SELECT sum(-(CASE WHEN p.uom = 'piece' THEN m.qty_delta ELSE m.qty_delta / 1000.0 END) * coalesce(m.unit_price_minor, v.price_minor, 0)) AS v
       FROM stock_movements m JOIN product_variants v ON v.id = m.variant_id JOIN products p ON p.id = v.product_id
      WHERE m.org_id = @org AND m.kind = 'sale' AND m.recorded_at >= @from`,
    { from },
  )?.v;
  return Math.round(v ?? 0);
}

function addMoney(list: MoneyByCurrency, currency: string, minor: number) {
  const hit = list.find((x) => x.currency === currency);
  if (hit) hit.minor += minor;
  else list.push({ currency, minor });
}

export function overview(db: Db, now = Date.now()): PlatformOverview {
  const p = platform(db);
  const orgs = p.all<OrgListRow>(`SELECT ${ORG_LIST_COLUMNS} FROM organizations WHERE archived_at IS NULL`);
  const out: PlatformOverview = {
    businesses: orgs.length, suspended: 0, shops: 0, staff: 0, customers: 0, products: 0,
    salesToday: [], sales14d: [], emailsSent14d: 0, pushesSent14d: 0, pendingInvites: 0,
    storage: storageUse(db, now),
  };
  for (const o of orgs) {
    if (o.status === 'suspended') out.suspended++;
    const c = counts(db, o.id);
    out.shops += c.shops;
    out.staff += c.staff;
    out.customers += c.customers;
    out.products += c.products;
    addMoney(out.salesToday, o.currency, salesSince(db, o, localDayStart(now, o.timezone)));
    addMoney(out.sales14d, o.currency, salesSince(db, o, localDayStart(now - 13 * DAY, o.timezone)));
    out.pendingInvites += pendingOwnerInvites(db, o.id, now).filter((i) => !i.expired).length;
  }
  const sent = p.all<{ channel: string; n: number }>(
    'SELECT channel, count(*) AS n FROM dev_outbox WHERE sent_at IS NOT NULL AND sent_at >= @from GROUP BY channel',
    { from: now - 14 * DAY },
  );
  out.emailsSent14d = sent.find((s) => s.channel === 'email')?.n ?? 0;
  out.pushesSent14d = sent.find((s) => s.channel === 'push')?.n ?? 0;
  out.pendingInvites += p.get<{ n: number }>(
    'SELECT count(*) AS n FROM platform_invites WHERE accepted_at IS NULL AND revoked_at IS NULL AND expires_at >= @now',
    { now },
  )!.n;
  return out;
}

// a free slug for a name, latin from greek and cyrillic
export function suggestSlug(db: Db, name: string): string {
  const base = slugify(name).slice(0, 36).replace(/-+$/, '') || 'shop';
  const taken = (s: string) => !!platform(db).get('SELECT 1 FROM organizations WHERE slug = @s', { s });
  if (!taken(base)) return base;
  for (let i = 2; i < 1000; i++) if (!taken(`${base}-${i}`)) return `${base}-${i}`;
  return `${base}-${randomToken().slice(0, 6).toLowerCase().replace(/[^a-z0-9]/g, 'x')}`;
}

export function createBusinessFor(
  db: Db,
  actorId: string,
  input: { name: string; slug?: string; shopName?: string; ownerEmail: string; ownerName?: string; locale?: Locale3 },
  opts: { webUrl: string; emailed: boolean; now?: number },
): BusinessCreated {
  const now = opts.now ?? Date.now();
  const slug = input.slug ?? suggestSlug(db, input.name);
  if (!SLUG.test(slug)) throw badRequest('slug', { slug: 'invalid' });
  if (platform(db).get('SELECT 1 FROM organizations WHERE slug = @s', { s: slug })) throw new ApiProblem(409, 'conflict', 'slug taken', { slug: 'taken' });
  let created: { orgId: string; inviteUrl: string | null };
  try {
    created = bootstrapBusiness(db, {
      name: input.name, slug, ownerEmail: input.ownerEmail, ownerName: input.ownerName, shopName: input.shopName ?? input.name,
      locale: input.locale ?? 'el', webUrl: opts.webUrl, now,
    });
  } catch (e) {
    if (e instanceof BootstrapError) throw badRequest(e.message);
    throw e;
  }
  const invite = new Tenant(db, created.orgId).get<{ id: string }>('SELECT id FROM invites WHERE org_id = @org ORDER BY created_at DESC LIMIT 1')!;
  // the bootstrap service returns the url with the token, the only place it exists in clear
  const link = created.inviteUrl ?? '';
  platformAudit(db, actorId, 'business.created', { orgId: created.orgId, entity: { type: 'org', id: created.orgId }, after: { name: input.name, slug, owner: input.ownerEmail } }, now);
  return { orgId: created.orgId, slug, inviteId: invite.id, link, emailed: opts.emailed };
}

function issueOwnerInvite(db: Db, orgId: string, email: string, locale: Locale3, webUrl: string, now: number): { id: string; url: string } {
  try {
    return bootstrapInviteOwner(db, orgId, email, locale, webUrl, now);
  } catch (e) {
    if (e instanceof BootstrapError) throw notFound(e.message);
    throw e;
  }
}

export function inviteOwnerFor(db: Db, actorId: string, orgId: string, input: { email: string; locale?: Locale3 }, opts: { webUrl: string; emailed: boolean; now?: number }) {
  const now = opts.now ?? Date.now();
  orgRowById(db, orgId);
  const r = issueOwnerInvite(db, orgId, input.email, input.locale ?? 'el', opts.webUrl, now);
  platformAudit(db, actorId, 'owner.invited', { orgId, entity: { type: 'invite', id: r.id }, after: { email: input.email.toLowerCase() } }, now);
  return { id: r.id, link: r.url, emailed: opts.emailed };
}

function openOwnerInvite(db: Db, orgId: string, inviteId: string) {
  const role = ownerRoleId(db, orgId);
  const inv = role
    ? new Tenant(db, orgId).get<{ id: string; email: string; locale: string | null }>(
        'SELECT id, email, locale FROM invites WHERE org_id = @org AND id = @id AND role_id = @r AND accepted_at IS NULL AND revoked_at IS NULL',
        { id: inviteId, r: role },
      )
    : undefined;
  if (!inv) throw notFound('invite');
  return inv;
}

export function resendOwnerInvite(db: Db, actorId: string, orgId: string, inviteId: string, opts: { webUrl: string; emailed: boolean; now?: number }) {
  const now = opts.now ?? Date.now();
  const inv = openOwnerInvite(db, orgId, inviteId);
  // a new link for the same address, the old one stops working (bootstrap revokes it)
  const r = issueOwnerInvite(db, orgId, inv.email, pickLocale(inv.locale ?? undefined) as Locale3, opts.webUrl, now);
  platformAudit(db, actorId, 'owner.invite_resent', { orgId, entity: { type: 'invite', id: r.id }, before: { inviteId }, after: { email: inv.email } }, now);
  return { id: r.id, link: r.url, emailed: opts.emailed };
}

export function revokeOwnerInvite(db: Db, actorId: string, orgId: string, inviteId: string, now = Date.now()) {
  const inv = openOwnerInvite(db, orgId, inviteId);
  new Tenant(db, orgId).run('UPDATE invites SET revoked_at = @now WHERE org_id = @org AND id = @id', { now, id: inv.id });
  platformAudit(db, actorId, 'owner.invite_revoked', { orgId, entity: { type: 'invite', id: inv.id }, before: { email: inv.email } }, now);
}

// ---------------------------------------------------------------- controls and switches

export function setOrgControls(db: Db, actorId: string, orgId: string, patch: OrgControlsPatch, now = Date.now()): OrgControls {
  const before = orgControls(db, orgId);
  const sets: string[] = [];
  const params: Record<string, unknown> = { id: orgId, now };
  if (patch.status !== undefined && patch.status !== before.status) {
    sets.push('status = @status', 'status_changed_at = @now');
    params.status = patch.status;
  }
  if (patch.disabledFeatures !== undefined) {
    sets.push('disabled_features = @df');
    params.df = JSON.stringify(FEATURES.filter((f) => patch.disabledFeatures!.includes(f as Feature)));
  }
  if (patch.maxShops !== undefined) {
    sets.push('max_shops = @ms');
    params.ms = patch.maxShops;
  }
  if (patch.maxStaff !== undefined) {
    sets.push('max_staff = @mst');
    params.mst = patch.maxStaff;
  }
  if (!sets.length) return before;
  db.transaction(() => {
    platform(db).run(`UPDATE organizations SET ${sets.join(', ')} WHERE id = @id`, params);
    // the business's apps refetch their context and hide or show screens
    platform(db).run('UPDATE memberships SET perms_version = perms_version + 1 WHERE org_id = @id', { id: orgId });
  })();
  const after = orgControls(db, orgId);
  const pick = (c: OrgControls) => ({ status: c.status, disabledFeatures: c.disabledFeatures, maxShops: c.maxShops, maxStaff: c.maxStaff });
  platformAudit(db, actorId, 'business.controls_changed', { orgId, entity: { type: 'org', id: orgId }, before: pick(before), after: pick(after) }, now);
  return after;
}

export function setPlatformSettings(db: Db, actorId: string, patch: PlatformSettingsPatch, now = Date.now()): PlatformSettings {
  const before = platformSettings(db);
  db.transaction(() => {
    for (const [key, on] of Object.entries(patch)) {
      if (on === undefined) continue;
      platform(db).run(
        `INSERT INTO platform_settings (key, value, updated_by, updated_at) VALUES (@k, @v, @u, @now)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
        { k: key, v: on ? '1' : '0', u: actorId, now },
      );
    }
  })();
  const after = platformSettings(db);
  platformAudit(db, actorId, 'platform.settings_changed', { before, after }, now);
  return after;
}

export function auditPage(db: Db, offset: number, limit: number): { items: PlatformAuditEntry[]; nextCursor: string | null } {
  const rows = platform(db).all<{ id: string; action: string; actor_name: string | null; org_id: string | null; org_name: string | null; details_json: string | null; created_at: number }>(
    `SELECT a.id, a.action, coalesce(u.display_name, u.email) AS actor_name, a.org_id, o.name AS org_name, a.details_json, a.created_at
       FROM platform_audit a LEFT JOIN users u ON u.id = a.actor_id LEFT JOIN organizations o ON o.id = a.org_id
      ORDER BY a.created_at DESC, a.id DESC LIMIT @lim OFFSET @off`,
    { lim: limit + 1, off: offset },
  );
  const items = rows.slice(0, limit).map((r) => ({
    id: r.id, action: r.action, actorName: r.actor_name, orgId: r.org_id, orgName: r.org_name, details: parseJson<unknown>(r.details_json, null), createdAt: r.created_at,
  }));
  return { items, nextCursor: rows.length > limit ? encodeCursor(offset + limit) : null };
}

// ---------------------------------------------------------------- super admins

export function superAdmins(db: Db, viewerId: string, now = Date.now()): SuperAdmins {
  const p = platform(db);
  return {
    admins: p
      .all<{ id: string; name: string | null; email: string | null }>(
        "SELECT id, display_name AS name, email FROM users WHERE platform_role = 'superadmin' AND deleted_at IS NULL ORDER BY created_at",
      )
      .map((u) => ({ userId: u.id, name: u.name, email: u.email, you: u.id === viewerId })),
    invites: p
      .all<{ id: string; email: string; created_at: number; expires_at: number }>(
        'SELECT id, email, created_at, expires_at FROM platform_invites WHERE accepted_at IS NULL AND revoked_at IS NULL ORDER BY created_at DESC',
      )
      .map((r) => ({ id: r.id, email: r.email, createdAt: r.created_at, expiresAt: r.expires_at, expired: r.expires_at < now })),
  };
}

export function superAdminInviteLink(webUrl: string, token: string): string {
  return `${webUrl.replace(/\/$/, '')}/platform-invite/${token}`;
}

export function inviteSuperAdmin(
  db: Db,
  actorId: string,
  input: { email: string; locale?: Locale3 },
  opts: { webUrl: string; emailed: boolean; now?: number },
): { id: string; link: string; emailed: boolean } {
  const now = opts.now ?? Date.now();
  const p = platform(db);
  const email = input.email.trim().toLowerCase();
  if (p.get("SELECT 1 FROM users WHERE email = @e AND deleted_at IS NULL AND platform_role = 'superadmin'", { e: email })) {
    throw new ApiProblem(409, 'conflict', 'already a super admin');
  }
  const inviter = p.get<{ name: string | null; email: string | null; locale: string }>('SELECT display_name AS name, email, locale FROM users WHERE id = @id', { id: actorId });
  const locale = input.locale ?? (pickLocale(inviter?.locale) as Locale3);
  const token = randomToken();
  const id = uuidv7(now);
  const link = superAdminInviteLink(opts.webUrl, token);
  db.transaction(() => {
    // one open invite per address: an older one stops working
    p.run('UPDATE platform_invites SET revoked_at = @now WHERE email = @e AND accepted_at IS NULL AND revoked_at IS NULL', { now, e: email });
    p.run(
      `INSERT INTO platform_invites (id, email, token_hash, locale, invited_by, created_at, expires_at)
       VALUES (@id, @e, @h, @l, @by, @now, @exp)`,
      { id, e: email, h: sha256(token), l: locale, by: actorId, now, exp: now + PLATFORM_INVITE_TTL },
    );
    devOutboxTransport(db, () => {}).send(
      emailMessage(superadminInviteEmail(locale, { inviter: inviter?.name ?? inviter?.email ?? 'Custock', url: link }), { to: email, locale, payload: { type: 'platform_invite', inviteId: id } }),
    );
    platformAudit(db, actorId, 'superadmin.invited', { entity: { type: 'platform_invite', id }, after: { email } }, now);
  })();
  return { id, link, emailed: opts.emailed };
}

function openPlatformInviteById(db: Db, id: string) {
  const inv = platform(db).get<{ id: string; email: string; locale: string }>(
    'SELECT id, email, locale FROM platform_invites WHERE id = @id AND accepted_at IS NULL AND revoked_at IS NULL',
    { id },
  );
  if (!inv) throw notFound('invite');
  return inv;
}

export function resendSuperAdminInvite(db: Db, actorId: string, inviteId: string, opts: { webUrl: string; emailed: boolean; now?: number }) {
  const inv = openPlatformInviteById(db, inviteId);
  return inviteSuperAdmin(db, actorId, { email: inv.email, locale: pickLocale(inv.locale) as Locale3 }, opts);
}

export function revokeSuperAdminInvite(db: Db, actorId: string, inviteId: string, now = Date.now()) {
  const inv = openPlatformInviteById(db, inviteId);
  platform(db).run('UPDATE platform_invites SET revoked_at = @now WHERE id = @id', { now, id: inv.id });
  platformAudit(db, actorId, 'superadmin.invite_revoked', { entity: { type: 'platform_invite', id: inv.id }, before: { email: inv.email } }, now);
}

export function superAdminCount(db: Db): number {
  return platform(db).get<{ n: number }>("SELECT count(*) AS n FROM users WHERE platform_role = 'superadmin' AND deleted_at IS NULL")!.n;
}

export function removeSuperAdmin(db: Db, actorId: string | null, userId: string, now = Date.now()) {
  if (actorId && actorId === userId) throw new ApiProblem(403, 'self', 'a super admin cannot remove himself');
  const p = platform(db);
  const target = p.get<{ email: string | null }>("SELECT email FROM users WHERE id = @id AND platform_role = 'superadmin' AND deleted_at IS NULL", { id: userId });
  if (!target) throw notFound('super admin');
  if (superAdminCount(db) <= 1) throw new ApiProblem(409, 'last_superadmin', 'the last super admin stays');
  p.run('UPDATE users SET platform_role = NULL, updated_at = @now WHERE id = @id', { now, id: userId });
  platformAudit(db, actorId, 'superadmin.removed', { entity: { type: 'user', id: userId }, before: { email: target.email, role: 'superadmin' }, after: { role: null } }, now);
}

export function grantSuperAdmin(db: Db, actorId: string | null, userId: string, action: string, now = Date.now()) {
  const p = platform(db);
  const u = p.get<{ email: string | null; role: string | null }>('SELECT email, platform_role AS role FROM users WHERE id = @id AND deleted_at IS NULL', { id: userId });
  if (!u) throw notFound('user');
  if (u.role === 'superadmin') return;
  p.run("UPDATE users SET platform_role = 'superadmin', updated_at = @now WHERE id = @id", { now, id: userId });
  platformAudit(db, actorId, action, { entity: { type: 'user', id: userId }, before: { role: null }, after: { email: u.email, role: 'superadmin' } }, now);
}

export interface OpenPlatformInvite { id: string; email: string; locale: string; invited_by: string | null; expires_at: number }

// an invite that can still be used, or 410
export function openPlatformInvite(db: Db, token: string, now: number): OpenPlatformInvite {
  const inv = platform(db).get<OpenPlatformInvite & { accepted_at: number | null; revoked_at: number | null }>(
    'SELECT id, email, locale, invited_by, expires_at, accepted_at, revoked_at FROM platform_invites WHERE token_hash = @h',
    { h: sha256(token) },
  );
  if (!inv || inv.revoked_at || inv.accepted_at || inv.expires_at < now) throw new ApiProblem(410, 'invite_expired');
  return inv;
}

export function claimPlatformInvite(db: Db, inv: OpenPlatformInvite, userId: string, now: number) {
  db.transaction(() => {
    const r = platform(db).run(
      'UPDATE platform_invites SET accepted_at = @now, accepted_by = @u WHERE id = @id AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at >= @now',
      { now, u: userId, id: inv.id },
    );
    if (!r.changes) throw new ApiProblem(410, 'invite_expired');
    grantSuperAdmin(db, inv.invited_by, userId, 'superadmin.invite_accepted', now);
  })();
}

// ---------------------------------------------------------------- deleting an empty business

const KEEPS_DATA = [
  ['products', 'SELECT count(*) AS n FROM products WHERE org_id = @org'],
  ['customers', 'SELECT count(*) AS n FROM customers WHERE org_id = @org'],
  ['posts', 'SELECT count(*) AS n FROM posts WHERE org_id = @org'],
  ['stock movements', 'SELECT count(*) AS n FROM stock_movements WHERE org_id = @org'],
] as const;

// only a business with nothing real in it: its shops, roles, members, join links and invites go
// with it. anything with products, customers, posts or stock history is refused with what is in it.
export function deleteEmptyBusiness(db: Db, orgId: string, actorId: string | null = null, now = Date.now()): { removedRows: number } {
  const t = new Tenant(db, orgId);
  const found = KEEPS_DATA.map(([label, sql]) => [label, t.get<{ n: number }>(sql)!.n] as const).filter(([, n]) => n > 0);
  if (found.length) throw new BootstrapError(`not empty, it has ${found.map(([l, n]) => `${n} ${l}`).join(', ')}`);
  const tables = platform(db)
    .all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_fts%' AND name != 'organizations'")
    .map((r) => r.name)
    .filter((name) => db.prepare(`PRAGMA table_info(${JSON.stringify(name)})`).all().some((c) => (c as { name: string }).name === 'org_id'));
  const org = platform(db).get<{ name: string; slug: string }>('SELECT name, slug FROM organizations WHERE id = @id', { id: orgId });
  if (!org) throw new BootstrapError('no such business');
  let removed = 0;
  db.pragma('defer_foreign_keys = ON');
  db.transaction(() => {
    db.pragma('defer_foreign_keys = ON');
    removed += db.prepare('DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE org_id = ?)').run(orgId).changes;
    for (const name of tables) {
      if (name === 'platform_audit') continue;
      removed += db.prepare(`DELETE FROM ${JSON.stringify(name)} WHERE org_id = ?`).run(orgId).changes;
    }
    removed += db.prepare('DELETE FROM organizations WHERE id = ?').run(orgId).changes;
    platformAudit(db, actorId, 'business.deleted', { orgId, entity: { type: 'org', id: orgId }, before: { name: org.name, slug: org.slug } }, now);
  })();
  return { removedRows: removed };
}

// ---------------------------------------------------------------- deleting a business with everything in it

export interface DeletedBusiness {
  name: string;
  slug: string;
  rows: Record<string, number>;
  accountsClosed: number;
  objects: number;
}

// a whole business and everything in it: every row of the org, its photos in the bucket (best
// effort, after the database is done) and the accounts of people who were only there. a super admin
// keeps his account. the platform audit keeps one row with the counts.
export async function deleteBusinessEverything(
  db: Db,
  orgId: string,
  actorId: string | null,
  opts: { removeObject?: (key: string) => Promise<void>; log?: (line: string) => void; now?: number } = {},
): Promise<DeletedBusiness> {
  const now = opts.now ?? Date.now();
  const p = platform(db);
  const org = p.get<{ name: string; slug: string }>('SELECT name, slug FROM organizations WHERE id = @id', { id: orgId });
  if (!org) throw notFound('organization');

  // people whose only link to custock is this business: no membership and no customer record
  // anywhere else, and not a super admin
  const accounts = p.all<{ id: string }>(
    `SELECT u.id FROM users u
      WHERE u.deleted_at IS NULL AND u.platform_role IS NULL
        AND (EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = u.id AND m.org_id = @o)
             OR EXISTS (SELECT 1 FROM customers c WHERE c.user_id = u.id AND c.org_id = @o))
        AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = u.id AND m.org_id != @o)
        AND NOT EXISTS (SELECT 1 FROM customers c WHERE c.user_id = u.id AND c.org_id != @o)`,
    { o: orgId },
  ).map((r) => r.id);
  // photos of the business, and the profile photos of the accounts that close
  const keys = p.all<{ storage_key: string }>(
    `SELECT storage_key FROM files WHERE storage_key NOT LIKE 'http%' AND deleted_at IS NULL
        AND (org_id = @o OR id IN (SELECT avatar_file_id FROM users WHERE id IN (SELECT value FROM json_each(@u))))`,
    { o: orgId, u: accounts },
  ).map((r) => r.storage_key);

  const tables = p
    .all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_fts%' AND name NOT IN ('organizations', 'platform_audit')")
    .map((r) => r.name)
    .filter((name) => db.prepare(`PRAGMA table_info(${JSON.stringify(name)})`).all().some((c) => (c as { name: string }).name === 'org_id'));

  const rows: Record<string, number> = {};
  const count = (name: string, n: number) => { if (n) rows[name] = (rows[name] ?? 0) + n; };
  db.transaction(() => {
    db.pragma('defer_foreign_keys = ON');
    // rows that hang off the business through a parent rather than an org_id of their own
    count('role_permissions', db.prepare('DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE org_id = ?)').run(orgId).changes);
    count('product_translations', db.prepare('DELETE FROM product_translations WHERE product_id IN (SELECT id FROM products WHERE org_id = ?)').run(orgId).changes);
    count('category_translations', db.prepare('DELETE FROM category_translations WHERE category_id IN (SELECT id FROM categories WHERE org_id = ?)').run(orgId).changes);
    for (const t of ['post_translations', 'post_products', 'post_media']) {
      count(t, db.prepare(`DELETE FROM ${t} WHERE post_id IN (SELECT id FROM posts WHERE org_id = ?)`).run(orgId).changes);
    }
    count('jobs', db.prepare('DELETE FROM jobs WHERE payload LIKE ?').run(`%${orgId}%`).changes);
    // the ledger is append only for everyone else: its guard steps aside inside this transaction only
    const guards = p.all<{ name: string; sql: string }>(
      "SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND upper(sql) LIKE '%BEFORE DELETE%' AND upper(sql) LIKE '%RAISE(%'",
    );
    for (const g of guards) db.exec(`DROP TRIGGER ${JSON.stringify(g.name)}`);
    for (const name of tables) count(name, db.prepare(`DELETE FROM ${JSON.stringify(name)} WHERE org_id = ?`).run(orgId).changes);
    for (const g of guards) db.exec(g.sql);
    count('organizations', db.prepare('DELETE FROM organizations WHERE id = ?').run(orgId).changes);
    // the accounts of people who were only here: signed out everywhere and emptied
    const ids = JSON.stringify(accounts);
    for (const t of ['sessions', 'devices', 'push_subscriptions', 'email_changes', 'password_resets']) {
      count(t, db.prepare(`DELETE FROM ${t} WHERE user_id IN (SELECT value FROM json_each(?))`).run(ids).changes);
    }
    db.prepare('UPDATE files SET deleted_at = ? WHERE deleted_at IS NULL AND id IN (SELECT avatar_file_id FROM users WHERE id IN (SELECT value FROM json_each(?)))').run(now, ids);
    db.prepare(
      `UPDATE users SET email = NULL, phone = NULL, display_name = NULL, password_hash = NULL, avatar_file_id = NULL, deleted_at = ?, updated_at = ?
        WHERE id IN (SELECT value FROM json_each(?))`,
    ).run(now, now, ids);
    platformAudit(db, actorId, 'business.deleted', {
      orgId, entity: { type: 'org', id: orgId },
      before: { name: org.name, slug: org.slug }, after: { rows, accountsClosed: accounts.length, objects: keys.length },
    }, now);
  })();

  // the photos go after the database, a failed one is only logged
  let removed = 0;
  for (const k of keys) {
    try {
      await opts.removeObject?.(k);
      removed++;
    } catch (e) {
      opts.log?.(`could not remove ${k}: ${String(e)}`);
    }
  }
  opts.log?.(`deleted ${org.name} (${org.slug}): ${Object.values(rows).reduce((a, b) => a + b, 0)} rows, ${accounts.length} accounts closed, ${removed} of ${keys.length} photos removed`);
  return { name: org.name, slug: org.slug, rows, accountsClosed: accounts.length, objects: keys.length };
}

export { OWNER_INVITE_TTL };
