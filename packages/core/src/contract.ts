// the api contract shared by the server, the web and the phone app.
// shapes follow thinking/14-api-sketch.md and thinking/db/schema.sql.
// money is integer minor units, quantities are integer base units, times are epoch ms.

import { z } from 'zod';

export const Locale = z.enum(['en', 'el', 'ru']);
export type Locale = z.infer<typeof Locale>;

export const ScopeType = z.enum(['org', 'group', 'shop']);
export type ScopeType = z.infer<typeof ScopeType>;

export const Uom = z.enum(['piece', 'kg', 'l', 'm']);
export type Uom = z.infer<typeof Uom>;

export const CustomerStockMode = z.enum(['off', 'availability', 'exact']);
export type CustomerStockMode = z.infer<typeof CustomerStockMode>;

export const CustomerCatalogMode = z.enum(['off', 'subscribers', 'public']);
export type CustomerCatalogMode = z.infer<typeof CustomerCatalogMode>;

export const MovementKind = z.enum([
  'initial', 'receive', 'sale', 'return', 'adjust', 'damage',
  'count', 'transfer_out', 'transfer_in', 'reversal',
]);
export type MovementKind = z.infer<typeof MovementKind>;

export const AdjustReason = z.enum(['found', 'lost', 'damaged', 'expired', 'theft', 'own_use', 'correction']);
export type AdjustReason = z.infer<typeof AdjustReason>;

export const PostKind = z.enum(['news', 'offer', 'new_arrival', 'back_in_stock', 'event']);
export type PostKind = z.infer<typeof PostKind>;

export const PostStatus = z.enum(['draft', 'pending_approval', 'scheduled', 'sending', 'sent', 'cancelled', 'failed']);
export type PostStatus = z.infer<typeof PostStatus>;

export const Channel = z.enum(['feed', 'push', 'email']);
export type Channel = z.infer<typeof Channel>;

// ---------------------------------------------------------------- errors

// stable codes. the apps translate them, the server never sends prose for the ui.
export const ErrorCode = z.enum([
  'unauthorized', 'forbidden', 'not_found', 'validation', 'conflict', 'rate_limited',
  'perms_stale', 'scope', 'ceiling', 'rank', 'self', 'last_owner',
  'barcode_taken', 'negative_stock_blocked', 'invite_expired', 'invite_email_mismatch',
  'join_link_disabled', 'already_subscribed', 'internal',
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const Problem = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number(),
  code: ErrorCode,
  detail: z.string().optional(),
  fields: z.record(z.string(), z.string()).optional(),
});
export type Problem = z.infer<typeof Problem>;

// ---------------------------------------------------------------- auth and context

export const LoginInput = z.object({ email: z.string().email(), password: z.string().min(1) });
export const OtpRequestInput = z.object({ email: z.string().email(), locale: Locale.optional() });
export const OtpVerifyInput = z.object({ email: z.string().email(), code: z.string().length(6) });

export const Tokens = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresAt: z.number(),
});
export type Tokens = z.infer<typeof Tokens>;

export const ShopAccess = z.object({
  shopId: z.string(),
  name: z.string(),
  perms: z.array(z.string()),
  rank: z.number(),
});
export type ShopAccess = z.infer<typeof ShopAccess>;

export const OrgAccess = z.object({
  orgId: z.string(),
  name: z.string(),
  slug: z.string(),
  currency: z.string(),
  timezone: z.string(),
  defaultLocale: Locale,
  roleNames: z.array(z.string()),
  orgPerms: z.array(z.string()),
  anyPerms: z.array(z.string()),
  shops: z.array(ShopAccess),
  permsVersion: z.number(),
});
export type OrgAccess = z.infer<typeof OrgAccess>;

export const MeContext = z.object({
  user: z.object({
    id: z.string(),
    email: z.string().nullable(),
    displayName: z.string().nullable(),
    locale: Locale,
  }),
  orgs: z.array(OrgAccess),
  following: z.array(z.object({ orgId: z.string(), orgName: z.string(), customerId: z.string() })),
});
export type MeContext = z.infer<typeof MeContext>;

// ---------------------------------------------------------------- org and shops

export const OrgSettings = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  country: z.string(),
  currency: z.string(),
  timezone: z.string(),
  defaultLocale: Locale,
  brandColor: z.string().nullable(),
  logoUrl: z.string().nullable(),
  allowNegativeStock: z.boolean(),
  postsNeedApproval: z.boolean(),
  pushDailyCap: z.number(),
  quietHours: z.string(),
  customerCatalog: CustomerCatalogMode,
  customerPrices: z.boolean(),
  customerStock: CustomerStockMode,
  fewLeftThreshold: z.number(),
});
export type OrgSettings = z.infer<typeof OrgSettings>;

export const Shop = z.object({
  id: z.string(),
  orgId: z.string(),
  name: z.string(),
  slug: z.string(),
  city: z.string().nullable(),
  address: z.string().nullable(),
  phone: z.string().nullable(),
  timezone: z.string().nullable(),
  imageUrl: z.string().nullable(),
  customerVisible: z.boolean(),
  customerStock: CustomerStockMode.nullable(),
  groupIds: z.array(z.string()),
});
export type Shop = z.infer<typeof Shop>;

export const ShopGroup = z.object({ id: z.string(), name: z.string(), shopIds: z.array(z.string()) });
export type ShopGroup = z.infer<typeof ShopGroup>;

// ---------------------------------------------------------------- catalog

export const Barcode = z.object({
  id: z.string(),
  code: z.string(),
  codeNorm: z.string(),
  symbology: z.string().nullable(),
  packQty: z.number(),
});
export type Barcode = z.infer<typeof Barcode>;

export const Variant = z.object({
  id: z.string(),
  productId: z.string(),
  sku: z.string().nullable(),
  options: z.record(z.string(), z.string()).nullable(),
  priceMinor: z.number().nullable(),
  // only present when the caller has products.cost.view
  costMinor: z.number().nullable().optional(),
  isDefault: z.boolean(),
  barcodes: z.array(Barcode),
});
export type Variant = z.infer<typeof Variant>;

export const ProductImage = z.object({ id: z.string(), url: z.string(), width: z.number().nullable(), height: z.number().nullable() });

export const Product = z.object({
  id: z.string(),
  orgId: z.string(),
  categoryId: z.string().nullable(),
  categoryName: z.string().nullable(),
  name: z.string(),
  description: z.string().nullable(),
  brand: z.string().nullable(),
  uom: Uom,
  taxRateBp: z.number(),
  trackStock: z.boolean(),
  customerVisible: z.boolean(),
  customerStockHidden: z.boolean(),
  images: z.array(ProductImage),
  variants: z.array(Variant),
  translations: z.record(z.string(), z.object({ name: z.string(), description: z.string().nullable() })).optional(),
  archivedAt: z.number().nullable(),
});
export type Product = z.infer<typeof Product>;

export const Category = z.object({ id: z.string(), parentId: z.string().nullable(), name: z.string() });
export type Category = z.infer<typeof Category>;

export const ProductInput = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  brand: z.string().nullable().optional(),
  categoryId: z.string().nullable().optional(),
  uom: Uom.default('piece'),
  taxRateBp: z.number().int().default(2400),
  trackStock: z.boolean().default(true),
  priceMinor: z.number().int().nullable().optional(),
  costMinor: z.number().int().nullable().optional(),
  barcode: z.string().optional(),
});
export type ProductInput = z.infer<typeof ProductInput>;

// ---------------------------------------------------------------- stock

export const StockLevel = z.object({
  shopId: z.string(),
  variantId: z.string(),
  onHand: z.number(),
  inTransitIn: z.number(),
  reorderPoint: z.number().nullable(),
  lastMovementAt: z.number().nullable(),
  waiting: z.number(), // customers waiting with notify me, for this shop or any shop
});
export type StockLevel = z.infer<typeof StockLevel>;

export const MovementInput = z.object({
  id: z.string(), // uuid v7 made on the device, idempotency key
  shopId: z.string(),
  variantId: z.string(),
  qtyDelta: z.number().int().refine((n) => n !== 0, 'zero'),
  kind: MovementKind,
  reason: AdjustReason.optional(),
  note: z.string().max(500).optional(),
  unitPriceMinor: z.number().int().optional(),
  unitCostMinor: z.number().int().optional(),
  batchId: z.string().optional(),
  refType: z.string().optional(),
  refId: z.string().optional(),
  occurredAt: z.number(),
});
export type MovementInput = z.infer<typeof MovementInput>;

export const Movement = MovementInput.extend({
  orgId: z.string(),
  createdBy: z.string(),
  createdByName: z.string().nullable(),
  recordedAt: z.number(),
});
export type Movement = z.infer<typeof Movement>;

export const MovementBatchResult = z.object({
  accepted: z.array(z.string()),
  duplicates: z.array(z.string()),
  rejected: z.array(z.object({ id: z.string(), code: ErrorCode })),
  levels: z.array(StockLevel),
  backInStock: z.array(z.object({ variantId: z.string(), shopId: z.string(), notified: z.number() })),
  lowStock: z.array(z.object({ variantId: z.string(), shopId: z.string(), onHand: z.number() })),
});
export type MovementBatchResult = z.infer<typeof MovementBatchResult>;

export const ScanResult = z.object({
  codeNorm: z.string(),
  kind: z.enum(['gtin', 'internal', 'raw']),
  valid: z.boolean(),
  match: z.enum(['variant', 'unknown', 'archived']),
  packQty: z.number(),
  product: Product.nullable(),
  variantId: z.string().nullable(),
});
export type ScanResult = z.infer<typeof ScanResult>;

// ---------------------------------------------------------------- customers

export const Subscription = z.object({
  scopeType: ScopeType,
  scopeId: z.string(),
  status: z.enum(['pending', 'subscribed', 'unsubscribed']),
});
export type Subscription = z.infer<typeof Subscription>;

export const Customer = z.object({
  id: z.string(),
  name: z.string().nullable(),
  email: z.string().nullable(), // masked without customers.contact.view
  phone: z.string().nullable(), // masked without customers.contact.view
  contactMasked: z.boolean(),
  locale: Locale,
  emailOk: z.boolean(),
  pushOk: z.boolean(),
  smsOk: z.boolean(),
  hasApp: z.boolean(),
  source: z.enum(['join_link', 'app', 'staff', 'import']),
  tags: z.array(z.string()),
  subscriptions: z.array(Subscription),
  createdAt: z.number(),
});
export type Customer = z.infer<typeof Customer>;

export const ConsentEvent = z.object({
  channel: z.enum(['email', 'push', 'sms']),
  granted: z.boolean(),
  textVersion: z.string(),
  source: z.string(),
  createdAt: z.number(),
});
export type ConsentEvent = z.infer<typeof ConsentEvent>;

export const CustomerDetail = Customer.extend({
  consents: z.array(ConsentEvent),
  notes: z.array(z.object({ id: z.string(), body: z.string(), authorName: z.string().nullable(), createdAt: z.number() })),
  waitingFor: z.array(z.object({ variantId: z.string(), productName: z.string(), shopId: z.string().nullable() })),
  favorites: z.array(z.object({ productId: z.string(), productName: z.string() })),
  deliveries: z.array(z.object({ postId: z.string().nullable(), channel: z.string(), status: z.string(), createdAt: z.number() })),
});
export type CustomerDetail = z.infer<typeof CustomerDetail>;

export const JoinLink = z.object({
  id: z.string(),
  code: z.string(),
  scopeType: ScopeType,
  scopeId: z.string(),
  label: z.string().nullable(),
  url: z.string(),
  opens: z.number(),
  signups: z.number(),
  confirmed: z.number(),
  disabled: z.boolean(),
});
export type JoinLink = z.infer<typeof JoinLink>;

// ---------------------------------------------------------------- posts

export const PostText = z.object({ title: z.string().min(1), body: z.string() });

export const Audience = z.object({
  scopes: z.array(z.object({ scopeType: ScopeType, scopeId: z.string() })).min(1),
  tags: z.array(z.string()).default([]),
  interests: z.array(z.string()).default([]),
  locales: z.array(Locale).default([]),
  savedAnyLinked: z.boolean().default(false),
  joinedWithinDays: z.number().int().nullable().default(null),
});
export type Audience = z.infer<typeof Audience>;

export const PostInput = z.object({
  kind: PostKind,
  defaultLocale: Locale,
  translations: z.record(Locale, PostText),
  channels: z.array(Channel).min(1),
  audience: Audience,
  products: z.array(z.object({ variantId: z.string(), offerPriceMinor: z.number().int().nullable().default(null) })).default([]),
  coverUrl: z.string().nullable().default(null),
  scheduledAt: z.number().nullable().default(null),
  validFrom: z.number().nullable().default(null),
  validUntil: z.number().nullable().default(null),
});
export type PostInput = z.infer<typeof PostInput>;

export const Post = z.object({
  id: z.string(),
  orgId: z.string(),
  kind: PostKind,
  status: PostStatus,
  defaultLocale: Locale,
  translations: z.record(z.string(), PostText),
  channels: z.array(Channel),
  audience: Audience,
  products: z.array(z.object({
    variantId: z.string(),
    productId: z.string(),
    name: z.string(),
    imageUrl: z.string().nullable(),
    priceMinor: z.number().nullable(),
    offerPriceMinor: z.number().nullable(),
    wasMinor: z.number().nullable(), // lowest price of the last 30 days, EU omnibus rule
  })),
  coverUrl: z.string().nullable(),
  scheduledAt: z.number().nullable(),
  validFrom: z.number().nullable(),
  validUntil: z.number().nullable(),
  authorId: z.string(),
  authorName: z.string().nullable(),
  approvedBy: z.string().nullable(),
  sentAt: z.number().nullable(),
  recipientsCount: z.number().nullable(),
  stats: z.object({ queued: z.number(), sent: z.number(), failed: z.number(), opened: z.number(), skipped: z.number() }).nullable(),
  createdAt: z.number(),
});
export type Post = z.infer<typeof Post>;

export const AudiencePreview = z.object({
  total: z.number(),
  byScope: z.array(z.object({ scopeType: ScopeType, scopeId: z.string(), name: z.string(), count: z.number() })),
  byLocale: z.record(z.string(), z.number()),
  push: z.object({ count: z.number(), turnedOff: z.number(), noApp: z.number(), capReached: z.number(), heldForQuietHours: z.boolean() }),
  email: z.object({ count: z.number(), unconfirmed: z.number(), suppressed: z.number() }),
});
export type AudiencePreview = z.infer<typeof AudiencePreview>;

// ---------------------------------------------------------------- team

export const Role = z.object({
  id: z.string(),
  templateKey: z.enum(['owner', 'admin', 'manager', 'staff', 'viewer']).nullable(),
  name: z.string(),
  rank: z.number(),
  locked: z.boolean(),
  permissions: z.array(z.string()),
  memberCount: z.number(),
});
export type Role = z.infer<typeof Role>;

export const Member = z.object({
  membershipId: z.string(),
  userId: z.string(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  status: z.enum(['active', 'suspended', 'removed']),
  assignments: z.array(z.object({ id: z.string(), roleId: z.string(), roleName: z.string(), scopeType: ScopeType, scopeId: z.string(), scopeName: z.string() })),
  // what the caller may do with this member, with reason codes when not
  canManage: z.boolean(),
  manageBlockedBy: ErrorCode.nullable(),
});
export type Member = z.infer<typeof Member>;

export const InviteInput = z.object({
  email: z.string().email(),
  roleId: z.string(),
  scopeType: ScopeType,
  scopeId: z.string(),
  locale: Locale.default('el'),
});
export type InviteInput = z.infer<typeof InviteInput>;

// which roles the caller can grant at a scope, and why not for the others
export const GrantableRole = z.object({ roleId: z.string(), name: z.string(), rank: z.number(), ok: z.boolean(), blockedBy: ErrorCode.nullable() });
export type GrantableRole = z.infer<typeof GrantableRole>;

// ---------------------------------------------------------------- customer facing

export const Availability = z.object({
  shopId: z.string(),
  shopName: z.string(),
  state: z.enum(['in', 'few', 'out']).nullable(), // null when the merchant hides stock
  qty: z.number().nullable(), // only in exact mode
});
export type Availability = z.infer<typeof Availability>;

export const PublicProduct = z.object({
  id: z.string(),
  orgId: z.string(),
  orgName: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  images: z.array(ProductImage),
  categoryName: z.string().nullable(),
  priceMinor: z.number().nullable(), // null when prices are hidden
  currency: z.string(),
  offer: z.object({ postId: z.string(), priceMinor: z.number(), wasMinor: z.number().nullable(), validUntil: z.number().nullable() }).nullable(),
  availability: z.array(Availability),
  variantId: z.string(),
  waitingForIt: z.boolean(),
  saved: z.boolean(),
});
export type PublicProduct = z.infer<typeof PublicProduct>;

export const FeedItem = z.object({
  post: Post,
  orgName: z.string(),
  shopNames: z.array(z.string()),
});
export type FeedItem = z.infer<typeof FeedItem>;

export const JoinPage = z.object({
  code: z.string(),
  orgName: z.string(),
  scopeName: z.string(),
  scopeType: ScopeType,
  brandColor: z.string().nullable(),
  logoUrl: z.string().nullable(),
  imageUrl: z.string().nullable(),
  disabled: z.boolean(),
  interests: z.array(Category),
});
export type JoinPage = z.infer<typeof JoinPage>;

export const JoinInput = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email(),
  locale: Locale,
  emailNews: z.boolean(),
  push: z.boolean(),
  over15: z.literal(true),
  interests: z.array(z.string()).default([]),
  turnstileToken: z.string().optional(),
});
export type JoinInput = z.infer<typeof JoinInput>;

// ---------------------------------------------------------------- reports

export const DashboardCards = z.object({
  lowStock: z.number(),
  outOfStock: z.number(),
  negativeStock: z.number(),
  peopleWaiting: z.number(),
  newFollowersWeek: z.number(),
  scheduledPosts: z.number(),
  pendingApprovals: z.number(),
  countsInReview: z.number(),
  transfersOnTheWay: z.number(),
  unknownCodes: z.number(),
  stockValueCostMinor: z.number().nullable(), // null without reports.financial.view
  salesTodayMinor: z.number().nullable(),
});
export type DashboardCards = z.infer<typeof DashboardCards>;

export const SeriesPoint = z.object({ day: z.string(), value: z.number() });
export type SeriesPoint = z.infer<typeof SeriesPoint>;

export const Paged = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() });
