// the stock ledger write path (thinking/05-inventory.md). one movement at a time, inside the
// caller's transaction: idempotency by id, permission per kind, sign and reason rules, the
// negative stock policy, cached levels, low stock once per dip, back in stock once per alert.

import { followsShop, shopsInScope, uuidv7, type ErrorCode, type MovementInput, type StockLevel, type Topology } from '@custock/core';
import type { Db } from '@custock/db';
import type { OrgRow } from '../types';
import { audit } from '../lib/audit';
import { notifyMembers } from '../lib/notify';
import { platform, Tenant } from '../lib/tenant';
import { enqueue } from '../worker';
import { variantLabel } from './catalog';

export const KIND_PERM: Record<string, string> = {
  initial: 'stock.adjust',
  receive: 'stock.receive',
  sale: 'stock.sell',
  return: 'stock.return',
  adjust: 'stock.adjust',
  damage: 'stock.adjust',
  count: 'stock.count.approve',
  transfer_out: 'stock.transfer.send',
  transfer_in: 'stock.transfer.receive',
};

const DIRECT = new Set(['initial', 'receive', 'sale', 'return', 'adjust', 'damage', 'reversal']);
const POSITIVE = new Set(['initial', 'receive', 'return', 'transfer_in']);
const NEGATIVE = new Set(['sale', 'damage', 'transfer_out']);
const RESTOCK = new Set(['receive', 'transfer_in', 'return']);
// counts and transfers have their own undo (a new count, a transfer back), never a reversal
const REVERSIBLE = new Set(['initial', 'receive', 'sale', 'return', 'adjust', 'damage']);
// a movement this old was made offline and is accepted even in strict mode
export const OFFLINE_AFTER_MS = 120_000;

export interface LedgerCtx {
  db: Db;
  t: Tenant;
  org: OrgRow;
  topology: Topology;
  userId: string;
  now: number;
  can: (perm: string, shopId: string) => boolean;
}

export type Outcome =
  | { status: 'accepted'; id: string; level: StockLevel; backInStock?: { variantId: string; shopId: string; notified: number }; lowStock?: { variantId: string; shopId: string; onHand: number } }
  | { status: 'duplicate'; id: string }
  | { status: 'rejected'; id: string; code: ErrorCode };

interface VariantRow {
  id: string;
  product_id: string;
  name: string;
  options: string | null;
  price_minor: number | null;
  cost_minor: number | null;
  archived: number;
}

// the price a sale uses: a running offer for this shop, else the shop price, else the base price
export function effectivePrice(t: Tenant, topology: Topology, variantId: string, shopId: string, now: number): number | null {
  const offers = t.all<{ post_id: string; offer_price_minor: number }>(
    `SELECT pp.post_id, pp.offer_price_minor FROM post_products pp JOIN posts po ON po.id = pp.post_id
      WHERE po.org_id = @org AND po.kind = 'offer' AND po.status = 'sent' AND po.deleted_at IS NULL
        AND pp.variant_id = @v AND pp.offer_price_minor IS NOT NULL
        AND coalesce(po.valid_from, po.sent_at) <= @now AND (po.valid_until IS NULL OR po.valid_until > @now)`,
    { v: variantId, now },
  );
  let best: number | null = null;
  for (const o of offers) {
    const scopes = t.all<{ scope_type: 'org' | 'group' | 'shop'; scope_id: string }>('SELECT scope_type, scope_id FROM post_scopes WHERE org_id = @org AND post_id = @p', { p: o.post_id });
    if (scopes.some((s) => shopsInScope(topology, { scopeType: s.scope_type, scopeId: s.scope_id }).includes(shopId))) {
      best = best == null ? o.offer_price_minor : Math.min(best, o.offer_price_minor);
    }
  }
  if (best != null) return best;
  const row = t.get<{ shop: number | null; base: number | null }>(
    `SELECT s.price_override_minor AS shop, v.price_minor AS base FROM product_variants v
       LEFT JOIN shop_variant_settings s ON s.variant_id = v.id AND s.shop_id = @shop
      WHERE v.org_id = @org AND v.id = @v`,
    { v: variantId, shop: shopId },
  );
  return row?.shop ?? row?.base ?? null;
}

export function currentLevel(t: Tenant, shopId: string, variantId: string): StockLevel {
  const row = t.get<{ on_hand: number; in_transit_in: number; last_movement_at: number | null; reorder_point: number | null }>(
    `SELECT l.on_hand, l.in_transit_in, l.last_movement_at, s.reorder_point FROM stock_levels l
       LEFT JOIN shop_variant_settings s ON s.shop_id = l.shop_id AND s.variant_id = l.variant_id
      WHERE l.org_id = @org AND l.shop_id = @shop AND l.variant_id = @v`,
    { shop: shopId, v: variantId },
  );
  const waiting =
    t.get<{ n: number }>(
      "SELECT count(*) AS n FROM stock_alerts WHERE org_id = @org AND status = 'waiting' AND variant_id = @v AND (shop_id IS NULL OR shop_id = @shop)",
      { v: variantId, shop: shopId },
    )?.n ?? 0;
  return {
    shopId,
    variantId,
    onHand: row?.on_hand ?? 0,
    inTransitIn: row?.in_transit_in ?? 0,
    reorderPoint: row?.reorder_point ?? null,
    lastMovementAt: row?.last_movement_at ?? null,
    waiting,
  };
}

export function recordMovement(ctx: LedgerCtx, input: MovementInput, opts: { internal?: boolean } = {}): Outcome {
  const { t, org, now } = ctx;
  const existing = platform(ctx.db).get<{ org_id: string }>('SELECT org_id FROM stock_movements WHERE id = @id', { id: input.id });
  if (existing) return existing.org_id === org.id ? { status: 'duplicate', id: input.id } : { status: 'rejected', id: input.id, code: 'conflict' };
  if (!opts.internal && !DIRECT.has(input.kind)) return { status: 'rejected', id: input.id, code: 'forbidden' };

  let m = { ...input };
  if (m.kind === 'reversal') {
    const original = t.get<{ id: string; shop_id: string; variant_id: string; qty_delta: number; kind: string; created_by: string; unit_price_minor: number | null; unit_cost_minor: number | null }>(
      'SELECT id, shop_id, variant_id, qty_delta, kind, created_by, unit_price_minor, unit_cost_minor FROM stock_movements WHERE org_id = @org AND id = @id',
      { id: m.refId ?? '' },
    );
    if (!original) return { status: 'rejected', id: m.id, code: 'not_found' };
    if (!REVERSIBLE.has(original.kind)) return { status: 'rejected', id: m.id, code: 'validation' };
    const already = t.get("SELECT 1 FROM stock_movements WHERE org_id = @org AND kind = 'reversal' AND ref_id = @id", { id: original.id });
    if (already) return { status: 'rejected', id: m.id, code: 'conflict' };
    const perm = KIND_PERM[original.kind] ?? 'stock.adjust';
    if (!ctx.can(perm, original.shop_id) || (original.created_by !== ctx.userId && !ctx.can('stock.adjust', original.shop_id))) {
      return { status: 'rejected', id: m.id, code: 'forbidden' };
    }
    m = { ...m, shopId: original.shop_id, variantId: original.variant_id, qtyDelta: -original.qty_delta, refType: 'reversal', refId: original.id };
    if (original.unit_price_minor != null) m.unitPriceMinor = original.unit_price_minor;
    if (original.unit_cost_minor != null) m.unitCostMinor = original.unit_cost_minor;
  } else {
    if (!ctx.topology.shops.includes(m.shopId)) return { status: 'rejected', id: m.id, code: 'not_found' };
    if (!opts.internal && !ctx.can(KIND_PERM[m.kind]!, m.shopId)) return { status: 'rejected', id: m.id, code: 'forbidden' };
    if (POSITIVE.has(m.kind) && m.qtyDelta <= 0) return { status: 'rejected', id: m.id, code: 'validation' };
    if (NEGATIVE.has(m.kind) && m.qtyDelta >= 0) return { status: 'rejected', id: m.id, code: 'validation' };
    if ((m.kind === 'adjust' || m.kind === 'damage') && !m.reason && !opts.internal) return { status: 'rejected', id: m.id, code: 'validation' };
    // references are set by the server (counts, transfers, reversals), never by the client
    if (!opts.internal) m = { ...m, refType: undefined, refId: undefined };
  }

  const variant = t.get<VariantRow>(
    `SELECT v.id, v.product_id, p.name, v.options, v.price_minor, v.cost_minor, (p.archived_at IS NOT NULL OR v.archived_at IS NOT NULL) AS archived
       FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.org_id = @org AND v.id = @v`,
    { v: m.variantId },
  );
  if (!variant) return { status: 'rejected', id: m.id, code: 'not_found' };

  const before = currentLevel(t, m.shopId, m.variantId);
  const after = before.onHand + m.qtyDelta;
  const offline = now - m.occurredAt > OFFLINE_AFTER_MS;
  if (!org.allow_negative_stock && after < 0 && m.qtyDelta < 0) {
    // offline movements are only let through for people who may adjust stock, and land in a review list
    if (!offline || !ctx.can('stock.adjust', m.shopId)) return { status: 'rejected', id: m.id, code: 'negative_stock_blocked' };
    audit(t, { id: ctx.userId }, 'stock.negative_accepted_offline', { type: 'stock_movement', id: m.id }, null, { shopId: m.shopId, variantId: m.variantId, onHand: after, qtyDelta: m.qtyDelta }, now);
  }
  if (variant.archived) audit(t, { id: ctx.userId }, 'stock.movement_on_archived', { type: 'stock_movement', id: m.id }, null, { variantId: m.variantId }, now);

  let unitPrice = m.unitPriceMinor ?? null;
  if (unitPrice == null && (m.kind === 'sale' || m.kind === 'return')) unitPrice = effectivePrice(t, ctx.topology, m.variantId, m.shopId, now);
  let unitCost = m.unitCostMinor ?? null;
  if (m.kind === 'receive') {
    if (unitCost != null && ctx.can('products.cost.edit', m.shopId) && unitCost !== variant.cost_minor) {
      t.run('UPDATE product_variants SET cost_minor = @c, updated_at = @now WHERE org_id = @org AND id = @v', { c: unitCost, now, v: variant.id });
      t.run('UPDATE products SET updated_at = @now WHERE org_id = @org AND id = @p', { now, p: variant.product_id });
    } else if (unitCost != null && !ctx.can('products.cost.edit', m.shopId)) {
      unitCost = variant.cost_minor;
    }
    unitCost = unitCost ?? variant.cost_minor;
  }
  // a client cost only counts with products.cost.edit
  if ((m.kind === 'damage' || m.kind === 'adjust' || m.kind === 'initial') && (unitCost == null || !ctx.can('products.cost.edit', m.shopId))) unitCost = variant.cost_minor;

  t.run(
    `INSERT INTO stock_movements (id, org_id, shop_id, variant_id, qty_delta, kind, reason, unit_price_minor, unit_cost_minor,
       ref_type, ref_id, batch_id, note, created_by, device_id, occurred_at, recorded_at)
     VALUES (@id, @org, @shop, @v, @qty, @kind, @reason, @price, @cost, @refType, @refId, @batch, @note, @user, NULL, @occurred, @now)`,
    {
      id: m.id, shop: m.shopId, v: m.variantId, qty: m.qtyDelta, kind: m.kind, reason: m.reason ?? null, price: unitPrice, cost: unitCost,
      refType: m.refType ?? null, refId: m.refId ?? null, batch: m.batchId ?? null, note: m.note ?? null, user: ctx.userId,
      occurred: m.occurredAt, now,
    },
  );
  t.run(
    `INSERT INTO stock_levels (org_id, shop_id, variant_id, on_hand, in_transit_in, last_movement_at) VALUES (@org, @shop, @v, @qty, 0, @now)
     ON CONFLICT (shop_id, variant_id) DO UPDATE SET on_hand = on_hand + @qty, last_movement_at = @now`,
    { shop: m.shopId, v: m.variantId, qty: m.qtyDelta, now },
  );

  const outcome: Outcome = { status: 'accepted', id: m.id, level: currentLevel(t, m.shopId, m.variantId) };
  const label = (locale: string) => variantLabel(productName(t, variant, locale), variant.options, locale);

  // low stock: once per dip below the reorder point
  const rp = before.reorderPoint;
  if (rp != null) {
    const flag = t.get<{ low_alert_sent_at: number | null }>('SELECT low_alert_sent_at FROM stock_levels WHERE org_id = @org AND shop_id = @shop AND variant_id = @v', { shop: m.shopId, v: m.variantId });
    if (after <= rp && before.onHand > rp && !flag?.low_alert_sent_at) {
      t.run('UPDATE stock_levels SET low_alert_sent_at = @now WHERE org_id = @org AND shop_id = @shop AND variant_id = @v', { now, shop: m.shopId, v: m.variantId });
      outcome.lowStock = { variantId: m.variantId, shopId: m.shopId, onHand: after };
      const shopName = shopNameOf(t, m.shopId);
      notifyMembers(ctx.db, org.id, {
        perm: 'stock.settings.manage', shopId: m.shopId, key: 'lowStock',
        params: (l) => ({ shop: shopName, product: label(l), count: after }),
        payload: { shopId: m.shopId, variantId: m.variantId },
      });
    } else if (after > rp && flag?.low_alert_sent_at) {
      t.run('UPDATE stock_levels SET low_alert_sent_at = NULL WHERE org_id = @org AND shop_id = @shop AND variant_id = @v', { shop: m.shopId, v: m.variantId });
    }
  }

  // back in stock: only real arrivals, each alert fires once
  if (RESTOCK.has(m.kind) && before.onHand <= 0 && after > 0) {
    const notified = notifyWaiting(ctx, m.variantId, m.shopId);
    outcome.backInStock = { variantId: m.variantId, shopId: m.shopId, notified };
  }
  return outcome;
}

function productName(t: Tenant, v: VariantRow, locale: string): string {
  const tr = t.get<{ name: string }>(
    'SELECT tr.name FROM product_translations tr JOIN products p ON p.id = tr.product_id WHERE p.org_id = @org AND tr.product_id = @p AND tr.locale = @l',
    { p: v.product_id, l: locale },
  );
  return tr?.name ?? v.name;
}

export function shopNameOf(t: Tenant, shopId: string): string {
  return t.get<{ name: string }>('SELECT name FROM shops WHERE org_id = @org AND id = @id', { id: shopId })?.name ?? '';
}

// marks waiting alerts for this variant (this shop or any shop) as notified and queues one
// delivery each: push when they have the app and allow it, email otherwise
function notifyWaiting(ctx: LedgerCtx, variantId: string, shopId: string): number {
  const { t, now } = ctx;
  const alerts = t.all<{ id: string; customer_id: string; push_ok: number; email_ok: number; email: string | null; email_verified_at: number | null; user_id: string | null }>(
    `SELECT a.id, a.customer_id, c.push_ok, c.email_ok, c.email, c.email_verified_at, c.user_id
       FROM stock_alerts a JOIN customers c ON c.id = a.customer_id
      WHERE a.org_id = @org AND a.status = 'waiting' AND a.variant_id = @v AND (a.shop_id IS NULL OR a.shop_id = @shop) AND c.erased_at IS NULL`,
    { v: variantId, shop: shopId },
  );
  for (const a of alerts) {
    t.run("UPDATE stock_alerts SET status = 'notified', notified_at = @now WHERE org_id = @org AND id = @id", { now, id: a.id });
    const hasDevice = a.user_id ? !!platform(ctx.db).get('SELECT 1 FROM devices WHERE user_id = @u AND revoked_at IS NULL AND fcm_token IS NOT NULL', { u: a.user_id }) : false;
    const suppressed = a.email ? !!platform(ctx.db).get('SELECT 1 FROM email_suppressions WHERE email = @e', { e: a.email }) : false;
    // notify me is consent for this one message, so a known email is enough
    const channel = a.push_ok && hasDevice ? 'push' : a.email && a.email_verified_at && !suppressed ? 'email' : null;
    t.run(
      `INSERT INTO deliveries (id, org_id, post_id, alert_id, customer_id, channel, status, skip_reason, created_at, updated_at)
       VALUES (@id, @org, NULL, @alert, @c, @ch, @status, @reason, @now, @now)`,
      { id: uuidv7(now), alert: a.id, c: a.customer_id, ch: channel ?? 'email', status: channel ? 'queued' : 'skipped', reason: channel ? null : 'no_device', now },
    );
  }
  if (alerts.length) enqueue(ctx.db, 'send_deliveries', {}, now, 'send_deliveries');
  return alerts.length;
}

// does this customer follow a shop through any subscription (for notify me checks)
export function customerFollows(t: Tenant, topology: Topology, customerId: string): string[] {
  const subs = t.all<{ scope_type: 'org' | 'group' | 'shop'; scope_id: string; status: 'pending' | 'subscribed' | 'unsubscribed' }>(
    'SELECT scope_type, scope_id, status FROM customer_subscriptions WHERE org_id = @org AND customer_id = @c',
    { c: customerId },
  );
  const s = subs.map((x) => ({ scopeType: x.scope_type, scopeId: x.scope_id, status: x.status }));
  return topology.shops.filter((shop) => followsShop(s, topology, shop));
}
