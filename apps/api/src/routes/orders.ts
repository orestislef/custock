// orders and price requests (thinking/19-orders.md). the shop under /v1/orgs/:org/orders, the
// customer in one business's app under /v1/c/orgs/:slug/orders. every step is one conditional
// update, so two people tapping at once never both win, and a second tap on the same thing answers
// with the order as it is now.

import type { Context, Hono } from 'hono';
import {
  CLOSED_ORDER_STATUSES, OPEN_ORDER_STATUSES, OrderCreateInput, OrderCustomerCancelInput, OrderListStatus, OrderPreviewInput, OrderQuoteInput,
  OrderReasonInput, orderLineTotal, UOM_SCALE, uuidv7,
  type Order, type OrderCounts, type OrderPreview, type OrderStatus, type Uom,
} from '@custock/core';
import type { Db } from '@custock/db';
import type { AppEnv, OrgRow } from '../types';
import { audit } from '../lib/audit';
import { cfgOf, has, loadTopology, need, nowOf, ORG_COLUMNS, orgOf, readerLocale, shopsFor } from '../lib/context';
import { idempotent } from '../lib/idempotency';
import { policyIn } from '../lib/policy';
import { ApiProblem, badRequest, forbidden, notFound } from '../lib/problem';
import { clampLimit, decodeCursor, page, platform, Tenant } from '../lib/tenant';
import { effectivePrice, recordMovement } from '../services/ledger';
import { fileUrl } from '../services/catalog';
import {
  addOrderEvent, buildOrder, loadOrderRow, nextOrderNumber, ORDER_COLUMNS, orderLimits, orderMode, orderShops, orderSummaries,
  expireOrder, tellCustomer, tellShopAnswer, tellShopNewOrder, type OrderRow, type OrderViewer,
} from '../services/orders';
import { followingOf } from './customer';

const DAY = 86_400_000;
const conflict = (detail = 'the order changed meanwhile') => new ApiProblem(409, 'conflict', detail);
const ordersOff = () => new ApiProblem(403, 'orders_off', 'this business or shop takes no orders');

function statusFilter(raw: string | undefined): OrderStatus[] | null {
  if (!raw) return null;
  const s = OrderListStatus.parse(raw);
  if (s === 'open') return [...OPEN_ORDER_STATUSES];
  if (s === 'closed') return [...CLOSED_ORDER_STATUSES];
  return [s];
}

// ---------------------------------------------------------------- the shop

function staffViewer(c: Context<AppEnv>): OrderViewer {
  return { side: 'staff', locale: readerLocale(c, orgOf(c).org.default_locale), can: (perm, shopId) => has(c, perm, shopId) };
}

// an order the caller may see: orders.view at its shop. anything else is not found
function visibleOrder(c: Context<AppEnv>, id: string): OrderRow {
  const row = loadOrderRow(orgOf(c).t, id);
  if (!row || !has(c, 'orders.view', row.shop_id)) throw notFound('order');
  return row;
}

// moves an order from one of `from` to `to` with one conditional update. the same step twice
// answers with the order as it is; a step that no longer fits is a conflict
function step(
  c: Context<AppEnv>,
  id: string,
  perm: string,
  from: readonly OrderStatus[],
  to: OrderStatus,
  apply: (row: OrderRow, t: Tenant, now: number) => Record<string, unknown> | void,
): { before: OrderRow; after: OrderRow; changed: boolean } {
  const { t } = orgOf(c);
  const before = visibleOrder(c, id);
  need(c, perm, before.shop_id);
  if (before.status === to) return { before, after: before, changed: false };
  if (!from.includes(before.status)) throw conflict(`the order is ${before.status}`);
  const now = nowOf(c);
  cfgOf(c).db.transaction(() => {
    const final = (CLOSED_ORDER_STATUSES as readonly string[]).includes(to);
    const done = t.run(
      `UPDATE orders SET status = @to, updated_at = max(updated_at + 1, @now), closed_at = CASE WHEN @final THEN @now ELSE closed_at END
        WHERE org_id = @org AND id = @id AND status = @was`,
      { to, now, final, id, was: before.status },
    );
    if (!done.changes) throw conflict();
    const extra = apply(before, t, now);
    if (extra && Object.keys(extra).length) {
      const cols = Object.keys(extra).map((k) => `${k} = @${k}`).join(', ');
      t.run(`UPDATE orders SET ${cols} WHERE org_id = @org AND id = @id`, { ...extra, id });
    }
  })();
  return { before, after: loadOrderRow(t, id)!, changed: true };
}

function staffAudit(c: Context<AppEnv>, action: 'order.quoted' | 'order.confirmed' | 'order.declined' | 'order.ready' | 'order.completed' | 'order.cancelled', row: OrderRow, after: unknown) {
  audit(orgOf(c).t, { id: c.get('user').id }, action, { type: 'order', id: row.id }, { number: row.number, status: row.status }, after, nowOf(c));
}

const customerNameOf = (t: Tenant, customerId: string) => t.get<{ name: string | null }>('SELECT name FROM customers WHERE org_id = @org AND id = @c AND erased_at IS NULL', { c: customerId })?.name ?? null;

export function orderRoutes(app: Hono<AppEnv>) {
  app.get('/v1/orgs/:org/orders', (c) => {
    need(c, 'orders.view');
    const { t } = orgOf(c);
    const q = c.req.query();
    const shops = shopsFor(c, 'orders.view', q.shopId || null);
    const statuses = statusFilter(q.status);
    const limit = clampLimit(q.limit, 50, 200);
    const offset = decodeCursor(q.cursor);
    const rows = t.all<OrderRow>(
      `SELECT ${ORDER_COLUMNS} FROM orders WHERE org_id = @org AND shop_id IN (SELECT value FROM json_each(@shops))
         AND (@statuses IS NULL OR status IN (SELECT value FROM json_each(@statuses)))
       ORDER BY updated_at DESC, id DESC LIMIT @lim OFFSET @off`,
      { shops, statuses: statuses ? JSON.stringify(statuses) : null, lim: limit + 1, off: offset },
    );
    return c.json(page(orderSummaries(t, rows, staffViewer(c)), offset, limit));
  });

  app.get('/v1/orgs/:org/orders/counts', (c) => {
    need(c, 'orders.view');
    const shops = shopsFor(c, 'orders.view', c.req.query('shopId') || null);
    const out: OrderCounts = { requested: 0, quoted: 0, confirmed: 0, ready: 0 };
    for (const r of orgOf(c).t.all<{ status: keyof OrderCounts; n: number }>(
      `SELECT status, count(*) AS n FROM orders WHERE org_id = @org AND status IN ('requested', 'quoted', 'confirmed', 'ready')
          AND shop_id IN (SELECT value FROM json_each(@shops)) GROUP BY status`,
      { shops },
    )) out[r.status] = r.n;
    return c.json(out);
  });

  app.get('/v1/orgs/:org/orders/:id', (c) => {
    const row = visibleOrder(c, c.req.param('id'));
    c.header('ETag', `W/"order-${row.updated_at}"`);
    return c.json(buildOrder(cfgOf(c).db, orgOf(c).t, row, staffViewer(c)));
  });

  // a price for every line. quantities may change (only 8 left). the customer answers
  app.post('/v1/orgs/:org/orders/:id/quote', async (c) => {
    const input = OrderQuoteInput.parse(await c.req.json());
    const id = c.req.param('id');
    const { t, org } = orgOf(c);
    const before = visibleOrder(c, id);
    need(c, 'orders.quote', before.shop_id);
    if (before.status !== 'requested' && before.status !== 'quoted') throw conflict(`the order is ${before.status}`);
    const lines = t.all<{ line_no: number; uom: Uom; qty: number; unit_price_minor: number | null }>(
      'SELECT line_no, uom, qty, unit_price_minor FROM order_lines WHERE org_id = @org AND order_id = @o ORDER BY line_no',
      { o: id },
    );
    const given = new Map(input.lines.map((l) => [l.lineNo, l]));
    if (given.size !== input.lines.length || lines.length !== given.size || lines.some((l) => !given.has(l.line_no))) {
      throw badRequest('every line needs a price, once', { lines: 'invalid' });
    }
    const now = nowOf(c);
    const maxQty = Number(policyIn(cfgOf(c).db, org.id, 'orders.maxQty'));
    for (const l of lines) {
      const q = given.get(l.line_no)!.qty;
      if (q != null && q > maxQty * UOM_SCALE[l.uom]) throw new ApiProblem(403, 'limit_reached', `at most ${maxQty} of one product`);
    }
    const days = Number(policyIn(cfgOf(c).db, org.id, 'orders.quoteDays'));
    const validUntil = input.validUntil ?? now + days * DAY;
    if (validUntil <= now || validUntil > now + 60 * DAY) throw badRequest('the price must hold for a while, at most 60 days', { validUntil: 'invalid' });
    const changed: number[] = [];
    let total = 0;
    const priced = lines.map((l) => {
      const g = given.get(l.line_no)!;
      const qty = g.qty ?? l.qty;
      if (qty !== l.qty || g.unitPriceMinor !== l.unit_price_minor) changed.push(l.line_no);
      const lineTotal = orderLineTotal(g.unitPriceMinor, qty, l.uom);
      total += lineTotal;
      return { lineNo: l.line_no, qty, unit: g.unitPriceMinor, lineTotal, note: g.note };
    });
    cfgOf(c).db.transaction(() => {
      const done = t.run(
        `UPDATE orders SET status = 'quoted', total_minor = @total, quote_valid_until = @until, quote_message = @msg, quoted_by = @u, quoted_at = @now,
                updated_at = max(updated_at + 1, @now)
          WHERE org_id = @org AND id = @id AND status = @was`,
        { total, until: validUntil, msg: input.message ?? null, u: c.get('user').id, now, id, was: before.status },
      );
      if (!done.changes) throw conflict();
      for (const l of priced) {
        t.run(
          `UPDATE order_lines SET qty = @qty, unit_price_minor = @unit, line_total_minor = @total, note = CASE WHEN @setNote THEN @note ELSE note END
            WHERE org_id = @org AND order_id = @o AND line_no = @n`,
          { qty: l.qty, unit: l.unit, total: l.lineTotal, setNote: l.note !== undefined, note: l.note ?? null, o: id, n: l.lineNo },
        );
      }
      addOrderEvent(t, id, { type: 'staff', id: c.get('user').id }, 'quoted', { total, previousTotal: before.total_minor, message: input.message ?? null, changedLines: changed }, now, uuidv7(now));
      staffAudit(c, 'order.quoted', before, { total, validUntil });
    })();
    const after = loadOrderRow(t, id)!;
    tellCustomer(cfgOf(c).db, cfgOf(c).publicWebUrl, after, 'quote', { push: true, email: true });
    return c.json(buildOrder(cfgOf(c).db, t, after, staffViewer(c)));
  });

  // a priced order as it is: nothing changed, so the customer already agreed
  app.post('/v1/orgs/:org/orders/:id/confirm', (c) => {
    const id = c.req.param('id');
    const { t } = orgOf(c);
    const row = visibleOrder(c, id);
    need(c, 'orders.quote', row.shop_id);
    if (row.status === 'requested') {
      const missing = t.get('SELECT 1 FROM order_lines WHERE org_id = @org AND order_id = @o AND unit_price_minor IS NULL', { o: id });
      if (!row.priced || missing) throw conflict('this order needs a price first');
    }
    const r = step(c, id, 'orders.quote', ['requested'], 'confirmed', (b, tt, now) => {
      addOrderEvent(tt, id, { type: 'staff', id: c.get('user').id }, 'confirmed', { total: b.total_minor }, now, uuidv7(now));
      staffAudit(c, 'order.confirmed', b, { total: b.total_minor });
    });
    if (r.changed) tellCustomer(cfgOf(c).db, cfgOf(c).publicWebUrl, r.after, 'confirmed', { push: true, email: true });
    return c.json(buildOrder(cfgOf(c).db, t, r.after, staffViewer(c)));
  });

  app.post('/v1/orgs/:org/orders/:id/decline', async (c) => {
    const { reason } = OrderReasonInput.parse(await c.req.json());
    const id = c.req.param('id');
    const r = step(c, id, 'orders.quote', ['requested'], 'declined', (b, tt, now) => {
      addOrderEvent(tt, id, { type: 'staff', id: c.get('user').id }, 'declined', { reason }, now, uuidv7(now));
      staffAudit(c, 'order.declined', b, { reason });
      return { cancel_reason: reason };
    });
    if (r.changed) tellCustomer(cfgOf(c).db, cfgOf(c).publicWebUrl, r.after, 'declined', { push: true, email: true });
    return c.json(buildOrder(cfgOf(c).db, orgOf(c).t, r.after, staffViewer(c)));
  });

  app.post('/v1/orgs/:org/orders/:id/ready', (c) => {
    const id = c.req.param('id');
    const r = step(c, id, 'orders.fulfil', ['confirmed'], 'ready', (b, tt, now) => {
      addOrderEvent(tt, id, { type: 'staff', id: c.get('user').id }, 'ready', null, now, uuidv7(now));
      staffAudit(c, 'order.ready', b, null);
    });
    if (r.changed) tellCustomer(cfgOf(c).db, cfgOf(c).publicWebUrl, r.after, 'ready', { push: true, email: true });
    return c.json(buildOrder(cfgOf(c).db, orgOf(c).t, r.after, staffViewer(c)));
  });

  // picked up. the stock goes down as sales in that shop (policy orders.takeStock), at the agreed
  // prices, so reports and the ledger see it like any sale
  app.post('/v1/orgs/:org/orders/:id/complete', (c) => {
    const id = c.req.param('id');
    const o = orgOf(c);
    const db = cfgOf(c).db;
    const r = step(c, id, 'orders.fulfil', ['confirmed', 'ready'], 'completed', (b, tt, now) => {
      if (policyIn(db, o.org.id, 'orders.takeStock', { shopId: b.shop_id }) === true) {
        const lines = tt.all<{ variant_id: string; qty: number; unit_price_minor: number | null; track_stock: number }>(
          `SELECT l.variant_id, l.qty, l.unit_price_minor, p.track_stock FROM order_lines l JOIN products p ON p.id = l.product_id
            WHERE l.org_id = @org AND l.order_id = @o ORDER BY l.line_no`,
          { o: id },
        );
        const ctx = { db, t: tt, org: o.org, topology: o.topology, userId: c.get('user').id, now, can: (perm: string, shopId: string) => has(c, perm, shopId) };
        for (const l of lines) {
          if (!l.track_stock) continue;
          const out = recordMovement(ctx, {
            id: uuidv7(now), shopId: b.shop_id, variantId: l.variant_id, qtyDelta: -l.qty, kind: 'sale', occurredAt: now,
            refType: 'order', refId: id, ...(l.unit_price_minor != null ? { unitPriceMinor: l.unit_price_minor } : {}),
          }, { internal: true });
          if (out.status === 'rejected') throw new ApiProblem(409, out.code, `a line of order ${b.number} could not be taken off the stock`);
        }
      }
      addOrderEvent(tt, id, { type: 'staff', id: c.get('user').id }, 'completed', { total: b.total_minor }, now, uuidv7(now));
      staffAudit(c, 'order.completed', b, { total: b.total_minor });
    });
    return c.json(buildOrder(db, o.t, r.after, staffViewer(c)));
  });

  app.post('/v1/orgs/:org/orders/:id/cancel', async (c) => {
    const { reason } = OrderReasonInput.parse(await c.req.json());
    const id = c.req.param('id');
    const r = step(c, id, 'orders.quote', ['requested', 'quoted', 'confirmed', 'ready'], 'cancelled', (b, tt, now) => {
      addOrderEvent(tt, id, { type: 'staff', id: c.get('user').id }, 'cancelled', { reason }, now, uuidv7(now));
      staffAudit(c, 'order.cancelled', b, { reason });
      return { cancel_reason: reason };
    });
    if (r.changed) tellCustomer(cfgOf(c).db, cfgOf(c).publicWebUrl, r.after, 'cancelled', { push: true, email: true });
    return c.json(buildOrder(cfgOf(c).db, orgOf(c).t, r.after, staffViewer(c)));
  });

  // ---------------------------------------------------------------- the customer

  // the business by its web address, and the caller's customer records in it (following it)
  function customerSide(c: Context<AppEnv>): { db: Db; org: OrgRow; t: Tenant; customerIds: string[]; viewer: OrderViewer } {
    const db = cfgOf(c).db;
    const org = platform(db).get<OrgRow>(`SELECT ${ORG_COLUMNS} FROM organizations WHERE slug = @s AND archived_at IS NULL`, { s: c.req.param('slug') });
    if (!org) throw notFound('organization');
    const f = followingOf(db, c.get('user').id).find((x) => x.org.id === org.id);
    if (!f?.customerIds.length) throw forbidden('follow this business to order');
    return { db, org, t: new Tenant(db, org.id), customerIds: f.customerIds, viewer: { side: 'customer', locale: readerLocale(c, org.default_locale) } };
  }

  function myOrderRow(s: ReturnType<typeof customerSide>, id: string): OrderRow {
    const row = s.t.get<OrderRow>(
      `SELECT ${ORDER_COLUMNS} FROM orders WHERE org_id = @org AND id = @id AND customer_id IN (SELECT value FROM json_each(@cs))`,
      { id, cs: s.customerIds },
    );
    if (!row) throw notFound('order');
    return row;
  }

  // the lines as they would go in at this shop now: prices, names, and what can not be ordered
  function priceLines(s: ReturnType<typeof customerSide>, shopId: string, lines: { variantId: string; qty: number }[], now: number) {
    const { db, org, t } = s;
    const { topology } = loadTopology(db, org.id);
    const pricesShown = !!org.customer_prices;
    const maxQty = Number(policyIn(db, org.id, 'orders.maxQty'));
    const loc = s.viewer.locale;
    return lines.map((l) => {
      const v = t.get<{ product_id: string; name: string; uom: Uom; tax_rate_bp: number; archived: number; visible: number; storage_key: string | null; local_name: string | null }>(
        `SELECT v.product_id, p.name, p.uom, p.tax_rate_bp, (p.archived_at IS NOT NULL OR v.archived_at IS NOT NULL) AS archived, p.customer_visible AS visible,
                (SELECT f.storage_key FROM product_images i JOIN files f ON f.id = i.file_id WHERE i.product_id = p.id AND f.deleted_at IS NULL ORDER BY i.sort LIMIT 1) AS storage_key,
                (SELECT tr.name FROM product_translations tr WHERE tr.product_id = p.id AND tr.locale = @loc) AS local_name
           FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.org_id = @org AND v.id = @v`,
        { v: l.variantId, loc },
      );
      const gone = !v || !!v.archived || !v.visible;
      const unit = !gone && pricesShown ? effectivePrice(t, topology, l.variantId, shopId, now) : null;
      const uom: Uom = v?.uom ?? 'piece';
      return {
        variantId: l.variantId, productId: v?.product_id ?? null, name: v ? v.local_name ?? v.name : '', rawName: v?.name ?? '', imageUrl: fileUrl(v?.storage_key),
        uom, taxRateBp: v?.tax_rate_bp ?? 0, qty: l.qty, unitPriceMinor: unit, lineTotalMinor: unit != null ? orderLineTotal(unit, l.qty, uom) : null,
        problem: gone ? ('unavailable' as const) : l.qty > maxQty * UOM_SCALE[uom] ? ('too_many' as const) : null,
      };
    });
  }

  // the same product twice becomes one line
  function mergeLines<T extends { variantId: string; qty: number }>(lines: T[]): T[] {
    const out = new Map<string, T>();
    for (const l of lines) {
      const had = out.get(l.variantId);
      out.set(l.variantId, had ? { ...had, qty: had.qty + l.qty } : { ...l });
    }
    return [...out.values()];
  }

  function openShop(s: ReturnType<typeof customerSide>, shopId: string) {
    if (orderMode(s.db, s.org) === 'off') throw ordersOff();
    if (!orderShops(s.db, s.org).some((x) => x.id === shopId)) throw ordersOff();
  }

  const openCount = (s: ReturnType<typeof customerSide>) =>
    s.t.get<{ n: number }>(
      `SELECT count(*) AS n FROM orders WHERE org_id = @org AND customer_id IN (SELECT value FROM json_each(@cs))
          AND status IN ('requested', 'quoted', 'confirmed', 'ready')`,
      { cs: s.customerIds },
    )!.n;

  app.post('/v1/c/orgs/:slug/orders/preview', async (c) => {
    const input = OrderPreviewInput.parse(await c.req.json());
    const s = customerSide(c);
    openShop(s, input.shopId);
    const limits = orderLimits(s.db, s.org.id);
    const lines = priceLines(s, input.shopId, mergeLines(input.lines), nowOf(c));
    const priced = orderMode(s.db, s.org) === 'priced' && !!s.org.customer_prices && lines.every((l) => l.unitPriceMinor != null);
    const out: OrderPreview = {
      shopId: input.shopId, priced, currency: s.org.currency,
      lines: lines.map(({ rawName: _r, taxRateBp: _t, ...l }) => ({ ...l, unitPriceMinor: priced ? l.unitPriceMinor : null, lineTotalMinor: priced ? l.lineTotalMinor : null })),
      totalMinor: priced ? lines.reduce((a, l) => a + (l.lineTotalMinor ?? 0), 0) : null,
      limits: { maxLines: limits.maxLines, maxQty: limits.maxQty, openLeft: Math.max(0, limits.openPerCustomer - openCount(s)) },
    };
    return c.json(out);
  });

  app.post('/v1/c/orgs/:slug/orders', async (c) => {
    const input = OrderCreateInput.parse(await c.req.json());
    const s = customerSide(c);
    openShop(s, input.shopId);
    return idempotent(c, () => {
      const now = nowOf(c);
      const limits = orderLimits(s.db, s.org.id);
      const merged = mergeLines(input.lines);
      if (merged.length > limits.maxLines) throw new ApiProblem(403, 'limit_reached', `at most ${limits.maxLines} products in one order`);
      if (openCount(s) >= limits.openPerCustomer) throw new ApiProblem(403, 'limit_reached', `at most ${limits.openPerCustomer} open orders`);
      const lines = priceLines(s, input.shopId, merged, now);
      const fields: Record<string, string> = {};
      lines.forEach((l, i) => { if (l.problem === 'unavailable') fields[`lines.${i}.variantId`] = 'unavailable'; });
      if (Object.keys(fields).length) throw badRequest('a product can not be ordered', fields);
      if (lines.some((l) => l.problem === 'too_many')) throw new ApiProblem(403, 'limit_reached', `at most ${limits.maxQty} of one product`);
      const priced = orderMode(s.db, s.org) === 'priced' && !!s.org.customer_prices && lines.every((l) => l.unitPriceMinor != null);
      // what the app showed must still be the price, else the customer looks again first
      if (priced && merged.some((m, i) => m.seenUnitPriceMinor !== lines[i]!.unitPriceMinor)) {
        throw new ApiProblem(409, 'prices_changed', 'a price changed since it was shown, preview again');
      }
      const total = priced ? lines.reduce((a, l) => a + (l.lineTotalMinor ?? 0), 0) : null;
      const id = uuidv7(now);
      const { t } = s;
      const customerId = s.customerIds[0]!;
      const locale = t.get<{ locale: string }>('SELECT locale FROM customers WHERE org_id = @org AND id = @c', { c: customerId })?.locale ?? s.org.default_locale;
      s.db.transaction(() => {
        const number = nextOrderNumber(t);
        t.run(
          `INSERT INTO orders (id, org_id, shop_id, number, customer_id, status, priced, note, wanted_on, locale, currency, total_minor, created_at, updated_at)
           VALUES (@id, @org, @shop, @number, @c, 'requested', @priced, @note, @wanted, @locale, @currency, @total, @now, @now)`,
          { id, shop: input.shopId, number, c: customerId, priced, note: input.note || null, wanted: input.wantedOn ?? null, locale, currency: s.org.currency, total, now },
        );
        lines.forEach((l, i) => {
          t.run(
            `INSERT INTO order_lines (order_id, org_id, line_no, variant_id, product_id, product_name, uom, tax_rate_bp, qty, requested_qty, unit_price_minor, line_total_minor, note)
             VALUES (@o, @org, @n, @v, @p, @name, @uom, @tax, @qty, @qty, @unit, @total, @note)`,
            {
              o: id, n: i + 1, v: l.variantId, p: l.productId, name: l.rawName, uom: l.uom, tax: l.taxRateBp, qty: l.qty,
              unit: priced ? l.unitPriceMinor : null, total: priced ? l.lineTotalMinor : null, note: merged[i]!.note ?? null,
            },
          );
        });
        addOrderEvent(t, id, { type: 'customer', id: customerId }, 'requested', { total }, now, uuidv7(now));
      })();
      const row = loadOrderRow(t, id)!;
      tellShopNewOrder(s.db, row, customerNameOf(t, customerId));
      tellCustomer(s.db, cfgOf(c).publicWebUrl, row, 'received', { push: false, email: true });
      return { status: 201, body: buildOrder(s.db, t, row, s.viewer) };
    });
  });

  app.get('/v1/c/orgs/:slug/orders', (c) => {
    const s = customerSide(c);
    const q = c.req.query();
    const statuses = statusFilter(q.status);
    const limit = clampLimit(q.limit, 20, 100);
    const offset = decodeCursor(q.cursor);
    const rows = s.t.all<OrderRow>(
      `SELECT ${ORDER_COLUMNS} FROM orders WHERE org_id = @org AND customer_id IN (SELECT value FROM json_each(@cs))
         AND (@statuses IS NULL OR status IN (SELECT value FROM json_each(@statuses)))
       ORDER BY created_at DESC, id DESC LIMIT @lim OFFSET @off`,
      { cs: s.customerIds, statuses: statuses ? JSON.stringify(statuses) : null, lim: limit + 1, off: offset },
    );
    return c.json(page(orderSummaries(s.t, rows, s.viewer), offset, limit));
  });

  app.get('/v1/c/orgs/:slug/orders/:id', (c) => {
    const s = customerSide(c);
    return c.json(buildOrder(s.db, s.t, myOrderRow(s, c.req.param('id')), s.viewer));
  });

  // the customer's answers. same step twice answers with the order as it is
  function customerStep(c: Context<AppEnv>, from: readonly OrderStatus[], to: OrderStatus, kind: 'accepted' | 'rejected' | 'cancelled', reason: string | null): Order {
    const s = customerSide(c);
    const before = myOrderRow(s, c.req.param('id') ?? '');
    if (before.status === to) return buildOrder(s.db, s.t, before, s.viewer);
    if (!from.includes(before.status)) throw conflict(`the order is ${before.status}`);
    const now = nowOf(c);
    if (before.status === 'quoted' && kind === 'accepted' && before.quote_valid_until != null && before.quote_valid_until <= now) {
      expireOrder(s.db, cfgOf(c).publicWebUrl, before, now);
      throw new ApiProblem(410, 'quote_expired', 'the price ran out');
    }
    s.db.transaction(() => {
      const final = (CLOSED_ORDER_STATUSES as readonly string[]).includes(to);
      const done = s.t.run(
        `UPDATE orders SET status = @to, updated_at = max(updated_at + 1, @now), closed_at = CASE WHEN @final THEN @now ELSE closed_at END,
                cancel_reason = CASE WHEN @reason IS NOT NULL THEN @reason ELSE cancel_reason END
          WHERE org_id = @org AND id = @id AND status = @was`,
        { to, now, final, reason, id: before.id, was: before.status },
      );
      if (!done.changes) throw conflict();
      addOrderEvent(s.t, before.id, { type: 'customer', id: before.customer_id }, kind, { total: before.total_minor, reason }, now, uuidv7(now));
    })();
    const after = loadOrderRow(s.t, before.id)!;
    // the shop hears the answer to a price; a cancel of an order nobody priced yet goes to the shop too
    tellShopAnswer(s.db, after, customerNameOf(s.t, before.customer_id), kind === 'accepted' ? 'Accepted' : kind === 'rejected' ? 'Rejected' : 'Cancelled');
    return buildOrder(s.db, s.t, after, s.viewer);
  }

  app.post('/v1/c/orgs/:slug/orders/:id/accept', (c) => c.json(customerStep(c, ['quoted'], 'confirmed', 'accepted', null)));
  app.post('/v1/c/orgs/:slug/orders/:id/reject', (c) => c.json(customerStep(c, ['quoted'], 'rejected', 'rejected', null)));
  app.post('/v1/c/orgs/:slug/orders/:id/cancel', async (c) => {
    const { reason } = OrderCustomerCancelInput.parse(await c.req.json().catch(() => ({})));
    return c.json(customerStep(c, ['requested', 'quoted'], 'cancelled', 'cancelled', reason ?? null));
  });
}
