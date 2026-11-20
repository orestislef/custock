// orders and price requests (thinking/19-orders.md): reading an order for the shop or for the
// customer, what each side may do next, what confirmed and ready orders hold of a product, and the
// messages each step sends.

import {
  formatMoney, formatQty, intlLocale, maskEmail, maskPhone, PROMISED_ORDER_STATUSES, uuidv7,
  type Order, type OrderAction, type OrderEvent, type OrderEventKind, type OrderHold, type OrderLine, type OrderStatus, type OrderSummary,
  type PublicOrderOptions, type Uom,
} from '@custock/core';
import type { Db } from '@custock/db';
import { pickLocale, translator, type AppLocale } from '@custock/i18n';
import type { OrgRow } from '../types';
import { parseJson, platform, Tenant } from '../lib/tenant';
import { orgFeatureOn } from '../lib/platform-access';
import { policyIn } from '../lib/policy';
import { devOutboxTransport, emailMessage } from '../lib/transport';
import { pushReachableSql } from '../lib/webpush';
import { notifyMembers, notifyUser } from '../lib/notify';
import { fileUrl, orgLogoUrl } from './catalog';
import { orderEmail, type OrderMailEvent } from '../email/messages';

export interface OrderRow {
  id: string;
  org_id: string;
  shop_id: string;
  number: number;
  customer_id: string;
  status: OrderStatus;
  priced: number;
  note: string | null;
  wanted_on: string | null;
  locale: AppLocale;
  currency: string;
  total_minor: number | null;
  quote_valid_until: number | null;
  quote_message: string | null;
  quoted_by: string | null;
  quoted_at: number | null;
  cancel_reason: string | null;
  created_at: number;
  updated_at: number;
  closed_at: number | null;
}

export interface LineRow {
  line_no: number;
  variant_id: string;
  product_id: string;
  product_name: string;
  uom: Uom;
  tax_rate_bp: number;
  qty: number;
  requested_qty: number;
  unit_price_minor: number | null;
  line_total_minor: number | null;
  note: string | null;
}

export const ORDER_COLUMNS = `id, org_id, shop_id, number, customer_id, status, priced, note, wanted_on, locale, currency, total_minor,
  quote_valid_until, quote_message, quoted_by, quoted_at, cancel_reason, created_at, updated_at, closed_at`;

const PROMISED_SQL = `(${PROMISED_ORDER_STATUSES.map((s) => `'${s}'`).join(', ')})`;

// ---------------------------------------------------------------- settings

// the mode in force: the business setting, off when the super admin switched orders off
export function orderMode(db: Db, org: OrgRow): OrgRow['customer_orders'] {
  return orgFeatureOn(db, org.id, 'orders') ? org.customer_orders : 'off';
}

// the shops a customer can order from: shown to customers, open, not switched off
export function orderShops(db: Db, org: OrgRow): { id: string; name: string; address: string | null; city: string | null }[] {
  if (orderMode(db, org) === 'off') return [];
  return new Tenant(db, org.id).all<{ id: string; name: string; address: string | null; city: string | null }>(
    `SELECT id, name, address, city FROM shops WHERE org_id = @org AND archived_at IS NULL AND customer_visible = 1 AND customer_orders IS NULL
      ORDER BY created_at, name`,
  );
}

export function orderLimits(db: Db, orgId: string) {
  return {
    maxLines: Number(policyIn(db, orgId, 'orders.maxLines')),
    maxQty: Number(policyIn(db, orgId, 'orders.maxQty')),
    openPerCustomer: Number(policyIn(db, orgId, 'orders.openPerCustomer')),
  };
}

export function orderOptions(db: Db, org: OrgRow): PublicOrderOptions {
  const shops = orderShops(db, org);
  const mode = shops.length ? orderMode(db, org) : 'off';
  return { mode, pricesShown: !!org.customer_prices, shops, limits: orderLimits(db, org.id) };
}

// ---------------------------------------------------------------- reading

export function loadOrderRow(t: Tenant, id: string): OrderRow | undefined {
  return t.get<OrderRow>(`SELECT ${ORDER_COLUMNS} FROM orders WHERE org_id = @org AND id = @id`, { id });
}

function linesOf(t: Tenant, orderId: string): LineRow[] {
  return t.all<LineRow>(
    `SELECT line_no, variant_id, product_id, product_name, uom, tax_rate_bp, qty, requested_qty, unit_price_minor, line_total_minor, note
       FROM order_lines WHERE org_id = @org AND order_id = @o ORDER BY line_no`,
    { o: orderId },
  );
}

// what confirmed or ready orders of these shops hold of these variants, shop|variant -> qty
export function promisedQty(t: Tenant, shopIds: readonly string[], variantIds: readonly string[], exceptOrderId: string | null = null): Map<string, number> {
  const out = new Map<string, number>();
  if (!shopIds.length || !variantIds.length) return out;
  for (const r of t.all<{ shop_id: string; variant_id: string; qty: number }>(
    `SELECT o.shop_id, l.variant_id, sum(l.qty) AS qty FROM order_lines l JOIN orders o ON o.id = l.order_id
      WHERE l.org_id = @org AND l.variant_id IN (SELECT value FROM json_each(@vs))
        AND o.shop_id IN (SELECT value FROM json_each(@shops)) AND o.status IN ${PROMISED_SQL}
        AND (@except IS NULL OR o.id != @except)
      GROUP BY o.shop_id, l.variant_id`,
    { vs: [...variantIds], shops: [...shopIds], except: exceptOrderId },
  )) out.set(`${r.shop_id}|${r.variant_id}`, r.qty);
  return out;
}

// the confirmed or ready orders holding these variants at these shops, oldest first. names only
// for shops in namesAt (customers.view there)
export function orderHolds(t: Tenant, shopIds: readonly string[], variantIds: readonly string[], namesAt: ReadonlySet<string>): OrderHold[] {
  if (!shopIds.length || !variantIds.length) return [];
  return t
    .all<{ shop_id: string; variant_id: string; id: string; number: number; qty: number; status: OrderStatus; wanted_on: string | null; name: string | null; erased: number }>(
      `SELECT o.shop_id, l.variant_id, o.id, o.number, sum(l.qty) AS qty, o.status, o.wanted_on, c.name, (c.erased_at IS NOT NULL) AS erased
         FROM order_lines l JOIN orders o ON o.id = l.order_id JOIN customers c ON c.id = o.customer_id
        WHERE l.org_id = @org AND l.variant_id IN (SELECT value FROM json_each(@vs))
          AND o.shop_id IN (SELECT value FROM json_each(@shops)) AND o.status IN ${PROMISED_SQL}
        GROUP BY o.id, l.variant_id ORDER BY o.created_at`,
      { vs: [...variantIds], shops: [...shopIds] },
    )
    .map((r) => ({
      shopId: r.shop_id, variantId: r.variant_id, orderId: r.id, number: r.number, qty: r.qty, status: r.status, wantedOn: r.wanted_on,
      customerName: namesAt.has(r.shop_id) && !r.erased ? r.name : null,
    }));
}

export type OrderViewer =
  | { side: 'staff'; locale: string; can: (perm: string, shopId: string) => boolean }
  | { side: 'customer'; locale: string };

// what the person looking may do now
export function orderActions(row: Pick<OrderRow, 'status' | 'priced' | 'shop_id'>, lines: readonly { unit_price_minor: number | null }[], v: OrderViewer): OrderAction[] {
  if (v.side === 'customer') {
    if (row.status === 'requested') return ['cancel'];
    if (row.status === 'quoted') return ['accept', 'reject', 'cancel'];
    return [];
  }
  const quote = v.can('orders.quote', row.shop_id);
  const fulfil = v.can('orders.fulfil', row.shop_id);
  const out: OrderAction[] = [];
  switch (row.status) {
    case 'requested':
      if (quote) out.push('quote');
      if (quote && row.priced && lines.every((l) => l.unit_price_minor != null)) out.push('confirm');
      if (quote) out.push('decline');
      break;
    case 'quoted':
      if (quote) out.push('quote', 'cancel');
      break;
    case 'confirmed':
      if (fulfil) out.push('ready', 'complete');
      if (quote) out.push('cancel');
      break;
    case 'ready':
      if (fulfil) out.push('complete');
      if (quote) out.push('cancel');
      break;
  }
  return out;
}

interface EventRow { id: string; at: number; actor_type: OrderEvent['actor']; actor_id: string | null; kind: OrderEventKind; data: string | null; actor_name: string | null }

export function buildOrder(db: Db, t: Tenant, row: OrderRow, v: OrderViewer): Order {
  const lines = linesOf(t, row.id);
  const variantIds = lines.map((l) => l.variant_id);
  const productIds = [...new Set(lines.map((l) => l.product_id))];
  // names in the reader's language when the product still has one, photos as they are now
  const names = new Map(
    t.all<{ product_id: string; name: string }>(
      `SELECT tr.product_id, tr.name FROM product_translations tr JOIN products p ON p.id = tr.product_id
        WHERE p.org_id = @org AND tr.locale = @l AND tr.product_id IN (SELECT value FROM json_each(@ids))`,
      { l: pickLocale(v.locale), ids: productIds },
    ).map((r) => [r.product_id, r.name]),
  );
  const images = new Map(
    t.all<{ product_id: string; storage_key: string | null }>(
      `SELECT p.id AS product_id, (SELECT f.storage_key FROM product_images i JOIN files f ON f.id = i.file_id WHERE i.product_id = p.id AND f.deleted_at IS NULL ORDER BY i.sort LIMIT 1) AS storage_key
         FROM products p WHERE p.org_id = @org AND p.id IN (SELECT value FROM json_each(@ids))`,
      { ids: productIds },
    ).map((r) => [r.product_id, fileUrl(r.storage_key)]),
  );
  const staff = v.side === 'staff';
  const onHand = staff
    ? new Map(t.all<{ variant_id: string; on_hand: number }>(
        'SELECT variant_id, on_hand FROM stock_levels WHERE org_id = @org AND shop_id = @s AND variant_id IN (SELECT value FROM json_each(@vs))',
        { s: row.shop_id, vs: variantIds },
      ).map((r) => [r.variant_id, r.on_hand]))
    : null;
  const others = staff ? promisedQty(t, [row.shop_id], variantIds, row.id) : null;
  const outLines: OrderLine[] = lines.map((l) => ({
    lineNo: l.line_no, variantId: l.variant_id, productId: l.product_id, name: names.get(l.product_id) ?? l.product_name, imageUrl: images.get(l.product_id) ?? null,
    uom: l.uom, taxRateBp: l.tax_rate_bp, qty: l.qty, requestedQty: l.requested_qty, unitPriceMinor: l.unit_price_minor, lineTotalMinor: l.line_total_minor, note: l.note,
    ...(staff ? { onHand: onHand!.get(l.variant_id) ?? 0, onOtherOrders: others!.get(`${row.shop_id}|${l.variant_id}`) ?? 0 } : {}),
  }));
  const events: OrderEvent[] = t
    .all<EventRow>(
      `SELECT e.id, e.at, e.actor_type, e.actor_id, e.kind, e.data, u.display_name AS actor_name
         FROM order_events e LEFT JOIN users u ON u.id = e.actor_id AND e.actor_type = 'staff'
        WHERE e.org_id = @org AND e.order_id = @o ORDER BY e.at, e.rowid`,
      { o: row.id },
    )
    .map((e) => {
      const d = parseJson<{ total?: number | null; previousTotal?: number | null; reason?: string | null; message?: string | null; changedLines?: number[] }>(e.data, {});
      return {
        id: e.id, at: e.at, actor: e.actor_type, actorName: staff && e.actor_type === 'staff' ? e.actor_name : null, kind: e.kind,
        totalMinor: d.total ?? null, previousTotalMinor: d.previousTotal ?? null, reason: d.reason ?? null, message: d.message ?? null,
        ...(d.changedLines ? { changedLines: d.changedLines } : {}),
      };
    });
  const shopName = t.get<{ name: string }>('SELECT name FROM shops WHERE org_id = @org AND id = @s', { s: row.shop_id })?.name ?? '';
  const order: Order = {
    id: row.id, orgId: row.org_id, number: row.number, shopId: row.shop_id, shopName, status: row.status, priced: !!row.priced, note: row.note,
    wantedOn: row.wanted_on, currency: row.currency, totalMinor: row.total_minor, quoteValidUntil: row.quote_valid_until, quoteMessage: row.quote_message,
    cancelReason: row.cancel_reason, createdAt: row.created_at, updatedAt: row.updated_at, closedAt: row.closed_at,
    lines: outLines, events, actions: orderActions(row, lines, v),
  };
  if (v.side === 'staff') {
    const c = t.get<{ id: string; name: string | null; email: string | null; phone: string | null; locale: AppLocale; erased_at: number | null }>(
      'SELECT id, name, email, phone, locale, erased_at FROM customers WHERE org_id = @org AND id = @c',
      { c: row.customer_id },
    );
    const full = v.can('customers.contact.view', row.shop_id);
    const erased = !c || c.erased_at != null;
    order.customer = {
      id: row.customer_id, name: erased ? null : c!.name, email: erased ? null : full ? c!.email : maskEmail(c!.email), phone: erased ? null : full ? c!.phone : maskPhone(c!.phone),
      contactMasked: !full, locale: c?.locale ?? row.locale, erased,
    };
    order.quotedByName = row.quoted_by ? platform(db).get<{ display_name: string | null }>('SELECT display_name FROM users WHERE id = @u', { u: row.quoted_by })?.display_name ?? null : null;
  }
  return order;
}

export function orderSummaries(t: Tenant, rows: readonly OrderRow[], v: OrderViewer): OrderSummary[] {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const lines = t.all<{ order_id: string; product_id: string; product_name: string; line_no: number }>(
    `SELECT order_id, product_id, product_name, line_no FROM order_lines WHERE org_id = @org AND order_id IN (SELECT value FROM json_each(@ids)) ORDER BY order_id, line_no`,
    { ids },
  );
  const names = new Map(
    t.all<{ product_id: string; name: string }>(
      `SELECT tr.product_id, tr.name FROM product_translations tr JOIN products p ON p.id = tr.product_id
        WHERE p.org_id = @org AND tr.locale = @l AND tr.product_id IN (SELECT value FROM json_each(@ids))`,
      { l: pickLocale(v.locale), ids: [...new Set(lines.map((l) => l.product_id))] },
    ).map((r) => [r.product_id, r.name]),
  );
  const byOrder = new Map<string, string[]>();
  for (const l of lines) byOrder.set(l.order_id, [...(byOrder.get(l.order_id) ?? []), names.get(l.product_id) ?? l.product_name]);
  const shops = new Map(t.all<{ id: string; name: string }>('SELECT id, name FROM shops WHERE org_id = @org').map((s) => [s.id, s.name]));
  const customers = v.side === 'staff'
    ? new Map(t.all<{ id: string; name: string | null; erased_at: number | null }>(
        'SELECT id, name, erased_at FROM customers WHERE org_id = @org AND id IN (SELECT value FROM json_each(@ids))',
        { ids: [...new Set(rows.map((r) => r.customer_id))] },
      ).map((c) => [c.id, c.erased_at ? null : c.name]))
    : null;
  return rows.map((r) => {
    const all = byOrder.get(r.id) ?? [];
    return {
      id: r.id, number: r.number, shopId: r.shop_id, shopName: shops.get(r.shop_id) ?? '', status: r.status, priced: !!r.priced, currency: r.currency,
      totalMinor: r.total_minor, lineCount: all.length, names: all.slice(0, 3), wantedOn: r.wanted_on, quoteValidUntil: r.quote_valid_until,
      createdAt: r.created_at, updatedAt: r.updated_at,
      ...(customers ? { customerName: customers.get(r.customer_id) ?? null } : {}),
    };
  });
}

// ---------------------------------------------------------------- writing

export function nextOrderNumber(t: Tenant): number {
  t.run('INSERT OR IGNORE INTO order_counters (org_id, next_number) VALUES (@org, 1001)');
  const r = t.get<{ n: number }>('UPDATE order_counters SET next_number = next_number + 1 WHERE org_id = @org RETURNING next_number - 1 AS n');
  return r!.n;
}

export function addOrderEvent(
  t: Tenant,
  orderId: string,
  actor: { type: OrderEvent['actor']; id: string | null },
  kind: OrderEventKind,
  data: { total?: number | null; previousTotal?: number | null; reason?: string | null; message?: string | null; changedLines?: number[] } | null,
  now: number,
  id: string,
) {
  t.run(
    'INSERT INTO order_events (id, org_id, order_id, at, actor_type, actor_id, kind, data) VALUES (@id, @org, @o, @at, @type, @actor, @kind, @data)',
    { id, o: orderId, at: now, type: actor.type, actor: actor.id, kind, data: data ? JSON.stringify(data) : null },
  );
}

// ---------------------------------------------------------------- messages

function itemsText(t: Tenant, orderId: string, locale: string): string {
  const lines = linesOf(t, orderId);
  const unit = translator(pickLocale(locale), 'common');
  const parts = lines.slice(0, 3).map((l) => `${formatQty(l.qty, l.uom, locale)}${l.uom === 'piece' ? '' : ` ${unit(`uom.${l.uom}`)}`} × ${l.product_name}`);
  return lines.length > 3 ? `${parts.join(', ')} +${lines.length - 3}` : parts.join(', ');
}

// the customer hears about a step of their order: by push when the app is on a device, by email
// when the address is confirmed. like notify me, they asked for this, so no marketing yes is needed.
// the order is the newest state, read after the change
export function tellCustomer(db: Db, webBase: string, row: OrderRow, event: OrderMailEvent, channels: { push: boolean; email: boolean }) {
  const t = new Tenant(db, row.org_id);
  const c = t.get<{ id: string; user_id: string | null; email: string | null; email_verified_at: number | null; locale: AppLocale; erased_at: number | null }>(
    'SELECT id, user_id, email, email_verified_at, locale, erased_at FROM customers WHERE org_id = @org AND id = @c',
    { c: row.customer_id },
  );
  if (!c || c.erased_at) return;
  const org = platform(db).get<{ name: string; slug: string; timezone: string }>('SELECT name, slug, timezone FROM organizations WHERE id = @o', { o: row.org_id })!;
  const shop = t.get<{ name: string; address: string | null; city: string | null }>('SELECT name, address, city FROM shops WHERE org_id = @org AND id = @s', { s: row.shop_id });
  const shopName = shop?.name ?? org.name;
  const locale = pickLocale(c.locale);
  const money = (m: number | null) => (m == null ? null : formatMoney(m, row.currency, locale));
  const url = `${webBase.replace(/\/$/, '')}/s/${encodeURIComponent(org.slug)}/orders/${encodeURIComponent(row.id)}`;
  const transport = devOutboxTransport(db, () => {});
  const reason = row.cancel_reason ?? '';
  if (channels.push && c.user_id && event !== 'received') {
    const reachable = platform(db).get<{ ok: number }>(`SELECT ${pushReachableSql('@u', '@o')} AS ok`, { u: c.user_id, o: row.org_id })?.ok;
    if (reachable) {
      const tr = translator(locale, 'server');
      const params = { number: row.number, shop: shopName, total: money(row.total_minor) ?? '', reason };
      transport.send({
        channel: 'push', orgId: row.org_id, userId: c.user_id, customerId: c.id, locale,
        title: tr(`push.order.${event}.title`, params),
        body: tr(`push.order.${event}.body`, params) || tr('email.order.see'),
        payload: { type: 'order', orderId: row.id, shopId: row.shop_id },
      });
    }
  }
  if (channels.email && c.email && c.email_verified_at) {
    if (platform(db).get('SELECT 1 FROM email_suppressions WHERE email = @e', { e: c.email })) return;
    const unit = translator(locale, 'common');
    const lines = linesOf(t, row.id);
    const images = new Map(
      t.all<{ product_id: string; storage_key: string | null }>(
        `SELECT p.id AS product_id, (SELECT f.storage_key FROM product_images i JOIN files f ON f.id = i.file_id WHERE i.product_id = p.id AND f.deleted_at IS NULL ORDER BY i.sort LIMIT 1) AS storage_key
           FROM products p WHERE p.org_id = @org AND p.id IN (SELECT value FROM json_each(@ids))`,
        { ids: [...new Set(lines.map((l) => l.product_id))] },
      ).map((r) => [r.product_id, fileUrl(r.storage_key)]),
    );
    const until = row.quote_valid_until
      ? new Intl.DateTimeFormat(intlLocale(locale), { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: org.timezone }).format(new Date(row.quote_valid_until))
      : null;
    const mail = orderEmail(locale, {
      event, org: org.name, shop: shopName, logoUrl: orgLogoUrl(db, row.org_id), number: row.number, priced: !!row.priced, url,
      total: money(row.total_minor), reason: row.cancel_reason, message: row.quote_message, until,
      address: shop ? [shop.address, shop.city].filter(Boolean).join(', ') || null : null,
      lines: lines.map((l) => ({
        name: l.product_name, imageUrl: images.get(l.product_id) ?? null,
        qty: `${formatQty(l.qty, l.uom, locale)}${l.uom === 'piece' ? '' : ` ${unit(`uom.${l.uom}`)}`}`,
        total: money(l.line_total_minor),
      })),
    });
    transport.send(emailMessage(mail, { orgId: row.org_id, customerId: c.id, to: c.email, locale, payload: { type: `order_${event}`, orderId: row.id } }));
  }
}

// the shop hears about a new order: people with orders.quote at that shop who keep the alert on
export function tellShopNewOrder(db: Db, row: OrderRow, customerName: string | null) {
  const t = new Tenant(db, row.org_id);
  notifyMembers(db, row.org_id, {
    perm: 'orders.quote', shopId: row.shop_id, key: 'orderNew', bodyKey: row.total_minor != null ? 'bodyPriced' : 'body',
    params: (locale) => ({ number: row.number, customer: customerName ?? '—', items: itemsText(t, row.id, locale), total: row.total_minor != null ? formatMoney(row.total_minor, row.currency, locale) : '' }),
    payload: { orderId: row.id, shopId: row.shop_id },
  });
}

// the shop hears the customer's answer (or that the price ran out): the person who sent the price,
// else everyone with orders.quote at that shop
export function tellShopAnswer(db: Db, row: OrderRow, customerName: string | null, answer: 'Accepted' | 'Rejected' | 'Cancelled' | 'Expired') {
  const key = answer === 'Expired' ? 'orderExpired' : 'orderAnswered';
  const bodyKey = answer === 'Expired' ? 'body' : `body${answer}`;
  const params = (locale: string) => ({ number: row.number, customer: customerName ?? '—', total: row.total_minor != null ? formatMoney(row.total_minor, row.currency, locale) : '' });
  const payload = { orderId: row.id, shopId: row.shop_id };
  if (row.quoted_by && notifyUser(db, row.org_id, row.quoted_by, { key, bodyKey, params, payload })) return;
  notifyMembers(db, row.org_id, { perm: 'orders.quote', shopId: row.shop_id, key, bodyKey, params, payload });
}

// a price that ran out: the order is expired, the customer and the person who quoted hear it.
// false when someone else got there first
export function expireOrder(db: Db, webBase: string, row: OrderRow, now: number): boolean {
  const t = new Tenant(db, row.org_id);
  let done = false;
  db.transaction(() => {
    done = t.run(
      `UPDATE orders SET status = 'expired', updated_at = max(updated_at + 1, @now), closed_at = @now
        WHERE org_id = @org AND id = @id AND status = 'quoted' AND quote_valid_until <= @now`,
      { id: row.id, now },
    ).changes > 0;
    if (done) addOrderEvent(t, row.id, { type: 'system', id: null }, 'expired', { total: row.total_minor }, now, uuidv7(now));
  })();
  if (!done) return false;
  const after = loadOrderRow(t, row.id)!;
  tellCustomer(db, webBase, after, 'expired', { push: true, email: true });
  tellShopAnswer(db, after, t.get<{ name: string | null }>('SELECT name FROM customers WHERE org_id = @org AND id = @c AND erased_at IS NULL', { c: row.customer_id })?.name ?? null, 'Expired');
  return true;
}

// the worker: every price that ran out, a few at a time (housekeeping, once a minute)
export function expireQuotes(db: Db, webBase: string, now: number): number {
  const rows = platform(db).all<OrderRow>(
    `SELECT ${ORDER_COLUMNS} FROM orders WHERE status = 'quoted' AND quote_valid_until <= @now ORDER BY quote_valid_until LIMIT 100`,
    { now },
  );
  let n = 0;
  for (const r of rows) if (expireOrder(db, webBase, r, now)) n++;
  return n;
}
