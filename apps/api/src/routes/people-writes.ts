// customers and the people side: staff adding customers, notes, tags, erase, join links,
// the public join with double opt in, unsubscribe links, the customer app writes, my data

import type { Context, Hono } from 'hono';
import { z } from 'zod';
import {
  AddCustomerInput, checkOwnersAfter, effectiveAtScope, JoinInput, maskEmail, searchKey, uuidv7, type Customer, type JoinLink, type StockAlertItem,
} from '@custock/core';
import { randomToken, sha256, type Db } from '@custock/db';
import { pickLocale, translator } from '@custock/i18n';
import type { AppEnv, Config } from '../types';
import { audit } from '../lib/audit';
import { cfgOf, need, nowOf, orgOf, ORG_COLUMNS, requireAuth } from '../lib/context';
import { idempotent } from '../lib/idempotency';
import { ApiProblem, badRequest, forbidden, notFound } from '../lib/problem';
import { platform, Tenant } from '../lib/tenant';
import { dayKey } from '../lib/time';
import { devOutboxTransport } from '../lib/transport';
import { readUnsubToken } from '../lib/unsub';
import { shopNameOf } from '../services/ledger';
import { customerVisibility, loadSubscriptions, loadTags, reachedShops, toCustomer, CUSTOMER_COLUMNS, type CustomerRow } from '../services/customers';
import { fileUrl } from '../services/catalog';
import { storefrontProducts } from '../services/storefront';
import { followingOf } from './customer';
import type { OrgRow } from '../types';

const CONFIRM_TTL = 7 * 86_400_000;
const TEXT_VERSION = (locale: string) => `${locale}-2026-11`;

export const DEV_TURNSTILE_TOKEN = 'dev-turnstile-ok';

// stand in for cloudflare turnstile. dev accepts no token or the dev token, anything else fails.
export function verifyTurnstile(cfg: Config, token: string | undefined): boolean {
  if (cfg.dev) return token === undefined || token === DEV_TURNSTILE_TOKEN;
  return false;
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

interface UpsertArgs {
  db: Db;
  org: OrgRow;
  now: number;
  name: string;
  email: string | null;
  phone: string | null;
  locale: 'en' | 'el' | 'ru';
  source: 'join_link' | 'app' | 'staff' | 'import';
  joinLinkId: string | null;
  userId?: string | null;
  verified?: boolean;
}

// one customer per email (and phone) per org
function upsertCustomer(a: UpsertArgs): { id: string; created: boolean } {
  const t = new Tenant(a.db, a.org.id);
  const existing = a.email
    ? t.get<{ id: string }>('SELECT id FROM customers WHERE org_id = @org AND email = @e AND erased_at IS NULL', { e: a.email })
    : a.phone
      ? t.get<{ id: string }>('SELECT id FROM customers WHERE org_id = @org AND phone = @p AND erased_at IS NULL', { p: a.phone })
      : undefined;
  if (existing) {
    if (a.userId) t.run('UPDATE customers SET user_id = coalesce(user_id, @u), email_verified_at = coalesce(email_verified_at, @now), updated_at = @now WHERE org_id = @org AND id = @id', { u: a.userId, now: a.now, id: existing.id });
    return { id: existing.id, created: false };
  }
  const id = uuidv7(a.now);
  t.run(
    `INSERT INTO customers (id, org_id, user_id, name, email, email_verified_at, phone, locale, source, join_link_id, search_key, created_at, updated_at)
     VALUES (@id, @org, @u, @name, @email, @verified, @phone, @locale, @source, @link, @key, @now, @now)`,
    {
      id, u: a.userId ?? null, name: a.name, email: a.email, verified: a.verified ? a.now : null, phone: a.phone, locale: a.locale,
      source: a.source, link: a.joinLinkId, key: searchKey(a.name, a.email, a.phone), now: a.now,
    },
  );
  return { id, created: true };
}

function setSubscription(t: Tenant, customerId: string, scopeType: string, scopeId: string, status: 'pending' | 'subscribed' | 'unsubscribed', now: number, source: string | null, linkId: string | null) {
  t.run(
    `INSERT INTO customer_subscriptions (id, org_id, customer_id, scope_type, scope_id, status, source, join_link_id, created_at, updated_at)
     VALUES (@id, @org, @c, @st, @sid, @status, @source, @link, @now, @now)
     ON CONFLICT (customer_id, scope_type, scope_id) DO UPDATE SET status = CASE
       WHEN customer_subscriptions.status = 'subscribed' AND @status = 'pending' THEN 'subscribed' ELSE @status END, updated_at = @now`,
    { id: uuidv7(now), c: customerId, st: scopeType, sid: scopeId, status, source, link: linkId, now },
  );
}

function consent(t: Tenant, customerId: string, channel: 'email' | 'push' | 'sms', granted: boolean, locale: string, source: string, now: number, ip: string | null = null, ua: string | null = null) {
  t.run(
    `INSERT INTO consents (id, org_id, customer_id, channel, granted, text_version, source, ip, user_agent, created_at)
     VALUES (@id, @org, @c, @ch, @g, @v, @s, @ip, @ua, @now)`,
    { id: uuidv7(now), c: customerId, ch: channel, g: granted, v: TEXT_VERSION(locale), s: source, ip, ua, now },
  );
  const col = channel === 'email' ? 'email_ok' : channel === 'push' ? 'push_ok' : 'sms_ok';
  // email only counts once the address is confirmed
  t.run(
    `UPDATE customers SET ${col} = CASE WHEN @g = 1 AND @ch = 'email' AND email_verified_at IS NULL THEN 0 ELSE @g END, updated_at = @now WHERE org_id = @org AND id = @c`,
    { g: granted, ch: channel, now, c: customerId },
  );
}

function sendConfirmation(cfg: Config, t: Tenant, org: OrgRow, customerId: string, linkId: string | null, scopeName: string, locale: string, name: string, email: string, now: number): string {
  const token = randomToken();
  t.run(
    'INSERT INTO join_confirmations (token_hash, org_id, customer_id, join_link_id, created_at, expires_at) VALUES (@h, @org, @c, @l, @now, @exp)',
    { h: sha256(token), c: customerId, l: linkId, now, exp: now + CONFIRM_TTL },
  );
  const url = `${cfg.publicWebUrl.replace(/\/$/, '')}/confirm/${token}`;
  const tr = translator(pickLocale(locale), 'server');
  devOutboxTransport(cfg.db).send({
    channel: 'email', orgId: org.id, customerId, to: email, locale,
    title: tr('email.joinConfirm.subject', { scope: scopeName }), body: tr('email.joinConfirm.body', { name, scope: scopeName, url }),
    payload: { type: 'join_confirm' },
  });
  return url;
}

function erase(t: Tenant, customerId: string, now: number) {
  t.run(
    `UPDATE customers SET name = NULL, email = NULL, phone = NULL, birthday = NULL, search_key = NULL, user_id = NULL,
       email_ok = 0, push_ok = 0, sms_ok = 0, erased_at = @now, updated_at = @now WHERE org_id = @org AND id = @c`,
    { now, c: customerId },
  );
  t.run("UPDATE stock_alerts SET status = 'cancelled' WHERE org_id = @org AND customer_id = @c AND status = 'waiting'", { c: customerId });
  t.run('DELETE FROM customer_favorites WHERE org_id = @org AND customer_id = @c', { c: customerId });
  t.run('DELETE FROM customer_tags WHERE org_id = @org AND customer_id = @c', { c: customerId });
  t.run('DELETE FROM customer_interests WHERE org_id = @org AND customer_id = @c', { c: customerId });
  t.run('UPDATE customer_notes SET body = \'\', deleted_at = @now WHERE org_id = @org AND customer_id = @c', { now, c: customerId });
  t.run("UPDATE customer_subscriptions SET status = 'unsubscribed', updated_at = @now WHERE org_id = @org AND customer_id = @c", { now, c: customerId });
  t.run('UPDATE consents SET ip = NULL, user_agent = NULL WHERE org_id = @org AND customer_id = @c', { c: customerId });
  t.run("UPDATE deliveries SET status = 'skipped', skip_reason = 'erased', updated_at = @now WHERE org_id = @org AND customer_id = @c AND status IN ('queued', 'held')", { now, c: customerId });
}

function clientIp(c: Context<AppEnv>) {
  return c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
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

export function peopleWriteRoutes(app: Hono<AppEnv>) {
  // ------------------------------------------------------------ staff side

  app.post('/v1/orgs/:org/customers', async (c) => {
    const input = AddCustomerInput.parse(await c.req.json());
    need(c, 'customers.add', input.shopId);
    if (!input.email && !input.phone) throw badRequest('email or phone', { email: 'required' });
    return idempotent(c, () => {
      const { t, org } = orgOf(c);
      const cfg = cfgOf(c);
      const now = nowOf(c);
      const email = input.email?.trim().toLowerCase() ?? null;
      let confirmUrl: string | null = null;
      const res = cfg.db.transaction(() => {
        const r = upsertCustomer({ db: cfg.db, org, now, name: input.name, email, phone: input.phone ?? null, locale: input.locale, source: 'staff', joinLinkId: null });
        setSubscription(t, r.id, 'shop', input.shopId, email ? 'pending' : 'subscribed', now, 'staff', null);
        if (input.emailNews && email) consent(t, r.id, 'email', true, input.locale, 'staff', now);
        for (const tag of input.tags) t.run('INSERT OR IGNORE INTO customer_tags (org_id, customer_id, tag, created_at) VALUES (@org, @c, @tag, @now)', { c: r.id, tag, now });
        if (email) confirmUrl = sendConfirmation(cfg, t, org, r.id, null, scopeLabel(t, org, 'shop', input.shopId), input.locale, input.name, email, now);
        audit(t, { id: c.get('user').id }, 'customer.added', { type: 'customer', id: r.id }, null, { shopId: input.shopId }, now);
        return r;
      })();
      const row = t.get<CustomerRow>(`SELECT ${CUSTOMER_COLUMNS} FROM customers WHERE org_id = @org AND id = @id`, { id: res.id })!;
      const subs = loadSubscriptions(c, [res.id]).get(res.id) ?? [];
      const customer: Customer & { devConfirmLink?: string } = toCustomer(row, subs, loadTags(c, [res.id]).get(res.id) ?? [], customerVisibility(c), reachedShops(c, subs));
      if (cfg.dev && confirmUrl) customer.devConfirmLink = confirmUrl;
      return { status: res.created ? 201 : 200, body: customer };
    });
  });

  app.post('/v1/orgs/:org/customers/:id/notes', async (c) => {
    need(c, 'customers.edit');
    const { body } = z.object({ body: z.string().min(1).max(2000) }).parse(await c.req.json());
    const { t } = orgOf(c);
    if (!t.get('SELECT 1 FROM customers WHERE org_id = @org AND id = @id AND erased_at IS NULL', { id: c.req.param('id') })) throw notFound('customer');
    t.run('INSERT INTO customer_notes (id, org_id, customer_id, body, author_id, created_at) VALUES (@id, @org, @c, @b, @u, @now)', { id: uuidv7(nowOf(c)), c: c.req.param('id'), b: body, u: c.get('user').id, now: nowOf(c) });
    return c.body(null, 204);
  });

  app.put('/v1/orgs/:org/customers/:id/tags', async (c) => {
    need(c, 'customers.edit');
    const { tags } = z.object({ tags: z.array(z.string().min(1).max(40)).max(30) }).parse(await c.req.json());
    const { t } = orgOf(c);
    const id = c.req.param('id');
    if (!t.get('SELECT 1 FROM customers WHERE org_id = @org AND id = @id AND erased_at IS NULL', { id })) throw notFound('customer');
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
      erase(t, id, now);
      audit(t, { id: c.get('user').id }, 'customer.erased', { type: 'customer', id }, null, null, now);
    })();
    return c.body(null, 204);
  });

  app.post('/v1/orgs/:org/join-links', async (c) => {
    const input = z.object({ scopeType: z.enum(['org', 'group', 'shop']), scopeId: z.string(), label: z.string().max(80).optional() }).parse(await c.req.json());
    const { assignments, topology, t } = orgOf(c);
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
    if (!verifyTurnstile(cfg, input.turnstileToken)) throw forbidden('bot check failed');
    const link = platform(cfg.db).get<{ id: string; org_id: string; scope_type: string; scope_id: string; disabled_at: number | null; expires_at: number | null; default_tags: string | null }>(
      'SELECT id, org_id, scope_type, scope_id, disabled_at, expires_at, default_tags FROM join_links WHERE code = @code',
      { code: c.req.param('code') },
    );
    if (!link) throw notFound('join link');
    const now = nowOf(c);
    if (link.disabled_at || (link.expires_at != null && link.expires_at < now)) throw new ApiProblem(410, 'join_link_disabled');
    const org = orgBy(cfg.db, link.org_id);
    const t = new Tenant(cfg.db, org.id);
    const email = input.email.trim().toLowerCase();
    const url = cfg.db.transaction(() => {
      const r = upsertCustomer({ db: cfg.db, org, now, name: input.name, email, phone: null, locale: input.locale, source: 'join_link', joinLinkId: link.id });
      setSubscription(t, r.id, link.scope_type, link.scope_id, 'pending', now, 'join_link', link.id);
      consent(t, r.id, 'email', input.emailNews, input.locale, 'join_page', now, clientIp(c), c.req.header('User-Agent') ?? null);
      if (input.push) consent(t, r.id, 'push', true, input.locale, 'join_page', now, clientIp(c), c.req.header('User-Agent') ?? null);
      for (const cat of input.interests) {
        if (t.get('SELECT 1 FROM categories WHERE org_id = @org AND id = @id', { id: cat })) t.run('INSERT OR IGNORE INTO customer_interests (org_id, customer_id, category_id) VALUES (@org, @c, @cat)', { c: r.id, cat });
      }
      for (const tag of JSON.parse(link.default_tags ?? '[]') as string[]) t.run('INSERT OR IGNORE INTO customer_tags (org_id, customer_id, tag, created_at) VALUES (@org, @c, @tag, @now)', { c: r.id, tag, now });
      bumpStat(t, link.id, 'signups', org.timezone, now);
      return sendConfirmation(cfg, t, org, r.id, link.id, scopeLabel(t, org, link.scope_type, link.scope_id), input.locale, input.name, email, now);
    })();
    return c.json(cfg.dev ? { pending: true, devConfirmLink: url } : { pending: true });
  });

  // double opt in: the pending signup becomes a subscription and email consent starts counting
  app.post('/v1/public/confirm', async (c) => {
    const { token } = z.object({ token: z.string().min(10) }).parse(await c.req.json());
    const cfg = cfgOf(c);
    const row = platform(cfg.db).get<{ token_hash: string; org_id: string; customer_id: string; join_link_id: string | null; expires_at: number; confirmed_at: number | null }>(
      'SELECT token_hash, org_id, customer_id, join_link_id, expires_at, confirmed_at FROM join_confirmations WHERE token_hash = @h',
      { h: sha256(token) },
    );
    const now = nowOf(c);
    if (!row || (row.expires_at < now && !row.confirmed_at)) throw new ApiProblem(410, 'invite_expired', 'confirmation link expired');
    const org = orgBy(cfg.db, row.org_id);
    const t = new Tenant(cfg.db, org.id);
    let scopeName = org.name;
    cfg.db.transaction(() => {
      const customer = t.get<{ locale: string }>('SELECT locale FROM customers WHERE org_id = @org AND id = @c AND erased_at IS NULL', { c: row.customer_id });
      if (!customer) throw new ApiProblem(410, 'not_found');
      const pending = t.all<{ scope_type: string; scope_id: string }>("SELECT scope_type, scope_id FROM customer_subscriptions WHERE org_id = @org AND customer_id = @c AND status = 'pending'", { c: row.customer_id });
      if (pending[0]) scopeName = scopeLabel(t, org, pending[0].scope_type, pending[0].scope_id);
      if (row.confirmed_at) return;
      t.run('UPDATE join_confirmations SET confirmed_at = @now WHERE token_hash = @h AND org_id = @org', { now, h: row.token_hash });
      t.run('UPDATE customers SET email_verified_at = coalesce(email_verified_at, @now), updated_at = @now WHERE org_id = @org AND id = @c', { now, c: row.customer_id });
      t.run("UPDATE customer_subscriptions SET status = 'subscribed', updated_at = @now WHERE org_id = @org AND customer_id = @c AND status = 'pending'", { now, c: row.customer_id });
      const lastEmail = t.get<{ granted: number }>("SELECT granted FROM consents WHERE org_id = @org AND customer_id = @c AND channel = 'email' ORDER BY created_at DESC LIMIT 1", { c: row.customer_id });
      if (lastEmail?.granted) consent(t, row.customer_id, 'email', true, customer.locale, 'double_opt_in', now, clientIp(c), c.req.header('User-Agent') ?? null);
      bumpStat(t, row.join_link_id, 'confirmed', org.timezone, now);
    })();
    return c.json({ orgName: org.name, scopeName });
  });

  function unsubTarget(c: Context<AppEnv>) {
    const cfg = cfgOf(c);
    const target = readUnsubToken(c.req.param('token') ?? '', cfg.jwtSecret);
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

  // one click: works without login, never asks twice
  app.post('/v1/public/subscription/:token', async (c) => {
    const { target, customer, org, cfg } = unsubTarget(c);
    const body = await c.req.json().catch(() => ({}));
    const everything = !!(body as { everything?: boolean }).everything;
    const t = new Tenant(cfg.db, org.id);
    const now = nowOf(c);
    cfg.db.transaction(() => {
      if (everything) {
        t.run("UPDATE customer_subscriptions SET status = 'unsubscribed', updated_at = @now WHERE org_id = @org AND customer_id = @c", { now, c: target.customerId });
        setSubscription(t, target.customerId, 'org', org.id, 'unsubscribed', now, 'unsubscribe_link', null);
        consent(t, target.customerId, 'email', false, customer.locale, 'unsubscribe_link', now, clientIp(c));
      } else {
        setSubscription(t, target.customerId, target.scopeType, target.scopeId, 'unsubscribed', now, 'unsubscribe_link', null);
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
    cfg.db.transaction(() => {
      const r = upsertCustomer({ db: cfg.db, org, now, name: user.displayName ?? user.email!, email: user.email!.toLowerCase(), phone: null, locale: user.locale, source: 'app', joinLinkId: link.id, userId: user.id, verified: true });
      setSubscription(t, r.id, link.scope_type, link.scope_id, 'subscribed', now, 'app', link.id);
      if (body.emailNews) consent(t, r.id, 'email', true, user.locale, 'app', now);
      if (body.push) consent(t, r.id, 'push', true, user.locale, 'app', now);
      bumpStat(t, link.id, 'signups', org.timezone, now);
      bumpStat(t, link.id, 'confirmed', org.timezone, now);
    })();
    return c.json({ orgName: org.name, scopeName: scopeLabel(t, org, link.scope_type, link.scope_id) });
  });

  app.post('/v1/c/follow', requireAuth, async (c) => follow(c, 'subscribed'));
  app.post('/v1/c/unfollow', requireAuth, async (c) => follow(c, 'unsubscribed'));

  async function follow(c: Context<AppEnv>, status: 'subscribed' | 'unsubscribed') {
    const input = z.object({ scopeType: z.enum(['org', 'group', 'shop']), scopeId: z.string() }).parse(await c.req.json());
    const db = cfgOf(c).db;
    const orgId =
      input.scopeType === 'org'
        ? input.scopeId
        : platform(db).get<{ org_id: string }>(`SELECT org_id FROM ${input.scopeType === 'shop' ? 'shops' : 'shop_groups'} WHERE id = @id`, { id: input.scopeId })?.org_id;
    if (!orgId) throw notFound('scope');
    const customerId = customerIn(c, orgId);
    const t = new Tenant(db, orgId);
    setSubscription(t, customerId, input.scopeType, input.scopeId, status, nowOf(c), 'app', null);
    return c.body(null, 204);
  }

  app.put('/v1/c/channels', requireAuth, async (c) => {
    const input = z.object({ orgId: z.string(), channel: z.enum(['email', 'push']), on: z.boolean() }).parse(await c.req.json());
    const customerId = customerIn(c, input.orgId);
    const t = new Tenant(cfgOf(c).db, input.orgId);
    consent(t, customerId, input.channel, input.on, c.get('user').locale, 'app', nowOf(c));
    return c.body(null, 204);
  });

  app.post('/v1/c/alerts', requireAuth, async (c) => {
    const input = z.object({ variantId: z.string(), shopId: z.string().nullable().default(null) }).parse(await c.req.json());
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
      const tr = new Map(t.all<{ product_id: string; name: string }>('SELECT tr.product_id, tr.name FROM product_translations tr JOIN products p ON p.id = tr.product_id WHERE p.org_id = @org AND tr.locale = @l', { l: c.get('locale') }).map((x) => [x.product_id, x.name]));
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
      return storefrontProducts(db, f.org, ids, { locale: c.get('locale'), viewerCustomerIds: f.customerIds, now: nowOf(c) });
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
        waitingFor: q('SELECT variant_id, shop_id, status, created_at FROM stock_alerts WHERE org_id = @org AND customer_id IN (SELECT value FROM json_each(@c))'),
        saved: q('SELECT product_id, created_at FROM customer_favorites WHERE org_id = @org AND customer_id IN (SELECT value FROM json_each(@c))'),
        messages: q('SELECT post_id, channel, status, created_at FROM deliveries WHERE org_id = @org AND customer_id IN (SELECT value FROM json_each(@c))'),
      };
    });
    return c.json({
      exportedAt: nowOf(c),
      account: p.get('SELECT email, display_name, locale, created_at FROM users WHERE id = @id', { id: user.id }),
      memberships: p.all("SELECT o.name AS business, m.status, m.joined_at FROM memberships m JOIN organizations o ON o.id = m.org_id WHERE m.user_id = @id", { id: user.id }),
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
        for (const id of f.customerIds) erase(t, id, now);
        audit(t, { id: user.id, kind: 'customer' }, 'customer.erased_by_self', null, null, null, now);
      }
      const orgs = p.all<{ org_id: string; id: string }>("SELECT org_id, id FROM memberships WHERE user_id = @u AND status != 'removed'", { u: user.id });
      for (const m of orgs) {
        const t = new Tenant(db, m.org_id);
        t.run("UPDATE memberships SET status = 'removed', removed_at = @now WHERE org_id = @org AND id = @id", { now, id: m.id });
        audit(t, { id: user.id }, 'member.deleted_account', { type: 'membership', id: m.id }, null, null, now);
      }
      p.run('UPDATE sessions SET revoked_at = coalesce(revoked_at, @now) WHERE user_id = @u', { now, u: user.id });
      p.run('UPDATE devices SET revoked_at = coalesce(revoked_at, @now), fcm_token = NULL WHERE user_id = @u', { now, u: user.id });
      p.run('UPDATE users SET email = NULL, phone = NULL, display_name = NULL, password_hash = NULL, deleted_at = @now, updated_at = @now WHERE id = @u', { now, u: user.id });
    })();
    return c.body(null, 204);
  });
}
