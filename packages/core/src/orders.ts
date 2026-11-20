// orders and price requests from customers (thinking/19-orders.md). money is with VAT in minor
// units, quantities are base units (pieces, grams, ml, mm) like the ledger.

import { z } from './zod';
import { CustomerOrdersMode, Locale, Uom, zMoneyMinor, zText } from './contract';
import { LIMITS, MAX_QTY_BASE } from './validate';
import { UOM_SCALE } from './qty';
import type { Uom as UomT } from './contract';

// a line's total: the unit price (per piece, or per kg/l/m) times the quantity, rounded once
export function orderLineTotal(unitPriceMinor: number, qty: number, uom: UomT): number {
  return Math.round((unitPriceMinor * qty) / UOM_SCALE[uom]);
}

// requested: sent by the customer. quoted: the shop sent a price, the customer answers. confirmed:
// agreed, the shop prepares it. ready: to pick up. completed: picked up. the rest are final:
// declined (by the shop before a price), rejected (the customer said no to the price), cancelled
// (by either side, with a reason from the shop), expired (the price ran out)
export const OrderStatus = z.enum(['requested', 'quoted', 'confirmed', 'ready', 'completed', 'declined', 'rejected', 'cancelled', 'expired']);
export type OrderStatus = z.infer<typeof OrderStatus>;
export const OPEN_ORDER_STATUSES: readonly OrderStatus[] = ['requested', 'quoted', 'confirmed', 'ready'];
export const CLOSED_ORDER_STATUSES: readonly OrderStatus[] = ['completed', 'declined', 'rejected', 'cancelled', 'expired'];
// agreed and not picked up yet: what a shop has promised ("on orders"). never taken off on hand
export const PROMISED_ORDER_STATUSES: readonly OrderStatus[] = ['confirmed', 'ready'];

// the lists: one status, or every open or every closed one
export const OrderListStatus = z.union([OrderStatus, z.enum(['open', 'closed'])]);
export type OrderListStatus = z.infer<typeof OrderListStatus>;

export const OrderEventKind = z.enum(['requested', 'quoted', 'confirmed', 'accepted', 'rejected', 'declined', 'ready', 'completed', 'cancelled', 'expired']);
export type OrderEventKind = z.infer<typeof OrderEventKind>;

// what the person looking may do now. the staff side and the customer side get their own
export const OrderAction = z.enum(['quote', 'confirm', 'decline', 'ready', 'complete', 'cancel', 'accept', 'reject']);
export type OrderAction = z.infer<typeof OrderAction>;

export const OrderLine = z.object({
  lineNo: z.number(),
  variantId: z.string(),
  productId: z.string(),
  // the name in the reader's language when the product still has one, else the name when ordered
  name: z.string(),
  imageUrl: z.string().nullable(),
  uom: Uom,
  taxRateBp: z.number(),
  // base units: pieces, or grams/ml/mm for kg/l/m
  qty: z.number(),
  // what the customer asked for, the shop may change qty when it sends a price
  requestedQty: z.number(),
  // with VAT, per piece or per kg/l/m. null while the price is not known
  unitPriceMinor: z.number().nullable(),
  lineTotalMinor: z.number().nullable(),
  note: z.string().nullable(),
  // staff side only: on hand at the order's shop right now, and what other confirmed or ready
  // orders of that shop already hold of it
  onHand: z.number().nullable().optional(),
  onOtherOrders: z.number().nullable().optional(),
});
export type OrderLine = z.infer<typeof OrderLine>;

export const OrderEvent = z.object({
  id: z.string(),
  at: z.number(),
  actor: z.enum(['customer', 'staff', 'system']),
  // staff side only: who did it. the customer sees the shop, never a person
  actorName: z.string().nullable(),
  kind: OrderEventKind,
  totalMinor: z.number().nullable(),
  previousTotalMinor: z.number().nullable(),
  // the reason given with a decline or a cancel
  reason: z.string().nullable(),
  // the message the shop sent with a price
  message: z.string().nullable(),
  // the line numbers the shop changed (price or quantity) when it sent the price
  changedLines: z.array(z.number()).optional(),
});
export type OrderEvent = z.infer<typeof OrderEvent>;

export const OrderCustomer = z.object({
  id: z.string(),
  // null once the customer was erased
  name: z.string().nullable(),
  // masked without customers.contact.view
  email: z.string().nullable(),
  phone: z.string().nullable(),
  contactMasked: z.boolean(),
  locale: Locale,
  erased: z.boolean(),
});
export type OrderCustomer = z.infer<typeof OrderCustomer>;

export const Order = z.object({
  id: z.string(),
  orgId: z.string(),
  // the number people use, #1001 and up, per business
  number: z.number(),
  shopId: z.string(),
  shopName: z.string(),
  status: OrderStatus,
  // sent at the shown prices: the shop only confirms
  priced: z.boolean(),
  note: z.string().nullable(),
  // YYYY-MM-DD in the business's time zone
  wantedOn: z.string().nullable(),
  currency: z.string(),
  // with VAT. null while the price is not known
  totalMinor: z.number().nullable(),
  quoteValidUntil: z.number().nullable(),
  quoteMessage: z.string().nullable(),
  cancelReason: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
  closedAt: z.number().nullable(),
  lines: z.array(OrderLine),
  // oldest first
  events: z.array(OrderEvent),
  actions: z.array(OrderAction),
  // staff side only
  customer: OrderCustomer.optional(),
  quotedByName: z.string().nullable().optional(),
});
export type Order = z.infer<typeof Order>;

// a row in a list
export const OrderSummary = z.object({
  id: z.string(),
  number: z.number(),
  shopId: z.string(),
  shopName: z.string(),
  status: OrderStatus,
  priced: z.boolean(),
  currency: z.string(),
  totalMinor: z.number().nullable(),
  lineCount: z.number(),
  // the first few product names, for one line of text
  names: z.array(z.string()),
  wantedOn: z.string().nullable(),
  quoteValidUntil: z.number().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
  // staff side only
  customerName: z.string().nullable().optional(),
});
export type OrderSummary = z.infer<typeof OrderSummary>;

// open orders per status, for the menu badge and Home
export const OrderCounts = z.object({ requested: z.number(), quoted: z.number(), confirmed: z.number(), ready: z.number() });
export type OrderCounts = z.infer<typeof OrderCounts>;

// a confirmed or ready order that holds some of a product at a shop (product page, staff only)
export const OrderHold = z.object({
  shopId: z.string(),
  variantId: z.string(),
  orderId: z.string(),
  number: z.number(),
  qty: z.number(),
  status: OrderStatus,
  wantedOn: z.string().nullable(),
  // the customer's name, only with customers.view at that shop. null when erased or not allowed
  customerName: z.string().nullable(),
});
export type OrderHold = z.infer<typeof OrderHold>;

const zDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'invalid' });
const zOrderQty = z.number().int().positive({ message: 'invalid' }).max(MAX_QTY_BASE, { message: 'tooLarge' });

export const OrderLineInput = z.object({
  variantId: z.string().max(64),
  // base units: pieces, or grams/ml/mm for products sold by measure
  qty: zOrderQty,
  // the unit price the app showed (null when none was shown). when the server's price for that
  // shop differs, the order is refused with prices_changed, so nobody is surprised
  seenUnitPriceMinor: zMoneyMinor.nullable().default(null),
  note: zText(LIMITS.note).nullable().optional(),
});
export type OrderLineInput = z.infer<typeof OrderLineInput>;

export const OrderCreateInput = z.object({
  shopId: z.string().max(64),
  lines: z.array(OrderLineInput).min(1).max(100),
  note: zText(500).nullable().optional(),
  wantedOn: zDay.nullable().optional(),
});
export type OrderCreateInput = z.infer<typeof OrderCreateInput>;

// what an order would be before it is sent: the prices at that shop now, and lines that can not
// be ordered (gone, not sold to customers, too many)
export const OrderPreviewInput = z.object({
  shopId: z.string().max(64),
  lines: z.array(z.object({ variantId: z.string().max(64), qty: zOrderQty })).min(1).max(100),
});
export type OrderPreviewInput = z.infer<typeof OrderPreviewInput>;

export const OrderPreview = z.object({
  shopId: z.string(),
  // true: it goes in at these prices and the shop only confirms. false: it asks for a price
  priced: z.boolean(),
  currency: z.string(),
  lines: z.array(z.object({
    variantId: z.string(),
    productId: z.string().nullable(),
    name: z.string(),
    imageUrl: z.string().nullable(),
    uom: Uom,
    qty: z.number(),
    unitPriceMinor: z.number().nullable(),
    lineTotalMinor: z.number().nullable(),
    // why this line can not go in as it is: gone (archived or not shown to customers) or too many
    problem: z.enum(['unavailable', 'too_many']).nullable(),
  })),
  totalMinor: z.number().nullable(),
  limits: z.object({ maxLines: z.number(), maxQty: z.number(), openLeft: z.number() }),
});
export type OrderPreview = z.infer<typeof OrderPreview>;

// the shop's price: every line gets a unit price, quantities may change
export const OrderQuoteInput = z.object({
  lines: z.array(z.object({
    lineNo: z.number().int().positive(),
    unitPriceMinor: zMoneyMinor,
    qty: zOrderQty.optional(),
    note: zText(LIMITS.note).nullable().optional(),
  })).min(1).max(100),
  // when the price stops holding. default: policy orders.quoteDays from now
  validUntil: z.number().int().optional(),
  message: zText(500).nullable().optional(),
});
export type OrderQuoteInput = z.infer<typeof OrderQuoteInput>;

// the shop always says why it declines or cancels
export const OrderReasonInput = z.object({ reason: zText(300).pipe(z.string().min(1, { message: 'empty' })) });
export type OrderReasonInput = z.infer<typeof OrderReasonInput>;

// the customer may say why
export const OrderCustomerCancelInput = z.object({ reason: zText(300).nullable().optional() });
export type OrderCustomerCancelInput = z.infer<typeof OrderCustomerCancelInput>;

// what the shop's app needs to offer ordering (part of GET /v1/public/orgs/:slug as `orders`)
export const PublicOrderOptions = z.object({
  // off when the business takes no orders, or the super admin switched orders off for it
  mode: CustomerOrdersMode,
  // prices are shown: with mode priced an order can go in at those prices
  pricesShown: z.boolean(),
  // the shops that take orders, to pick up from
  shops: z.array(z.object({ id: z.string(), name: z.string(), address: z.string().nullable(), city: z.string().nullable() })),
  limits: z.object({ maxLines: z.number(), maxQty: z.number(), openPerCustomer: z.number() }),
});
export type PublicOrderOptions = z.infer<typeof PublicOrderOptions>;
