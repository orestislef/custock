// customers and the people side: staff adding customers, notes, tags, erase, join links,
// the public join with double opt in, unsubscribe links, the customer app writes, my data
//
// consent rule: nothing about an existing customer changes until that customer clicks. a join page
// or a staff member only ever creates a pending request held with the confirmation token.

import type { Context, Hono } from 'hono';
import { randomInt } from 'node:crypto';
import { z } from 'zod';
import {
  AddCustomerInput, checkOwnersAfter, contactKey, effectiveAtScope, JoinInput, maskEmail, searchKey, uuidv7, type Customer, type JoinLink, type StockAlertItem,
} from '@custock/core';
import { randomToken, sha256, type Db } from '@custock/db';
import { pickLocale, translator } from '@custock/i18n';
import type { AppEnv, Config, OrgRow } from '../types';
import { audit } from '../lib/audit';
import { cfgOf, need, nowOf, orgOf, ORG_COLUMNS, readerLocale, requireAuth } from '../lib/context';
import { idempotent } from '../lib/idempotency';
import { ApiProblem, badRequest, forbidden, notFound } from '../lib/problem';
import { clientIp, throttle } from '../lib/ratelimit';
import { platform, Tenant } from '../lib/tenant';
import { dayKey } from '../lib/time';
import { devOutboxTransport } from '../lib/transport';
import { readUnsubToken, unsubKey } from '../lib/unsub';
import { shopNameOf } from '../services/ledger';
import { canSee, customerVisibility, loadSubscriptions, loadTags, reachedShops, toCustomer, CUSTOMER_COLUMNS, type CustomerRow } from '../services/customers';
import { fileUrl } from '../services/catalog';
import { storefrontProducts } from '../services/storefront';
import { followingOf } from './customer';

const CONFIRM_TTL = 7 * 86_400_000;
const CODE_TTL = 15 * 60_000;
const TEXT_VERSION = (locale: string) => `${locale}-2026-11`;

export const DEV_TURNSTILE_TOKEN = 'dev-turnstile-ok';

// the bot check. dev accepts no token or the dev token. outside dev it needs the real secret and
// asks cloudflare, and without a secret every public signup is refused.
export async function verifyTurnstile(cfg: Config, token: string | undefined, ip: string): Promise<boolean> {
  if (cfg.dev) return token === undefined || token === DEV_TURNSTILE_TOKEN;
  if (!cfg.turnstileSecret || !token) return false;
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: new URLSearchParams({ secret: cfg.turnstileSecret, response: token, remoteip: ip }),
    });
    return ((await res.json()) as { success?: boolean }).success === true;
  } catch {
    return false;
  }
}

function bumpStat(t: Tenant, linkId: string | null, column: 'signups' | 'confirmed', tz: string, now: number) {
  if (!linkId) return;
  t.run(
    `INSERT INTO join_link_stats_daily (org_id, join_link_id, day, ${column}) VALUES (@org, @l, @d, 1)
     ON CONFLICT (join_link_id, day) DO UPDATE SET ${column} = ${column} + 1`,
    { l: linkId, d: dayKey(now, tz) },
  );
}

function scopeLabel(t: Tenant, org: OrgRow, scopeType: string, scopeId: string): string {
  if (scopeType === 'shop') return `${org.name} ${shopNameOf(t, scopeId)}`.trim();
  if (scopeType === 'group') return `${org.name} ${t.get<{ name: string }>('SELECT name FROM shop_groups WHERE org_id = @org AND id = @id', { id: scopeId })?.name ?? ''}`.trim();
  return org.name;
}

function scopeExists(t: Tenant, scopeType: string, scopeId: string): boolean {
  if (scopeType === 'org') return scopeId === t.orgId;
  const table = scopeType === 'shop' ? 'shops' : 'shop_groups';
  return !!t.get(`SELECT 1 FROM ${table} WHERE org_id = @org AND id = @id AND archived_at IS NULL`, { id: scopeId });
}

function findCustomer(t: Tenant, email: string | null, phone: string | null): { id: string } | undefined {
  if (email) {
    const hit = t.get<{ id: string }>('SELECT id FROM customers WHERE org_id = @org AND email = @e AND erased_at IS NULL', { e: email });
    if (hit) return hit;
  }
  if (phone) return t.get<{ id: string }>('SELECT id FROM customers WHERE org_id = @org AND phone = @p AND erased_at IS NULL', { p: phone });
  return undefined;
}

function createCustomer(
  t: Tenant,
  a: { now: number; name: string; email: string | null; phone: string | null; locale: 'en' | 'el' | 'ru'; source: 'join_link' | 'app' | 'staff' | 'import'; joinLinkId: string | null; userId?: string | null; verified?: boolean },
): string {
  const id = uuidv7(a.now);
  t.run(
    `INSERT INTO customers (id, org_id, user_id, name, email, email_verified_at, phone, locale, source, join_link_id, search_key, contact_key, created_at, updated_at)
     VALUES (@id, @org, @u, @name, @email, @verified, @phone, @locale, @source, @link, @key, @contact, @now, @now)`,
    {
      id, u: a.userId ?? null, name: a.name, email: a.email, verified: a.verified ? a.now : null, phone: a.phone, locale: a.locale,
      source: a.source, link: a.joinLinkId, key: searchKey(a.name), contact: contactKey(a.email, a.phone), now: a.now,
    },
  );
  return id;
}

function setSubscription(t: Tenant, customerId: string, scopeType: string, scopeId: string, status: 'pending' | 'subscribed' | 'unsubscribed', now: number, source: string | null, linkId: string | null) {
  t.run(
    `INSERT INTO customer_subscriptions (id, org_id, customer_id, scope_type, scope_id, status, source, join_link_id, created_at, updated_at)
     VALUES (@id, @org, @c, @st, @sid, @status, @source, @link, @now, @now)
     ON CONFLICT (customer_id, scope_type, scope_id) DO UPDATE SET status = @status, updated_at = @now`,
    { id: uuidv7(now), c: customerId, st: scopeType, sid: scopeId, status, source, link: linkId, now },
  );
}

// a pending row only where there is no row yet. existing choices stay as they are.
function addPendingSubscription(t: Tenant, customerId: string, scopeType: string, scopeId: string, now: number, source: string, linkId: string | null) {
  t.run(
    `INSERT OR IGNORE INTO customer_subscriptions (id, org_id, customer_id, scope_type, scope_id, status, source, join_link_id, created_at, updated_at)
     VALUES (@id, @org, @c, @st, @sid, 'pending', @source, @link, @now, @now)`,
    { id: uuidv7(now), c: customerId, st: scopeType, sid: scopeId, source, link: linkId, now },
  );
}

// the consent ledger plus the cached flags. email counts only with a confirmed address,
// push only with an app on a device.
function consent(t: Tenant, customerId: string, channel: 'email' | 'push' | 'sms', granted: boolean, locale: string, source: string, now: number, ip: string | null = null, ua: string | null = null) {
  t.run(
    `INSERT INTO consents (id, org_id, customer_id, channel, granted, text_version, source, ip, user_agent, created_at)
     VALUES (@id, @org, @c, @ch, @g, @v, @s, @ip, @ua, @now)`,
    { id: uuidv7(now), c: customerId, ch: channel, g: granted, v: TEXT_VERSION(locale), s: source, ip, ua, now },
  );
  if (channel === 'email') {
    t.run('UPDATE customers SET email_ok = CASE WHEN @g = 1 AND email_verified_at IS NOT NULL THEN 1 ELSE 0 END, updated_at = @now WHERE org_id = @org AND id = @c', { g: granted, now, c: customerId });
  } else if (channel === 'push') {
    t.run(
      `UPDATE customers SET push_ok = CASE WHEN @g = 1 AND user_id IS NOT NULL AND EXISTS (
         SELECT 1 FROM devices d WHERE d.user_id = customers.user_id AND d.revoked_at IS NULL AND d.fcm_token IS NOT NULL) THEN 1 ELSE 0 END,
         updated_at = @now WHERE org_id = @org AND id = @c`,
      { g: granted, now, c: customerId },
    );
  } else {
    t.run('UPDATE customers SET sms_ok = @g, updated_at = @now WHERE org_id = @org AND id = @c', { g: granted, now, c: customerId });
  }
}

interface ConfirmRequest {
  customerId: string;
  linkId: string | null;
  scopeType: string;
  scopeId: string;
  emailNews: boolean;
  push: boolean;
  locale: string;
  source: string;
  ip: string | null;
  ua: string | null;
}

// the request waits with the token. nothing is applied until the link is clicked.
function sendConfirmation(cfg: Config, t: Tenant, org: OrgRow, req: ConfirmRequest, scopeName: string, name: string, email: string, now: number): string {
  const token = randomToken();
  t.run(
    `INSERT INTO join_confirmations (token_hash, org_id, customer_id, join_link_id, created_at, expires_at, scope_type, scope_id, email_news, push, locale, source, ip, user_agent)
     VALUES (@h, @org, @c, @l, @now, @exp, @st, @sid, @news, @push, @locale, @source, @ip, @ua)`,
    {
      h: sha256(token), c: req.customerId, l: req.linkId, now, exp: now + CONFIRM_TTL, st: req.scopeType, sid: req.scopeId,
      news: req.emailNews, push: req.push, locale: req.locale, source: req.source, ip: req.ip, ua: req.ua,
    },
  );
  const url = `${cfg.publicWebUrl.replace(/\/$/, '')}/confirm/${token}`;
  const tr = translator(pickLocale(req.locale), 'server');
  devOutboxTransport(cfg.db).send({
    channel: 'email', orgId: org.id, customerId: req.customerId, to: email, locale: req.locale,
    title: tr('email.joinConfirm.subject', { scope: scopeName }), body: tr('email.joinConfirm.body', { name, scope: scopeName, url }),
    payload: { type: 'join_confirm' },
  });
  return url;
}

export function eraseCustomer(db: Db, t: Tenant, customerId: string, now: number) {
  const before = t.get<{ email: string | null }>('SELECT email FROM customers WHERE org_id = @org AND id = @c', { c: customerId });
  t.run(
    `UPDATE customers SET name = NULL, email = NULL, phone = NULL, birthday = NULL, search_key = NULL, contact_key = NULL, user_id = NULL,
       email_ok = 0, push_ok = 0, sms_ok = 0, erased_at = @now, updated_at = @now WHERE org_id = @org AND id = @c`,
    { now, c: customerId },
  );
  t.run("UPDATE stock_alerts SET status = 'cancelled' WHERE org_id = @org AND customer_id = @c AND status = 'waiting'", { c: customerId });
  t.run('DELETE FROM customer_favorites WHERE org_id = @org AND customer_id = @c', { c: customerId });
  t.run('DELETE FROM customer_tags WHERE org_id = @org AND customer_id = @c', { c: customerId });
  t.run('DELETE FROM customer_interests WHERE org_id = @org AND customer_id = @c', { c: customerId });
  t.run("UPDATE customer_notes SET body = '', deleted_at = @now WHERE org_id = @org AND customer_id = @c", { now, c: customerId });
  t.run("UPDATE customer_subscriptions SET status = 'unsubscribed', updated_at = @now WHERE org_id = @org AND customer_id = @c", { now, c: customerId });
  t.run('UPDATE consents SET ip = NULL, user_agent = NULL WHERE org_id = @org AND customer_id = @c', { c: customerId });
  t.run("UPDATE deliveries SET status = 'skipped', skip_reason = 'erased', updated_at = @now WHERE org_id = @org AND customer_id = @c AND status IN ('queued', 'held')", { now, c: customerId });
  t.run('DELETE FROM join_confirmations WHERE org_id = @org AND customer_id = @c', { c: customerId });
  // copies of messages and codes go too
  const p = platform(db);
  p.run('DELETE FROM dev_outbox WHERE customer_id = @c', { c: customerId });
  if (before?.email) {
    p.run('DELETE FROM dev_outbox WHERE to_address = @e AND org_id = @o', { e: before.email, o: t.orgId });
    const stillUsed = p.get('SELECT 1 FROM customers WHERE email = @e AND erased_at IS NULL', { e: before.email }) || p.get('SELECT 1 FROM users WHERE email = @e AND deleted_at IS NULL', { e: before.email });
    if (!stillUsed) p.run('DELETE FROM otp_codes WHERE email = @e', { e: before.email });
  }
}

function orgBy(db: Db, id: string): OrgRow {
  return platform(db).get<OrgRow>(`SELECT ${ORG_COLUMNS} FROM organizations WHERE id = @id`, { id })!;
}

function joinLinkView(c: Context<AppEnv>, id: string): JoinLink {
  const { t } = orgOf(c);
  const r = t.get<{ id: string; code: string; scope_type: 'org' | 'group' | 'shop'; scope_id: string; label: string | null; disabled_at: number | null; expires_at: number | null; opens: number | null; signups: number | null; confirmed: number | null }>(
    `SELECT j.id, j.code, j.scope_type, j.scope_id, j.label, j.disabled_at, j.expires_at, sum(s.opens) AS opens, sum(s.signups) AS signups, sum(s.confirmed) AS confirmed
       FROM join_links j LEFT JOIN join_link_stats_daily s ON s.join_link_id = j.id WHERE j.org_id = @org AND j.id = @id GROUP BY j.id`,
    { id },
  );
  if (!r) throw notFound('join link');
  return {
    id: r.id, code: r.code, scopeType: r.scope_type, scopeId: r.scope_id, label: r.label, url: `${cfgOf(c).publicWebUrl.replace(/\/$/, '')}/j/${r.code}`,
    opens: r.opens ?? 0, signups: r.signups ?? 0, confirmed: r.confirmed ?? 0, disabled: !!r.disabled_at || (r.expires_at != null && r.expires_at < nowOf(c)),
  };
}

// a customer the caller can see, or not found
function visibleCustomer(c: Context<AppEnv>, id: string) {
  const { t } = orgOf(c);
  if (!t.get('SELECT 1 FROM customers WHERE org_id = @org AND id = @id AND erased_at IS NULL', { id })) throw notFound('customer');
  const subs = loadSubscriptions(c, [id]).get(id) ?? [];
  if (!canSee(customerVisibility(c), reachedShops(c, subs))) throw notFound('customer');
}

export function peopleWriteRoutes(app: Hono<AppEnv>) {
  // ------------------------------------------------------------ staff side

  // a new person at the counter. someone already known is a 409 with no data: staff cannot reach
  // or change customers of other shops this way.
  app.post('/v1/orgs/:org/customers', async (c) => {
    const input = AddCustomerInput.parse(await c.req.json());
    need(c, 'customers.add', input.shopId);
    if (!input.email && !input.phone) throw badRequest('email or phone', { email: 'required' });
    return idempotent(c, () => {
      const { t, org } = orgOf(c);
      const cfg = cfgOf(c);
      const now = nowOf(c);
      const email = input.email?.trim().toLowerCase() ?? null;
      const phone = input.phone?.trim() ?? null;
      if (findCustomer(t, email, phone)) throw new ApiProblem(409, 'conflict', 'already a customer');
      let confirmUrl: string | null = null;
      const id = cfg.db.transaction(() => {
        const cid = createCustomer(t, { now, name: input.name, email, phone, locale: input.locale, source: 'staff', joinLinkId: null });
        if (email) {
          addPendingSubscription(t, cid, 'shop', input.shopId, now, 'staff', null);
          confirmUrl = sendConfirmation(cfg, t, org, { customerId: cid, linkId: null, scopeType: 'shop', scopeId: input.shopId, emailNews: input.emailNews, push: input.push, locale: input.locale, source: 'staff', ip: null, ua: null }, scopeLabel(t, org, 'shop', input.shopId), input.name, email, now);
        } else {
          // phone only: agreed in person, no channel until they opt in themselves
          setSubscription(t, cid, 'shop', input.shopId, 'subscribed', now, 'staff', null);
        }
        for (const tag of input.tags) t.run('INSERT OR IGNORE INTO customer_tags (org_id, customer_id, tag, created_at) VALUES (@org, @c, @tag, @now)', { c: cid, tag, now });
        audit(t, { id: c.get('user').id }, 'customer.added', { type: 'customer', id: cid }, null, { shopId: input.shopId }, now);
        return cid;
      })();
      const row = t.get<CustomerRow>(`SELECT ${CUSTOMER_COLUMNS} FROM customers WHERE org_id = @org AND id = @id`, { id })!;
      const subs = loadSubscriptions(c, [id]).get(id) ?? [];
      const customer: Customer & { devConfirmLink?: string } = toCustomer(row, subs, loadTags(c, [id]).get(id) ?? [], customerVisibility(c), reachedShops(c, subs));
      if (cfg.dev && confirmUrl) customer.devConfirmLink = confirmUrl;
      return { status: 201, body: customer };
    });
  });

  app.post('/v1/orgs/:org/customers/:id/notes', async (c) => {
    need(c, 'customers.edit');
    const { body } = z.object({ body: z.string().min(1).max(2000) }).parse(await c.req.json());
    visibleCustomer(c, c.req.param('id'));
    const { t } = orgOf(c);
    t.run('INSERT INTO customer_notes (id, org_id, customer_id, body, author_id, created_at) VALUES (@id, @org, @c, @b, @u, @now)', { id: uuidv7(nowOf(c)), c: c.req.param('id'), b: body, u: c.get('user').id, now: nowOf(c) });
    return c.body(null, 204);
  });

  app.put('/v1/orgs/:org/customers/:id/tags', async (c) => {
    need(c, 'customers.edit');
    const { tags } = z.object({ tags: z.array(z.string().min(1).max(40)).max(30) }).parse(await c.req.json());
    const id = c.req.param('id');
    visibleCustomer(c, id);
    const { t } = orgOf(c);
    cfgOf(c).db.transaction(() => {
      t.run('DELETE FROM customer_tags WHERE org_id = @org AND customer_id = @c', { c: id });
      for (const tag of new Set(tags.map((x) => x.trim()))) t.run('INSERT INTO customer_tags (org_id, customer_id, tag, created_at) VALUES (@org, @c, @tag, @now)', { c: id, tag, now: nowOf(c) });
    })();
    return c.body(null, 204);
  });

  app.post('/v1/orgs/:org/customers/:id/erase', (c) => {
    need(c, 'customers.erase');
    const { t } = orgOf(c);
    const id = c.req.param('id');
    if (!t.get('SELECT 1 FROM customers WHERE org_id = @org AND id = @id AND erased_at IS NULL', { id })) throw notFound('customer');
    const now = nowOf(c);
    cfgOf(c).db.transaction(() => {
      eraseCustomer(cfgOf(c).db, t, id, now);
      audit(t, { id: c.get('user').id }, 'customer.erased', { type: 'customer', id }, null, null, now);
    })();
    return c.body(null, 204);
  });

  app.post('/v1/orgs/:org/join-links', async (c) => {
    const input = z.object({ scopeType: z.enum(['org', 'group', 'shop']), scopeId: z.string().max(64), label: z.string().max(80).optional() }).parse(await c.req.json());
    const { assignments, topology, t } = orgOf(c);
    if (!scopeExists(t, input.scopeType, input.scopeId)) throw notFound('scope');
    if (!effectiveAtScope(assignments, topology, input).perms.has('joinlinks.manage')) throw forbidden('joinlinks.manage', 'scope');
    return idempotent(c, () => {
      const now = nowOf(c);
      const id = uuidv7(now);
      let code = '';
      do code = randomToken(5).replace(/[-_]/g, '').toLowerCase().slice(0, 6);
      while (code.length < 6 || platform(cfgOf(c).db).get('SELECT 1 FROM join_links WHERE code = @c', { c: code }));
      t.run(
        'INSERT INTO join_links (id, org_id, code, scope_type, scope_id, label, created_by, created_at) VALUES (@id, @org, @code, @st, @sid, @label, @u, @now)',
        { id, code, st: input.scopeType, sid: input.scopeId, label: input.label ?? null, u: c.get('user').id, now },
      );
      return { status: 201, body: joinLinkView(c, id) };
    });
  });

  app.patch('/v1/orgs/:org/join-links/:id', async (c) => {
    const patch = z.object({ label: z.string().max(80).nullable().optional(), disabled: z.boolean().optional() }).parse(await c.req.json());
    const before = joinLinkView(c, c.req.param('id'));
    const { assignments, topology, t } = orgOf(c);
    if (!effectiveAtScope(assignments, topology, before).perms.has('joinlinks.manage')) throw forbidden('joinlinks.manage', 'scope');
    if ('label' in patch) t.run('UPDATE join_links SET label = @l WHERE org_id = @org AND id = @id', { l: patch.label ?? null, id: before.id });
    if (patch.disabled !== undefined) t.run('UPDATE join_links SET disabled_at = CASE WHEN @d THEN coalesce(disabled_at, @now) ELSE NULL END WHERE org_id = @org AND id = @id', { d: patch.disabled, now: nowOf(c), id: before.id });
    return c.json(joinLinkView(c, before.id));
  });

  // ------------------------------------------------------------ public: join, confirm, unsubscribe

  app.post('/v1/public/join/:code', async (c) => {
    const input = JoinInput.parse(await c.req.json());
    const cfg = cfgOf(c);
    const ip = clientIp(c);
    if (!(await verifyTurnstile(cfg, input.turnstileToken, ip))) throw forbidden('bot check failed');
    const link = platform(cfg.db).get<{ id: string; org_id: string; scope_type: string; scope_id: string; disabled_at: number | null; expires_at: number | null; default_tags: string | null }>(
      'SELECT id, org_id, scope_type, scope_id, disabled_at, expires_at, default_tags FROM join_links WHERE code = @code',
      { code: c.req.param('code') },
    );
    if (!link) throw notFound('join link');
    const now = nowOf(c);
    if (link.disabled_at || (link.expires_at != null && link.expires_at < now)) throw new ApiProblem(410, 'join_link_disabled');
    const email = input.email.trim().toLowerCase();
    // one confirmation email per address per hour per business, so the page cannot be used to flood someone
    if (!throttle(cfg.db, `join:${link.org_id}:${email}`, { max: 3, windowMs: 3600_000, now })) throw new ApiProblem(429, 'rate_limited');
    const org = orgBy(cfg.db, link.org_id);
    const t = new Tenant(cfg.db, org.id);
    const url = cfg.db.transaction(() => {
      const known = findCustomer(t, email, null);
      const customerId = known?.id ?? createCustomer(t, { now, name: input.name, email, phone: null, locale: input.locale, source: 'join_link', joinLinkId: link.id });
      addPendingSubscription(t, customerId, link.scope_type, link.scope_id, now, 'join_link', link.id);
      if (!known) {
        for (const cat of input.interests) {
          if (t.get('SELECT 1 FROM categories WHERE org_id = @org AND id = @id', { id: cat })) t.run('INSERT OR IGNORE INTO customer_interests (org_id, customer_id, category_id) VALUES (@org, @c, @cat)', { c: customerId, cat });
        }
        for (const tag of JSON.parse(link.default_tags ?? '[]') as string[]) t.run('INSERT OR IGNORE INTO customer_tags (org_id, customer_id, tag, created_at) VALUES (@org, @c, @tag, @now)', { c: customerId, tag, now });
      }
      bumpStat(t, link.id, 'signups', org.timezone, now);
      return sendConfirmation(
        cfg, t, org,
        { customerId, linkId: link.id, scopeType: link.scope_type, scopeId: link.scope_id, emailNews: input.emailNews, push: input.push, locale: input.locale, source: 'join_page', ip, ua: c.req.header('User-Agent') ?? null },
        scopeLabel(t, org, link.scope_type, link.scope_id), input.name, email, now,
      );
    })();
    return c.json(cfg.dev ? { pending: true, devConfirmLink: url } : { pending: true });
  });

  // double opt in: only what this token asked for is applied, and nothing is ever withdrawn here
  app.post('/v1/public/confirm', async (c) => {
    const { token } = z.object({ token: z.string().min(10).max(200) }).parse(await c.req.json());
    const cfg = cfgOf(c);
    const row = platform(cfg.db).get<{ token_hash: string; org_id: string; customer_id: string; join_link_id: string | null; created_at: number; expires_at: number; confirmed_at: number | null; scope_type: string | null; scope_id: string | null; email_news: number; push: number; locale: string | null; source: string | null; ip: string | null; user_agent: string | null }>(
      'SELECT * FROM join_confirmations WHERE token_hash = @h',
      { h: sha256(token) },
    );
    const now = nowOf(c);
    if (!row || (row.expires_at < now && !row.confirmed_at)) throw new ApiProblem(410, 'invite_expired', 'confirmation link expired');
    const org = orgBy(cfg.db, row.org_id);
    const t = new Tenant(cfg.db, org.id);
    const scopeName = row.scope_type && row.scope_id ? scopeLabel(t, org, row.scope_type, row.scope_id) : org.name;
    cfg.db.transaction(() => {
      const customer = t.get<{ locale: string }>('SELECT locale FROM customers WHERE org_id = @org AND id = @c AND erased_at IS NULL', { c: row.customer_id });
      if (!customer) throw new ApiProblem(410, 'not_found');
      const claimed = t.run('UPDATE join_confirmations SET confirmed_at = @now WHERE token_hash = @h AND org_id = @org AND confirmed_at IS NULL', { now, h: row.token_hash });
      if (!claimed.changes) return;
      const locale = row.locale ?? customer.locale;
      t.run('UPDATE customers SET email_verified_at = coalesce(email_verified_at, @now), updated_at = @now WHERE org_id = @org AND id = @c', { now, c: row.customer_id });
      if (row.scope_type && row.scope_id) setSubscription(t, row.customer_id, row.scope_type, row.scope_id, 'subscribed', now, row.source ?? 'join_page', row.join_link_id);
      if (row.email_news) {
        consent(t, row.customer_id, 'email', true, locale, row.source ?? 'join_page', row.created_at, row.ip, row.user_agent);
        consent(t, row.customer_id, 'email', true, locale, 'double_opt_in', now, clientIp(c), c.req.header('User-Agent') ?? null);
      }
      if (row.push) consent(t, row.customer_id, 'push', true, locale, row.source ?? 'join_page', now, row.ip, row.user_agent);
      bumpStat(t, row.join_link_id, 'confirmed', org.timezone, now);
    })();
    return c.json({ orgName: org.name, scopeName });
  });

  function unsubTarget(c: Context<AppEnv>) {
    const cfg = cfgOf(c);
    const target = readUnsubToken(c.req.param('token') ?? '', unsubKey(cfg));
    if (!target) throw notFound('link');
    const customer = platform(cfg.db).get<{ org_id: string; email: string | null; locale: 'en' | 'el' | 'ru' }>(
      'SELECT org_id, email, locale FROM customers WHERE id = @id AND erased_at IS NULL',
      { id: target.customerId },
    );
    if (!customer) throw notFound('customer');
    return { cfg, target, customer, org: orgBy(cfg.db, customer.org_id) };
  }

  app.get('/v1/public/subscription/:token', (c) => {
    const { target, customer, org, cfg } = unsubTarget(c);
    const t = new Tenant(cfg.db, org.id);
    return c.json({ orgName: org.name, scopeName: scopeLabel(t, org, target.scopeType, target.scopeId), email: maskEmail(customer.email), locale: customer.locale });
  });

  // RFC 8058 one click: any POST stops emails from this business. everything=true also unfollows.
  app.post('/v1/public/subscription/:token', async (c) => {
    const { target, customer, org, cfg } = unsubTarget(c);
    let everything = false;
    try {
      everything = !!((await c.req.json()) as { everything?: boolean }).everything;
    } catch {
      // mail clients post a form body (List-Unsubscribe=One-Click), that is fine
    }
    const t = new Tenant(cfg.db, org.id);
    const now = nowOf(c);
    cfg.db.transaction(() => {
      consent(t, target.customerId, 'email', false, customer.locale, 'unsubscribe_link', now, clientIp(c));
      if (everything) {
        t.run("UPDATE customer_subscriptions SET status = 'unsubscribed', updated_at = @now WHERE org_id = @org AND customer_id = @c", { now, c: target.customerId });
        setSubscription(t, target.customerId, 'org', org.id, 'unsubscribed', now, 'unsubscribe_link', null);
      }
    })();
    return c.body(null, 204);
  });

  // ------------------------------------------------------------ customer app writes

  function customerIn(c: Context<AppEnv>, orgId: string): string {
    const f = followingOf(cfgOf(c).db, c.get('user').id).find((x) => x.org.id === orgId);
    if (!f?.customerIds[0]) throw forbidden('not a customer of this business');
    return f.customerIds[0];
  }

  // the signed in customer joins in one step: their own verified email, their own choices
  app.post('/v1/c/join/:code', requireAuth, async (c) => {
    const body = z.object({ emailNews: z.boolean().default(false), push: z.boolean().default(true) }).parse(await c.req.json().catch(() => ({})));
    const cfg = cfgOf(c);
    const user = c.get('user');
    const link = platform(cfg.db).get<{ id: string; org_id: string; scope_type: string; scope_id: string; disabled_at: number | null; expires_at: number | null }>(
      'SELECT id, org_id, scope_type, scope_id, disabled_at, expires_at FROM join_links WHERE code = @code',
      { code: c.req.param('code') },
    );
    if (!link) throw notFound('join link');
    const now = nowOf(c);
    if (link.disabled_at || (link.expires_at != null && link.expires_at < now)) throw new ApiProblem(410, 'join_link_disabled');
    const verified = platform(cfg.db).get<{ email_verified_at: number | null }>('SELECT email_verified_at FROM users WHERE id = @id', { id: user.id })?.email_verified_at;
    if (!verified || !user.email) throw forbidden('verify your email first');
    const org = orgBy(cfg.db, link.org_id);
    const t = new Tenant(cfg.db, org.id);
    const email = user.email.toLowerCase();
    cfg.db.transaction(() => {
      const known = t.get<{ id: string; user_id: string | null }>('SELECT id, user_id FROM customers WHERE org_id = @org AND email = @e AND erased_at IS NULL', { e: email });
      if (known && known.user_id && known.user_id !== user.id) throw forbidden('email belongs to another account');
      const customerId = known?.id ?? createCustomer(t, { now, name: user.displayName ?? email, email, phone: null, locale: user.locale, source: 'app', joinLinkId: link.id, userId: user.id, verified: true });
      if (known) t.run('UPDATE customers SET user_id = @u, email_verified_at = coalesce(email_verified_at, @now), updated_at = @now WHERE org_id = @org AND id = @id', { u: user.id, now, id: known.id });
      setSubscription(t, customerId, link.scope_type, link.scope_id, 'subscribed', now, 'app', link.id);
      if (body.emailNews) consent(t, customerId, 'email', true, user.locale, 'app', now);
      if (body.push) consent(t, customerId, 'push', true, user.locale, 'app', now);
      bumpStat(t, link.id, 'signups', org.timezone, now);
      bumpStat(t, link.id, 'confirmed', org.timezone, now);
    })();
    return c.json({ orgName: org.name, scopeName: scopeLabel(t, org, link.scope_type, link.scope_id) });
  });

  app.post('/v1/c/follow', requireAuth, async (c) => follow(c, 'subscribed'));
  app.post('/v1/c/unfollow', requireAuth, async (c) => follow(c, 'unsubscribed'));

  async function follow(c: Context<AppEnv>, status: 'subscribed' | 'unsubscribed') {
    const input = z.object({ scopeType: z.enum(['org', 'group', 'shop']), scopeId: z.string().max(64) }).parse(await c.req.json());
    const db = cfgOf(c).db;
    const orgId =
      input.scopeType === 'org'
        ? input.scopeId
        : platform(db).get<{ org_id: string }>(`SELECT org_id FROM ${input.scopeType === 'shop' ? 'shops' : 'shop_groups'} WHERE id = @id`, { id: input.scopeId })?.org_id;
    if (!orgId) throw notFound('scope');
    const customerId = customerIn(c, orgId);
    const t = new Tenant(db, orgId);
    if (!scopeExists(t, input.scopeType, input.scopeId)) throw notFound('scope');
    setSubscription(t, customerId, input.scopeType, input.scopeId, status, nowOf(c), 'app', null);
    return c.body(null, 204);
  }

  app.put('/v1/c/channels', requireAuth, async (c) => {
    const input = z.object({ orgId: z.string().max(64), channel: z.enum(['email', 'push']), on: z.boolean() }).parse(await c.req.json());
    const customerId = customerIn(c, input.orgId);
    const t = new Tenant(cfgOf(c).db, input.orgId);
    consent(t, customerId, input.channel, input.on, c.get('user').locale, 'app', nowOf(c));
    return c.body(null, 204);
  });

  app.post('/v1/c/alerts', requireAuth, async (c) => {
    const input = z.object({ variantId: z.string().max(64), shopId: z.string().max(64).nullable().default(null) }).parse(await c.req.json());
    const db = cfgOf(c).db;
    const v = platform(db).get<{ org_id: string }>('SELECT org_id FROM product_variants WHERE id = @id AND archived_at IS NULL', { id: input.variantId });
    if (!v) throw notFound('product');
    const customerId = customerIn(c, v.org_id);
    const t = new Tenant(db, v.org_id);
    if (input.shopId && !t.get('SELECT 1 FROM shops WHERE org_id = @org AND id = @id', { id: input.shopId })) throw notFound('shop');
    const now = nowOf(c);
    t.run(
      `INSERT OR IGNORE INTO stock_alerts (id, org_id, customer_id, variant_id, shop_id, status, created_at) VALUES (@id, @org, @c, @v, @s, 'waiting', @now)`,
      { id: uuidv7(now), c: customerId, v: input.variantId, s: input.shopId, now },
    );
    const product = t.get<{ product_id: string }>('SELECT product_id FROM product_variants WHERE org_id = @org AND id = @v', { v: input.variantId })!;
    t.run(
      `INSERT INTO product_view_stats_daily (org_id, product_id, day, notify_me_taps) VALUES (@org, @p, @d, 1)
       ON CONFLICT (product_id, day) DO UPDATE SET notify_me_taps = notify_me_taps + 1`,
      { p: product.product_id, d: dayKey(now, 'Europe/Athens') },
    );
    return c.body(null, 204);
  });

  app.get('/v1/c/alerts', requireAuth, (c) => {
    const db = cfgOf(c).db;
    const out: StockAlertItem[] = [];
    for (const f of followingOf(db, c.get('user').id)) {
      const t = new Tenant(db, f.org.id);
      const rows = t.all<{ id: string; variant_id: string; product_id: string; name: string; storage_key: string | null; shop_id: string | null; status: StockAlertItem['status']; created_at: number; notified_at: number | null }>(
        `SELECT a.id, a.variant_id, v.product_id, p.name,
                (SELECT f.storage_key FROM product_images i JOIN files f ON f.id = i.file_id WHERE i.product_id = p.id ORDER BY i.sort LIMIT 1) AS storage_key,
                a.shop_id, a.status, a.created_at, a.notified_at
           FROM stock_alerts a JOIN product_variants v ON v.id = a.variant_id JOIN products p ON p.id = v.product_id
          WHERE a.org_id = @org AND a.customer_id IN (SELECT value FROM json_each(@c)) AND a.status != 'cancelled' ORDER BY a.created_at DESC`,
        { c: f.customerIds },
      );
      const tr = new Map(t.all<{ product_id: string; name: string }>('SELECT tr.product_id, tr.name FROM product_translations tr JOIN products p ON p.id = tr.product_id WHERE p.org_id = @org AND tr.locale = @l', { l: readerLocale(c, f.org.default_locale) }).map((x) => [x.product_id, x.name]));
      for (const r of rows) {
        out.push({
          id: r.id, orgId: f.org.id, orgName: f.org.name, variantId: r.variant_id, productId: r.product_id, productName: tr.get(r.product_id) ?? r.name,
          imageUrl: fileUrl(r.storage_key), shopId: r.shop_id, shopName: r.shop_id ? f.shopNames[r.shop_id] ?? null : null, status: r.status,
          createdAt: r.created_at, notifiedAt: r.notified_at,
        });
      }
    }
    return c.json(out);
  });

  app.delete('/v1/c/alerts/:id', requireAuth, (c) => {
    const db = cfgOf(c).db;
    for (const f of followingOf(db, c.get('user').id)) {
      const res = new Tenant(db, f.org.id).run(
        "UPDATE stock_alerts SET status = 'cancelled' WHERE org_id = @org AND id = @id AND customer_id IN (SELECT value FROM json_each(@c))",
        { id: c.req.param('id'), c: f.customerIds },
      );
      if (res.changes) return c.body(null, 204);
    }
    throw notFound('alert');
  });

  app.put('/v1/c/favorites/:product', requireAuth, async (c) => {
    const { saved } = z.object({ saved: z.boolean() }).parse(await c.req.json());
    const db = cfgOf(c).db;
    const p = platform(db).get<{ org_id: string }>('SELECT org_id FROM products WHERE id = @id', { id: c.req.param('product') });
    if (!p) throw notFound('product');
    const customerId = customerIn(c, p.org_id);
    const t = new Tenant(db, p.org_id);
    const now = nowOf(c);
    if (saved) {
      const res = t.run('INSERT OR IGNORE INTO customer_favorites (org_id, customer_id, product_id, created_at) VALUES (@org, @c, @p, @now)', { c: customerId, p: c.req.param('product'), now });
      if (res.changes) {
        t.run(
          `INSERT INTO product_view_stats_daily (org_id, product_id, day, favorites_added) VALUES (@org, @p, @d, 1)
           ON CONFLICT (product_id, day) DO UPDATE SET favorites_added = favorites_added + 1`,
          { p: c.req.param('product'), d: dayKey(now, 'Europe/Athens') },
        );
      }
    } else {
      t.run('DELETE FROM customer_favorites WHERE org_id = @org AND customer_id = @c AND product_id = @p', { c: customerId, p: c.req.param('product') });
    }
    return c.body(null, 204);
  });

  app.get('/v1/c/favorites', requireAuth, (c) => {
    const db = cfgOf(c).db;
    const out = followingOf(db, c.get('user').id).flatMap((f) => {
      const ids = new Tenant(db, f.org.id)
        .all<{ product_id: string }>('SELECT product_id FROM customer_favorites WHERE org_id = @org AND customer_id IN (SELECT value FROM json_each(@c)) ORDER BY created_at DESC', { c: f.customerIds })
        .map((r) => r.product_id);
      return storefrontProducts(db, f.org, ids, { locale: readerLocale(c, f.org.default_locale), viewerCustomerIds: f.customerIds, now: nowOf(c) });
    });
    return c.json(out);
  });

  // ------------------------------------------------------------ me

  app.patch('/v1/me', requireAuth, async (c) => {
    const patch = z.object({ displayName: z.string().min(1).max(120).optional(), locale: z.enum(['en', 'el', 'ru']).optional() }).parse(await c.req.json());
    platform(cfgOf(c).db).run(
      'UPDATE users SET display_name = coalesce(@n, display_name), locale = coalesce(@l, locale), updated_at = @now WHERE id = @id',
      { n: patch.displayName ?? null, l: patch.locale ?? null, now: nowOf(c), id: c.get('user').id },
    );
    if (patch.locale) platform(cfgOf(c).db).run('UPDATE customers SET locale = @l WHERE user_id = @id', { l: patch.locale, id: c.get('user').id });
    return c.body(null, 204);
  });

  // email change: a code goes to the new address. once confirmed the old address gets a notice.
  app.post('/v1/me/email', requireAuth, async (c) => {
    const { email: raw } = z.object({ email: z.string().email().max(254) }).parse(await c.req.json());
    const cfg = cfgOf(c);
    const user = c.get('user');
    const email = raw.trim().toLowerCase();
    const now = nowOf(c);
    if (!throttle(cfg.db, `emailchange:${user.id}`, { max: 5, windowMs: 3600_000, now })) throw new ApiProblem(429, 'rate_limited');
    if (platform(cfg.db).get('SELECT 1 FROM users WHERE email = @e AND deleted_at IS NULL AND id != @id', { e: email, id: user.id })) throw new ApiProblem(409, 'conflict', 'email in use');
    const code = String(randomInt(100000, 1000000));
    platform(cfg.db).run(
      'INSERT INTO email_changes (id, user_id, new_email, code_hash, created_at, expires_at) VALUES (@id, @u, @e, @h, @now, @exp)',
      { id: uuidv7(now), u: user.id, e: email, h: sha256(`${email}:${code}`), now, exp: now + CODE_TTL },
    );
    const tr = translator(user.locale, 'server');
    devOutboxTransport(cfg.db).send({ channel: 'email', userId: user.id, to: email, locale: user.locale, title: tr('email.changeCode.subject', { code }), body: tr('email.changeCode.body', { code }), payload: { type: 'email_change' } });
    return c.json(cfg.dev ? { sent: true, devCode: code } : { sent: true });
  });

  app.post('/v1/me/email/verify', requireAuth, async (c) => {
    const input = z.object({ email: z.string().email().max(254), code: z.string().length(6) }).parse(await c.req.json());
    const cfg = cfgOf(c);
    const p = platform(cfg.db);
    const user = c.get('user');
    const email = input.email.trim().toLowerCase();
    const now = nowOf(c);
    const row = p.get<{ id: string; code_hash: string; attempts: number; expires_at: number }>(
      'SELECT id, code_hash, attempts, expires_at FROM email_changes WHERE user_id = @u AND new_email = @e AND used_at IS NULL ORDER BY created_at DESC LIMIT 1',
      { u: user.id, e: email },
    );
    if (!row || row.expires_at < now || row.attempts >= 5) throw new ApiProblem(410, 'invite_expired', 'code expired');
    if (row.code_hash !== sha256(`${email}:${input.code}`)) {
      p.run('UPDATE email_changes SET attempts = attempts + 1 WHERE id = @id', { id: row.id });
      throw new ApiProblem(400, 'validation', 'wrong code', { code: 'wrong' });
    }
    if (p.get('SELECT 1 FROM users WHERE email = @e AND deleted_at IS NULL AND id != @id', { e: email, id: user.id })) throw new ApiProblem(409, 'conflict', 'email in use');
    const old = user.email;
    cfg.db.transaction(() => {
      p.run('UPDATE email_changes SET used_at = @now WHERE id = @id', { now, id: row.id });
      p.run('UPDATE users SET email = @e, email_verified_at = @now, updated_at = @now WHERE id = @id', { e: email, now, id: user.id });
      // linked customer records follow, unless that business already has someone with the new address
      const records = p.all<{ id: string; org_id: string; phone: string | null }>('SELECT id, org_id, phone FROM customers WHERE user_id = @u AND erased_at IS NULL', { u: user.id });
      for (const r of records) {
        const t = new Tenant(cfg.db, r.org_id);
        if (t.get('SELECT 1 FROM customers WHERE org_id = @org AND email = @e AND id != @id AND erased_at IS NULL', { e: email, id: r.id })) continue;
        t.run('UPDATE customers SET email = @e, email_verified_at = @now, contact_key = @ck, updated_at = @now WHERE org_id = @org AND id = @id', { e: email, now, ck: contactKey(email, r.phone), id: r.id });
      }
    })();
    if (old) {
      const tr = translator(user.locale, 'server');
      devOutboxTransport(cfg.db).send({ channel: 'email', userId: user.id, to: old, locale: user.locale, title: tr('email.emailChanged.subject'), body: tr('email.emailChanged.body', { email: maskEmail(email) }), payload: { type: 'email_changed' } });
    }
    return c.body(null, 204);
  });

  app.get('/v1/me/export', requireAuth, (c) => {
    const db = cfgOf(c).db;
    const p = platform(db);
    const user = c.get('user');
    const records = followingOf(db, user.id).map((f) => {
      const t = new Tenant(db, f.org.id);
      const q = (sql: string) => t.all(sql, { c: f.customerIds });
      return {
        business: f.org.name,
        customer: q('SELECT name, email, phone, locale, birthday, email_ok, push_ok, sms_ok, source, created_at FROM customers WHERE org_id = @org AND id IN (SELECT value FROM json_each(@c))'),
        subscriptions: q('SELECT scope_type, scope_id, status, created_at, updated_at FROM customer_subscriptions WHERE org_id = @org AND customer_id IN (SELECT value FROM json_each(@c))'),
        consents: q('SELECT channel, granted, text_version, source, created_at FROM consents WHERE org_id = @org AND customer_id IN (SELECT value FROM json_each(@c))'),
        tags: q('SELECT tag, created_at FROM customer_tags WHERE org_id = @org AND customer_id IN (SELECT value FROM json_each(@c))'),
        interests: q('SELECT c.name AS category FROM customer_interests i JOIN categories c ON c.id = i.category_id WHERE i.org_id = @org AND i.customer_id IN (SELECT value FROM json_each(@c))'),
        notes: q('SELECT body, created_at FROM customer_notes WHERE org_id = @org AND deleted_at IS NULL AND customer_id IN (SELECT value FROM json_each(@c))'),
        waitingFor: q('SELECT variant_id, shop_id, status, created_at FROM stock_alerts WHERE org_id = @org AND customer_id IN (SELECT value FROM json_each(@c))'),
        saved: q('SELECT product_id, created_at FROM customer_favorites WHERE org_id = @org AND customer_id IN (SELECT value FROM json_each(@c))'),
        messages: q('SELECT post_id, channel, status, created_at FROM deliveries WHERE org_id = @org AND customer_id IN (SELECT value FROM json_each(@c))'),
      };
    });
    return c.json({
      exportedAt: nowOf(c),
      account: p.get('SELECT email, display_name, locale, created_at FROM users WHERE id = @id', { id: user.id }),
      memberships: p.all('SELECT o.name AS business, m.status, m.joined_at FROM memberships m JOIN organizations o ON o.id = m.org_id WHERE m.user_id = @id', { id: user.id }),
      customerRecords: records,
    });
  });

  // in app account deletion (app store rule). the last owner of a business has to hand it over first.
  app.delete('/v1/me', requireAuth, (c) => {
    const db = cfgOf(c).db;
    const p = platform(db);
    const user = c.get('user');
    const now = nowOf(c);
    const ownerOf = p.all<{ org_id: string }>(
      `SELECT DISTINCT a.org_id FROM role_assignments a JOIN roles r ON r.id = a.role_id JOIN memberships m ON m.id = a.membership_id
        WHERE m.user_id = @u AND m.status = 'active' AND r.template_key = 'owner'`,
      { u: user.id },
    );
    for (const o of ownerOf) {
      const others = p.all<{ user_id: string }>(
        `SELECT DISTINCT m.user_id FROM role_assignments a JOIN roles r ON r.id = a.role_id JOIN memberships m ON m.id = a.membership_id
          WHERE a.org_id = @o AND r.template_key = 'owner' AND m.status = 'active' AND m.user_id != @u`,
        { o: o.org_id, u: user.id },
      );
      const check = checkOwnersAfter(others.map((x) => x.user_id));
      if (!check.ok) throw new ApiProblem(409, 'last_owner');
    }
    db.transaction(() => {
      for (const f of followingOf(db, user.id)) {
        const t = new Tenant(db, f.org.id);
        for (const id of f.customerIds) eraseCustomer(db, t, id, now);
        audit(t, { id: user.id, kind: 'customer' }, 'customer.erased_by_self', null, null, null, now);
      }
      // records with the same address that were never confirmed or linked go as well
      if (user.email) {
        const loose = p.all<{ id: string; org_id: string }>('SELECT id, org_id FROM customers WHERE email = @e AND user_id IS NULL AND erased_at IS NULL AND email_verified_at IS NULL', { e: user.email });
        for (const r of loose) eraseCustomer(db, new Tenant(db, r.org_id), r.id, now);
      }
      const orgs = p.all<{ org_id: string; id: string }>("SELECT org_id, id FROM memberships WHERE user_id = @u AND status != 'removed'", { u: user.id });
      for (const m of orgs) {
        const t = new Tenant(db, m.org_id);
        t.run("UPDATE memberships SET status = 'removed', removed_at = @now WHERE org_id = @org AND id = @id", { now, id: m.id });
        audit(t, { id: user.id }, 'member.deleted_account', { type: 'membership', id: m.id }, null, null, now);
      }
      if (user.email) {
        p.run('DELETE FROM otp_codes WHERE email = @e', { e: user.email });
        p.run('DELETE FROM dev_outbox WHERE to_address = @e', { e: user.email });
      }
      p.run('DELETE FROM dev_outbox WHERE user_id = @u', { u: user.id });
      p.run('UPDATE sessions SET revoked_at = coalesce(revoked_at, @now) WHERE user_id = @u', { now, u: user.id });
      p.run('UPDATE devices SET revoked_at = coalesce(revoked_at, @now), fcm_token = NULL WHERE user_id = @u', { now, u: user.id });
      p.run('UPDATE users SET email = NULL, phone = NULL, display_name = NULL, password_hash = NULL, deleted_at = @now, updated_at = @now WHERE id = @u', { now, u: user.id });
    })();
    return c.body(null, 204);
  });
}
