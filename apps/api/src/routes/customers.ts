// customers (read side) and join links

import type { Hono } from 'hono';
import { contactMatches, effectiveAtScope, followsShop, matches, type CustomerDetail, type JoinLink } from '@custock/core';
import type { AppEnv } from '../types';
import { cfgOf, need, orgOf } from '../lib/context';
import { notFound } from '../lib/problem';
import { clampLimit, decodeCursor, page } from '../lib/tenant';
import { CUSTOMER_COLUMNS, canSee, canSeeContact, customerVisibility, loadSubscriptions, loadTags, reachedShops, toCustomer, type CustomerRow } from '../services/customers';
import { variantLabel } from '../services/catalog';

export function customerRoutes(app: Hono<AppEnv>) {
  app.get('/v1/orgs/:org/customers', (c) => {
    need(c, 'customers.view');
    const { t, topology } = orgOf(c);
    const q = c.req.query();
    if (q.shopId) need(c, 'customers.view', q.shopId);
    const limit = clampLimit(q.limit);
    const offset = decodeCursor(q.cursor);
    const v = customerVisibility(c);
    const rows = t.all<CustomerRow>(
      `SELECT ${CUSTOMER_COLUMNS} FROM customers WHERE org_id = @org AND erased_at IS NULL
         AND (@locale IS NULL OR locale = @locale)
         AND (@channel IS NULL OR (@channel = 'email' AND email_ok = 1) OR (@channel = 'push' AND push_ok = 1))
         AND (@tag IS NULL OR EXISTS (SELECT 1 FROM customer_tags ct WHERE ct.customer_id = customers.id AND ct.tag = @tag))
       ORDER BY created_at DESC`,
      { locale: q.locale ?? null, channel: q.channel ?? null, tag: q.tag ?? null },
    );
    const subs = loadSubscriptions(c);
    const visible = rows.filter((r) => {
      const s = subs.get(r.id) ?? [];
      const reached = reachedShops(c, s);
      if (!canSee(v, reached)) return false;
      if (q.shopId && !followsShop(s, topology, q.shopId, true)) return false;
      if (q.q && !matches(r.search_key ?? '', q.q) && !(canSeeContact(v, reached) && contactMatches(r.contact_key, q.q))) return false;
      return true;
    });
    const slice = visible.slice(offset, offset + limit + 1);
    const tags = loadTags(c, slice.map((r) => r.id));
    const items = slice.map((r) => {
      const s = subs.get(r.id) ?? [];
      return toCustomer(r, s, tags.get(r.id) ?? [], v, reachedShops(c, s));
    });
    return c.json({ ...page(items, offset, limit), total: visible.length });
  });

  app.get('/v1/orgs/:org/customers/:id', (c) => {
    need(c, 'customers.view');
    const { t } = orgOf(c);
    const id = c.req.param('id');
    const row = t.get<CustomerRow>(`SELECT ${CUSTOMER_COLUMNS} FROM customers WHERE org_id = @org AND id = @id AND erased_at IS NULL`, { id });
    if (!row) throw notFound('customer');
    const subs = loadSubscriptions(c, [id]).get(id) ?? [];
    const v = customerVisibility(c);
    const reached = reachedShops(c, subs);
    if (!canSee(v, reached)) throw notFound('customer');
    const base = toCustomer(row, subs, loadTags(c, [id]).get(id) ?? [], v, reached);
    const locale = c.get('locale');
    const detail: CustomerDetail = {
      ...base,
      consents: t
        .all<{ channel: 'email' | 'push' | 'sms'; granted: number; text_version: string; source: string; created_at: number }>(
          'SELECT channel, granted, text_version, source, created_at FROM consents WHERE org_id = @org AND customer_id = @id ORDER BY created_at DESC',
          { id },
        )
        .map((x) => ({ channel: x.channel, granted: !!x.granted, textVersion: x.text_version, source: x.source, createdAt: x.created_at })),
      notes: t
        .all<{ id: string; body: string; author_name: string | null; created_at: number }>(
          `SELECT n.id, n.body, u.display_name AS author_name, n.created_at FROM customer_notes n LEFT JOIN users u ON u.id = n.author_id
            WHERE n.org_id = @org AND n.customer_id = @id AND n.deleted_at IS NULL ORDER BY n.created_at DESC`,
          { id },
        )
        .map((x) => ({ id: x.id, body: x.body, authorName: x.author_name, createdAt: x.created_at })),
      waitingFor: t
        .all<{ variant_id: string; name: string; options: string | null; shop_id: string | null }>(
          `SELECT a.variant_id, p.name, v.options, a.shop_id FROM stock_alerts a JOIN product_variants v ON v.id = a.variant_id JOIN products p ON p.id = v.product_id
            WHERE a.org_id = @org AND a.customer_id = @id AND a.status = 'waiting' ORDER BY a.created_at DESC`,
          { id },
        )
        .map((x) => ({ variantId: x.variant_id, productName: variantLabel(x.name, x.options, locale), shopId: x.shop_id })),
      favorites: t
        .all<{ product_id: string; name: string }>(
          `SELECT f.product_id, p.name FROM customer_favorites f JOIN products p ON p.id = f.product_id
            WHERE f.org_id = @org AND f.customer_id = @id ORDER BY f.created_at DESC`,
          { id },
        )
        .map((x) => ({ productId: x.product_id, productName: x.name })),
      deliveries: t
        .all<{ post_id: string | null; channel: string; status: string; created_at: number }>(
          'SELECT post_id, channel, status, created_at FROM deliveries WHERE org_id = @org AND customer_id = @id ORDER BY created_at DESC LIMIT 50',
          { id },
        )
        .map((x) => ({ postId: x.post_id, channel: x.channel, status: x.status, createdAt: x.created_at })),
    };
    return c.json(detail);
  });

  // links the member can manage: the link's scope must sit inside a scope where they hold joinlinks.manage
  app.get('/v1/orgs/:org/join-links', (c) => {
    need(c, 'joinlinks.manage');
    const { t, assignments, topology } = orgOf(c);
    const rows = t.all<{ id: string; code: string; scope_type: 'org' | 'group' | 'shop'; scope_id: string; label: string | null; disabled_at: number | null; expires_at: number | null; opens: number | null; signups: number | null; confirmed: number | null }>(
      `SELECT j.id, j.code, j.scope_type, j.scope_id, j.label, j.disabled_at, j.expires_at,
              sum(s.opens) AS opens, sum(s.signups) AS signups, sum(s.confirmed) AS confirmed
         FROM join_links j LEFT JOIN join_link_stats_daily s ON s.join_link_id = j.id
        WHERE j.org_id = @org GROUP BY j.id ORDER BY j.created_at`,
    );
    const base = cfgOf(c).publicWebUrl.replace(/\/$/, '');
    const now = Date.now();
    const items: JoinLink[] = rows
      .filter((r) => effectiveAtScope(assignments, topology, { scopeType: r.scope_type, scopeId: r.scope_id }).perms.has('joinlinks.manage'))
      .map((r) => ({
        id: r.id,
        code: r.code,
        scopeType: r.scope_type,
        scopeId: r.scope_id,
        label: r.label,
        url: `${base}/j/${r.code}`,
        opens: r.opens ?? 0,
        signups: r.signups ?? 0,
        confirmed: r.confirmed ?? 0,
        disabled: !!r.disabled_at || (r.expires_at != null && r.expires_at < now),
      }));
    return c.json(items);
  });
}
