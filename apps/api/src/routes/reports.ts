// dashboard and reports. money only with reports.financial.view, days in the org timezone.

import type { Context, Hono } from 'hono';
import type { DashboardCards, SeriesPoint } from '@custock/core';
import type { AppEnv } from '../types';
import { has, need, nowOf, orgOf, shopsFor } from '../lib/context';
import { variantLabel } from '../services/catalog';
import { canSee, customerVisibility, loadSubscriptions, reachedShops } from '../services/customers';

const DAY = 86_400_000;

export function dayKey(ts: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ts));
}

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

export function reportRoutes(app: Hono<AppEnv>) {
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
      const subs = loadSubscriptions(c);
      const recent = t.all<{ id: string }>('SELECT id FROM customers WHERE org_id = @org AND erased_at IS NULL AND created_at > @since', { since: now - 7 * DAY });
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
      scheduledPosts: has(c, 'posts.view') ? count("SELECT count(*) AS n FROM posts WHERE org_id = @org AND status = 'scheduled' AND deleted_at IS NULL", {}) : 0,
      pendingApprovals: has(c, 'posts.publish') ? count("SELECT count(*) AS n FROM posts WHERE org_id = @org AND status = 'pending_approval' AND deleted_at IS NULL", {}) : 0,
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
    const rows = t.all<{ recorded_at: number; qty_delta: number; uom: string; price: number }>(
      `SELECT m.recorded_at, m.qty_delta, p.uom, coalesce(m.unit_price_minor, v.price_minor, 0) AS price
         FROM stock_movements m JOIN product_variants v ON v.id = m.variant_id JOIN products p ON p.id = v.product_id
        WHERE m.org_id = @org AND m.kind = 'sale' AND m.recorded_at >= @from AND m.shop_id IN (SELECT value FROM json_each(@shops))`,
      { shops, from: now - n * DAY },
    );
    const buckets = new Map<string, number>();
    for (let i = n - 1; i >= 0; i--) buckets.set(dayKey(now - i * DAY, org.timezone), 0);
    for (const r of rows) {
      const k = dayKey(r.recorded_at, org.timezone);
      if (!buckets.has(k)) continue;
      const u = -units(r.qty_delta, r.uom);
      buckets.set(k, buckets.get(k)! + (money ? u * r.price : r.uom === 'piece' ? u : 0));
    }
    const out: SeriesPoint[] = [...buckets].map(([day, value]) => ({ day, value: Math.round(value) }));
    c.header('X-Series-Unit', money ? 'minor' : 'pieces');
    return c.json(out);
  });

  app.get('/v1/orgs/:org/reports/top-sellers', (c) => {
    const shops = reportShops(c);
    const { t } = orgOf(c);
    const money = shops.every((s) => has(c, 'reports.financial.view', s));
    const rows = t.all<{ variant_id: string; name: string; options: string | null; qty: number; value: number }>(
      `SELECT m.variant_id, p.name, v.options, -sum(m.qty_delta) AS qty,
              sum(-(CASE WHEN p.uom = 'piece' THEN m.qty_delta ELSE m.qty_delta / 1000.0 END) * coalesce(m.unit_price_minor, v.price_minor, 0)) AS value
         FROM stock_movements m JOIN product_variants v ON v.id = m.variant_id JOIN products p ON p.id = v.product_id
        WHERE m.org_id = @org AND m.kind = 'sale' AND m.recorded_at >= @from AND m.shop_id IN (SELECT value FROM json_each(@shops))
        GROUP BY m.variant_id ORDER BY value DESC LIMIT 10`,
      { shops, from: nowOf(c) - days(c, 30) * DAY },
    );
    return c.json(rows.map((r) => ({ variantId: r.variant_id, name: variantLabel(r.name, r.options, c.get('locale')), qty: r.qty, valueMinor: money ? Math.round(r.value) : null })));
  });

  // what customers ask for while it is out: the best hint for the next order
  app.get('/v1/orgs/:org/reports/most-wanted', (c) => {
    const shops = reportShops(c);
    const { t } = orgOf(c);
    const rows = t.all<{ variant_id: string; name: string; options: string | null; waiting: number; on_hand: number | null }>(
      `SELECT a.variant_id, p.name, v.options, count(*) AS waiting,
              (SELECT sum(l.on_hand) FROM stock_levels l WHERE l.variant_id = a.variant_id AND l.shop_id IN (SELECT value FROM json_each(@shops))) AS on_hand
         FROM stock_alerts a JOIN product_variants v ON v.id = a.variant_id JOIN products p ON p.id = v.product_id
        WHERE a.org_id = @org AND a.status = 'waiting' AND (a.shop_id IS NULL OR a.shop_id IN (SELECT value FROM json_each(@shops)))
        GROUP BY a.variant_id ORDER BY waiting DESC LIMIT 20`,
      { shops },
    );
    return c.json(rows.map((r) => ({ variantId: r.variant_id, name: variantLabel(r.name, r.options, c.get('locale')), waiting: r.waiting, onHand: r.on_hand ?? 0 })));
  });

  app.get('/v1/orgs/:org/reports/join-links', (c) => {
    reportShops(c);
    const { t } = orgOf(c);
    const rows = t.all<{ id: string; label: string | null; opens: number | null; signups: number | null; confirmed: number | null }>(
      `SELECT j.id, j.label, sum(s.opens) AS opens, sum(s.signups) AS signups, sum(s.confirmed) AS confirmed
         FROM join_links j LEFT JOIN join_link_stats_daily s ON s.join_link_id = j.id AND s.day >= @since
        WHERE j.org_id = @org GROUP BY j.id ORDER BY opens DESC`,
      { since: dayKey(nowOf(c) - days(c, 30) * DAY, orgOf(c).org.timezone) },
    );
    return c.json(rows.map((r) => ({ joinLinkId: r.id, label: r.label, opens: r.opens ?? 0, signups: r.signups ?? 0, confirmed: r.confirmed ?? 0 })));
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
