// dashboard and reports. money only with reports.financial.view, days in the org timezone.

import type { Context, Hono } from 'hono';
import { shopsInScope, type DashboardCards, type SeriesPoint } from '@custock/core';
import type { AppEnv } from '../types';
import { has, need, nowOf, orgOf, productNameSql, readerLocale, shopsFor } from '../lib/context';
import { variantLabel } from '../services/catalog';
import { dayKey } from '../lib/time';
import { loadPosts, postShops } from '../services/posts';
import { canSee, customerVisibility, loadSubscriptions, reachedShops } from '../services/customers';

const DAY = 86_400_000;

export { dayKey };

function days(c: Context<AppEnv>, def: number): number {
  const n = Number(c.req.query('days'));
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 366) : def;
}

// shops for a report: the asked one or all where the member can see reports (or the given perm)
function reportShops(c: Context<AppEnv>, perm = 'reports.view'): string[] {
  const shops = shopsFor(c, perm, c.req.query('shopId') || null);
  if (!shops.length) need(c, perm);
  return shops;
}

const units = (qty: number, uom: string) => (uom === 'piece' ? qty : qty / 1000);

// posts in a status that reach at least one of the given shops
function postsReaching(c: Context<AppEnv>, status: string, shops: string[]): number {
  const { t, topology } = orgOf(c);
  if (!shops.length) return 0;
  const ids = t.all<{ id: string }>('SELECT id FROM posts WHERE org_id = @org AND status = @s AND deleted_at IS NULL', { s: status }).map((r) => r.id);
  const wanted = new Set(shops);
  return loadPosts(t, ids, { withStats: false, showPrices: false }).filter((p) => postShops(t, p, topology).some((s) => wanted.has(s))).length;
}

export function reportRoutes(app: Hono<AppEnv>) {
  app.use('/v1/orgs/:org/reports/*', async (c, next) => {
    c.set('localeName', readerLocale(c, orgOf(c).org.default_locale));
    await next();
  });

  // the home screen of every work role. each number needs its own permission.
  app.get('/v1/orgs/:org/reports/dashboard', (c) => {
    const { t, access, org } = orgOf(c);
    const asked = c.req.query('shopId') || null;
    const mine = access.shops.map((s) => s.shopId);
    if (asked && !mine.includes(asked)) need(c, 'stock.view', asked);
    const shops = asked ? [asked] : mine;
    const now = nowOf(c);
    const with_ = (perm: string) => shops.filter((s) => has(c, perm, s));
    const stockShops = with_('stock.view');
    const count = (sql: string, params: Record<string, unknown>) => t.get<{ n: number }>(sql, params)?.n ?? 0;

    const levelCount = (cond: string) =>
      stockShops.length
        ? count(
            `SELECT count(*) AS n FROM stock_levels l JOIN product_variants v ON v.id = l.variant_id JOIN products p ON p.id = v.product_id
               LEFT JOIN shop_variant_settings ss ON ss.shop_id = l.shop_id AND ss.variant_id = l.variant_id
              WHERE l.org_id = @org AND p.archived_at IS NULL AND v.archived_at IS NULL AND p.track_stock = 1
                AND l.shop_id IN (SELECT value FROM json_each(@shops)) AND ${cond}`,
            { shops: stockShops },
          )
        : 0;

    let newFollowers = 0;
    if (has(c, 'customers.view')) {
      const v = customerVisibility(c);
      const recent = t.all<{ id: string }>('SELECT id FROM customers WHERE org_id = @org AND erased_at IS NULL AND created_at > @since', { since: now - 7 * DAY });
      const subs = loadSubscriptions(c, recent.map((r) => r.id));
      newFollowers = recent.filter((r) => {
        const reached = reachedShops(c, subs.get(r.id) ?? []);
        return canSee(v, reached) && reached.some((s) => shops.includes(s));
      }).length;
    }

    const money = with_('reports.financial.view');
    const todayStart = (() => {
      const key = dayKey(now, org.timezone);
      // the start of the local day, searched back from now
      let ts = now;
      while (dayKey(ts - 3600_000, org.timezone) === key) ts -= 3600_000;
      return ts - (ts % 3600_000);
    })();

    const cards: DashboardCards = {
      lowStock: levelCount('l.on_hand > 0 AND l.on_hand <= coalesce(ss.reorder_point, -1)'),
      outOfStock: levelCount('l.on_hand = 0'),
      negativeStock: levelCount('l.on_hand < 0'),
      peopleWaiting:
        has(c, 'customers.view') || stockShops.length
          ? count(
              `SELECT count(*) AS n FROM stock_alerts WHERE org_id = @org AND status = 'waiting'
                 AND (shop_id IS NULL OR shop_id IN (SELECT value FROM json_each(@shops)))`,
              { shops },
            )
          : 0,
      newFollowersWeek: newFollowers,
      scheduledPosts: has(c, 'posts.view') ? postsReaching(c, 'scheduled', shops) : 0,
      pendingApprovals: has(c, 'posts.publish') ? postsReaching(c, 'pending_approval', shops.filter((s) => has(c, 'posts.publish', s))) : 0,
      countsInReview: with_('stock.count.approve').length
        ? count("SELECT count(*) AS n FROM stock_counts WHERE org_id = @org AND status = 'review' AND shop_id IN (SELECT value FROM json_each(@shops))", { shops: with_('stock.count.approve') })
        : 0,
      transfersOnTheWay: stockShops.length
        ? count("SELECT count(*) AS n FROM transfers WHERE org_id = @org AND status = 'sent' AND to_shop_id IN (SELECT value FROM json_each(@shops))", { shops: stockShops })
        : 0,
      unknownCodes:
        has(c, 'products.create') || has(c, 'products.edit') || has(c, 'stock.settings.manage')
          ? count('SELECT count(*) AS n FROM unknown_scans WHERE org_id = @org AND resolved_at IS NULL AND shop_id IN (SELECT value FROM json_each(@shops))', { shops })
          : 0,
      stockValueCostMinor: money.length
        ? Math.round(
            t.get<{ v: number | null }>(
              `SELECT sum(CASE WHEN l.on_hand > 0 THEN (CASE WHEN p.uom = 'piece' THEN l.on_hand ELSE l.on_hand / 1000.0 END) * coalesce(v.cost_minor, 0) ELSE 0 END) AS v
                 FROM stock_levels l JOIN product_variants v ON v.id = l.variant_id JOIN products p ON p.id = v.product_id
                WHERE l.org_id = @org AND l.shop_id IN (SELECT value FROM json_each(@shops))`,
              { shops: money },
            )?.v ?? 0,
          )
        : null,
      salesTodayMinor: money.length
        ? Math.round(
            t.get<{ v: number | null }>(
              `SELECT sum(-(CASE WHEN p.uom = 'piece' THEN m.qty_delta ELSE m.qty_delta / 1000.0 END) * coalesce(m.unit_price_minor, v.price_minor, 0)) AS v
                 FROM stock_movements m JOIN product_variants v ON v.id = m.variant_id JOIN products p ON p.id = v.product_id
                WHERE m.org_id = @org AND m.kind = 'sale' AND m.recorded_at >= @from AND m.shop_id IN (SELECT value FROM json_each(@shops))`,
              { shops: money, from: todayStart },
            )?.v ?? 0,
          )
        : null,
    };
    return c.json(cards);
  });

  // value per day when money is allowed, otherwise units sold
  app.get('/v1/orgs/:org/reports/sales', (c) => {
    const shops = reportShops(c);
    const { t, org } = orgOf(c);
    const n = days(c, 14);
    const now = nowOf(c);
    const money = shops.every((s) => has(c, 'reports.financial.view', s));
    // 15 minute buckets in sql (enough for any timezone offset), local days in code
    const rows = t.all<{ slot: number; pieces: number; value: number }>(
      `SELECT m.recorded_at / 900000 AS slot,
              sum(CASE WHEN p.uom = 'piece' THEN -m.qty_delta ELSE 0 END) AS pieces,
              sum(-(CASE WHEN p.uom = 'piece' THEN m.qty_delta ELSE m.qty_delta / 1000.0 END) * coalesce(m.unit_price_minor, v.price_minor, 0)) AS value
         FROM stock_movements m JOIN product_variants v ON v.id = m.variant_id JOIN products p ON p.id = v.product_id
        WHERE m.org_id = @org AND m.kind = 'sale' AND m.recorded_at >= @from AND m.shop_id IN (SELECT value FROM json_each(@shops))
        GROUP BY slot`,
      { shops, from: now - n * DAY },
    );
    const buckets = new Map<string, number>();
    for (let i = n - 1; i >= 0; i--) buckets.set(dayKey(now - i * DAY, org.timezone), 0);
    for (const r of rows) {
      const k = dayKey(r.slot * 900000, org.timezone);
      if (!buckets.has(k)) continue;
      buckets.set(k, buckets.get(k)! + (money ? r.value : r.pieces));
    }
    const out: SeriesPoint[] = [...buckets].map(([day, value]) => ({ day, value: Math.round(value) }));
    c.header('X-Series-Unit', money ? 'minor' : 'pieces');
    return c.json(out);
  });

  app.get('/v1/orgs/:org/reports/top-sellers', (c) => {
    const shops = reportShops(c);
    const { t } = orgOf(c);
    const money = shops.every((s) => has(c, 'reports.financial.view', s));
    // group the ledger alone first, then join the few thousand totals to their products
    const rows = t.all<{ variant_id: string; name: string; options: string | null; uom: 'piece' | 'kg' | 'l' | 'm'; qty: number; value: number }>(
      `SELECT a.variant_id, ${productNameSql('p')} AS name, v.options, p.uom, a.qty,
              (CASE WHEN p.uom = 'piece' THEN a.qp + a.unpriced * coalesce(v.price_minor, 0) ELSE (a.qp + a.unpriced * coalesce(v.price_minor, 0)) / 1000.0 END) AS value
         FROM (
           SELECT m.variant_id, -sum(m.qty_delta) AS qty,
                  sum(-m.qty_delta * coalesce(m.unit_price_minor, 0)) AS qp,
                  sum(CASE WHEN m.unit_price_minor IS NULL THEN -m.qty_delta ELSE 0 END) AS unpriced
             FROM stock_movements m
            WHERE m.org_id = @org AND m.kind = 'sale' AND m.recorded_at >= @from AND m.shop_id IN (SELECT value FROM json_each(@shops))
            GROUP BY m.variant_id
         ) a JOIN product_variants v ON v.id = a.variant_id JOIN products p ON p.id = v.product_id
        WHERE v.org_id = @org
        ORDER BY value DESC LIMIT 10`,
      { shops, from: nowOf(c) - days(c, 30) * DAY, loc: c.get('localeName') },
    );
    return c.json(rows.map((r) => ({ variantId: r.variant_id, name: variantLabel(r.name, r.options, c.get('localeName')), qty: r.qty, uom: r.uom, valueMinor: money ? Math.round(r.value) : null })));
  });

  // what customers ask for while it is out: the best hint for the next order
  app.get('/v1/orgs/:org/reports/most-wanted', (c) => {
    const shops = reportShops(c);
    const { t } = orgOf(c);
    const rows = t.all<{ variant_id: string; name: string; options: string | null; waiting: number; on_hand: number | null }>(
      `SELECT a.variant_id, ${productNameSql('p')} AS name, v.options, count(*) AS waiting,
              (SELECT sum(l.on_hand) FROM stock_levels l WHERE l.variant_id = a.variant_id AND l.shop_id IN (SELECT value FROM json_each(@shops))) AS on_hand
         FROM stock_alerts a JOIN product_variants v ON v.id = a.variant_id JOIN products p ON p.id = v.product_id
        WHERE a.org_id = @org AND a.status = 'waiting' AND (a.shop_id IS NULL OR a.shop_id IN (SELECT value FROM json_each(@shops)))
        GROUP BY a.variant_id ORDER BY waiting DESC LIMIT 20`,
      { shops, loc: c.get('localeName') },
    );
    return c.json(rows.map((r) => ({ variantId: r.variant_id, name: variantLabel(r.name, r.options, c.get('localeName')), waiting: r.waiting, onHand: r.on_hand ?? 0 })));
  });

  app.get('/v1/orgs/:org/reports/join-links', (c) => {
    const shops = new Set(reportShops(c));
    const { t, topology } = orgOf(c);
    const rows = t.all<{ id: string; label: string | null; opens: number | null; signups: number | null; confirmed: number | null }>(
      `SELECT j.id, j.label, sum(s.opens) AS opens, sum(s.signups) AS signups, sum(s.confirmed) AS confirmed
         FROM join_links j LEFT JOIN join_link_stats_daily s ON s.join_link_id = j.id AND s.day >= @since
        WHERE j.org_id = @org GROUP BY j.id ORDER BY opens DESC`,
      { since: dayKey(nowOf(c) - days(c, 30) * DAY, orgOf(c).org.timezone) },
    );
    const scopes = new Map(t.all<{ id: string; scope_type: 'org' | 'group' | 'shop'; scope_id: string }>('SELECT id, scope_type, scope_id FROM join_links WHERE org_id = @org').map((x) => [x.id, x]));
    return c.json(
      rows
        .filter((r) => {
          const l = scopes.get(r.id);
          return !!l && shopsInScope(topology, { scopeType: l.scope_type, scopeId: l.scope_id }).some((s) => shops.has(s));
        })
        .map((r) => ({ joinLinkId: r.id, label: r.label, opens: r.opens ?? 0, signups: r.signups ?? 0, confirmed: r.confirmed ?? 0 })),
    );
  });

  app.get('/v1/orgs/:org/reports/shrinkage', (c) => {
    const shops = reportShops(c);
    const { t } = orgOf(c);
    const money = shops.every((s) => has(c, 'reports.financial.view', s));
    const rows = t.all<{ reason: string; qty: number; value: number }>(
      `SELECT coalesce(m.reason, m.kind) AS reason, -sum(m.qty_delta) AS qty,
              sum(-(CASE WHEN p.uom = 'piece' THEN m.qty_delta ELSE m.qty_delta / 1000.0 END) * coalesce(m.unit_cost_minor, v.cost_minor, 0)) AS value
         FROM stock_movements m JOIN product_variants v ON v.id = m.variant_id JOIN products p ON p.id = v.product_id
        WHERE m.org_id = @org AND m.recorded_at >= @from AND m.shop_id IN (SELECT value FROM json_each(@shops))
          AND (m.kind = 'damage' OR (m.kind IN ('adjust', 'count') AND m.qty_delta < 0))
        GROUP BY coalesce(m.reason, m.kind) ORDER BY qty DESC`,
      { shops, from: nowOf(c) - days(c, 30) * DAY },
    );
    return c.json(rows.map((r) => ({ reason: r.reason, qty: r.qty, valueMinor: money ? Math.round(r.value) : null })));
  });
}
