// the api contract shared by the server, the web and the phone app.
// shapes follow thinking/14-api-sketch.md and thinking/db/schema.sql.
// money is integer minor units, quantities are integer base units, times are epoch ms.

import { z } from 'zod';

// in the browser the pages run under a Content-Security-Policy without 'unsafe-eval'. zod would try
// Function('') once to see if it may compile schemas, which the policy refuses (and reports), so the
// browser parses without compiling. the server keeps the faster compiled parsers.
if (typeof (globalThis as { window?: unknown }).window !== 'undefined') z.config({ jitless: true });
import { CATEGORY_ICON_KEYS, type CategoryIconKey } from './category-icons';
import {
  LIMITS, MAX_MONEY_MINOR, MAX_QTY_BASE, cleanLine, cleanText, emailProblem, httpsUrlProblem, isAllowedVat,
  normalizeEmail, normalizeOtp, parseBarcodeInput, parsePhone, passwordProblem,
} from './validate';

// ---------------------------------------------------------------- shared field rules
// the same rules as the forms (validate.ts), so the server refuses what a form refuses. a custom
// issue carries the field error code (common.json field.*) as its message.

const str = (v: unknown) => (typeof v === 'string' ? v : v);
// an email, trimmed and lowercased, checked properly
export const zEmail = z.preprocess((v) => (typeof v === 'string' ? normalizeEmail(v) : v), z.string().max(LIMITS.email).superRefine((v, ctx) => {
  const p = emailProblem(v);
  if (p) ctx.addIssue({ code: 'custom', message: p });
}));
// a new password: 10 to 128 characters, no spaces. existing passwords at sign in are not checked
export const zNewPassword = z.string().max(LIMITS.passwordMax + 72).superRefine((v, ctx) => {
  const p = passwordProblem(v);
  if (p) ctx.addIssue({ code: 'custom', message: p });
});
// a single line of text: edges trimmed, spaces collapsed, control characters out
export const zLine = (max: number, min = 1) =>
  z.preprocess((v) => (typeof v === 'string' ? cleanLine(v) : str(v)), z.string().min(min, { message: min ? 'empty' : undefined }).max(max, { message: 'tooLong' }));
// multi line text: only the edges trimmed
export const zText = (max: number) => z.preprocess((v) => (typeof v === 'string' ? cleanText(v) : str(v)), z.string().max(max, { message: 'tooLong' }));
// a phone number, stored as E.164 (+30 for greek numbers without a code)
export const zPhone = z.preprocess((v) => {
  if (typeof v !== 'string') return v;
  if (!v.trim()) return v.trim();
  const r = parsePhone(v);
  return r.ok ? r.value : `!${r.error}`;
}, z.string().max(LIMITS.phone).superRefine((v, ctx) => {
  if (v.startsWith('!')) ctx.addIssue({ code: 'custom', message: v.slice(1) });
}));
// a barcode as typed: spaces and dashes out, check digit for gtin lengths
export const zBarcode = z.preprocess((v) => {
  if (typeof v !== 'string') return v;
  // a scanned gs1 digital link stays a link, the server reads the gtin out of it
  if (/^https?:\/\//i.test(v.trim())) return v.trim();
  const r = parseBarcodeInput(v);
  return r.ok ? r.value : `!${r.error}`;
}, z.string().min(1).max(500).superRefine((v, ctx) => {
  if (v.startsWith('!')) ctx.addIssue({ code: 'custom', message: v.slice(1) });
}));
// a one time code: digits only, spaces and dashes from a paste removed
export const zOtp = z.preprocess((v) => (typeof v === 'string' ? normalizeOtp(v) : v), z.string().length(LIMITS.otp, { message: 'invalid' }));
// an https link
export const zHttpsUrl = z.string().max(LIMITS.url).superRefine((v, ctx) => {
  const p = httpsUrlProblem(v, { required: true });
  if (p) ctx.addIssue({ code: 'custom', message: p });
});
export const zMoneyMinor = z.number().int().min(0, { message: 'negative' }).max(MAX_MONEY_MINOR, { message: 'tooLarge' });
export const zQtyBase = z.number().int().min(-MAX_QTY_BASE, { message: 'tooLarge' }).max(MAX_QTY_BASE, { message: 'tooLarge' });
export const zVatBp = z.number().int().refine((n) => isAllowedVat(n), { message: 'invalid' });

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
  'join_link_disabled', 'already_subscribed', 'account_exists', 'internal',
  // platform: a feature the super admin switched off, a paused business, a limit, an emergency pause
  'feature_off', 'org_suspended', 'limit_reached', 'platform_paused', 'last_superadmin', 'storage_full',
  // a forgot password link that was used, expired or never existed
  'reset_expired',
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

export const LoginInput = z.object({ email: zEmail, password: z.string().min(1).max(200) });
// forgot password. the answer is the same whether or not the email has an account
export const PasswordForgotInput = z.object({ email: zEmail, locale: Locale.optional() });
export type PasswordForgotInput = z.infer<typeof PasswordForgotInput>;
export const PasswordResetInput = z.object({ token: z.string().min(10).max(200), password: zNewPassword });
export type PasswordResetInput = z.infer<typeof PasswordResetInput>;
export const OtpRequestInput = z.object({ email: zEmail, locale: Locale.optional() });
export const OtpVerifyInput = z.object({ email: zEmail, code: zOtp });

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
  // set for a super admin who is not a member: access comes from the platform role
  platformAccess: z.boolean().optional(),
  // the business is paused by a super admin, its staff see a paused screen
  suspended: z.boolean().optional(),
  // features a super admin switched off for this business (see platform.ts FEATURES)
  disabledFeatures: z.array(z.string()).optional(),
  // a limit is reached (or new staff invites are paused): the apps leave out the add button
  shopsFull: z.boolean().optional(),
  staffFull: z.boolean().optional(),
});
export type OrgAccess = z.infer<typeof OrgAccess>;

export const MeContext = z.object({
  user: z.object({
    id: z.string(),
    email: z.string().nullable(),
    displayName: z.string().nullable(),
    locale: Locale,
    // the profile photo, null shows the initials
    avatarUrl: z.string().nullable().optional(),
  }),
  orgs: z.array(OrgAccess),
  following: z.array(z.object({ orgId: z.string(), orgName: z.string(), orgSlug: z.string(), customerId: z.string() })),
  // 'superadmin' sits above every business owner. null or missing for everyone else
  platformRole: z.enum(['superadmin']).nullable().optional(),
  // platform wide pauses that are on right now, only sent to a super admin (for the banner)
  platformPaused: z.array(z.string()).optional(),
  // how full the photo storage free tier is, 0 to 100, only sent to a super admin (70 and 90 warn)
  storagePercent: z.number().optional(),
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
  // the category's built in picture, used where the product has no photo
  categoryIconKey: z.string().nullable().optional(),
  name: z.string(), // the org default language, the one to edit
  // the name in the reader's language (Accept-Language, else the user's language, else the org default)
  displayName: z.string().optional(),
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

// names: every language that has one, only for people who manage categories
// a category's picture is one of two: a built in icon (iconKey) or its own photo (imageUrl)
export const CategoryIcon = z.enum(CATEGORY_ICON_KEYS as [CategoryIconKey, ...CategoryIconKey[]]);
export const Category = z.object({
  id: z.string(), parentId: z.string().nullable(), name: z.string(), names: z.record(z.string(), z.string()).optional(),
  iconKey: z.string().nullable().optional(),
  imageUrl: z.string().nullable().optional(),
});
// iconKey and imageFileId replace each other: setting one clears the other, null on both removes the picture
export const CategoryInput = z.object({
  name: zLine(LIMITS.categoryName),
  translations: z.partialRecord(z.enum(['en', 'el', 'ru']), zLine(LIMITS.categoryName, 0).nullable()).optional(),
  iconKey: CategoryIcon.nullable().optional(),
  imageFileId: z.string().max(64).nullable().optional(),
});
export type CategoryInput = z.infer<typeof CategoryInput>;
export type Category = z.infer<typeof Category>;

// one variant in a product form. with an id it updates that variant, without one it adds a variant.
// barcodes are the full list for that variant.
export const VariantInput = z.object({
  id: z.string().max(64).optional(),
  sku: zLine(LIMITS.sku, 0).nullable().optional(),
  options: z.record(zLine(LIMITS.optionName), zLine(LIMITS.optionValue)).nullable().optional(),
  priceMinor: zMoneyMinor.nullable().optional(),
  costMinor: zMoneyMinor.nullable().optional(),
  barcodes: z.array(z.object({ code: zBarcode, packQty: z.number().int().positive().max(10000).default(1) })).max(20).optional(),
});
export type VariantInput = z.infer<typeof VariantInput>;

export const ProductInput = z.object({
  name: zLine(LIMITS.productName),
  description: zText(LIMITS.description).nullable().optional(),
  brand: zLine(LIMITS.brand, 0).nullable().optional(),
  categoryId: z.string().nullable().optional(),
  uom: Uom.default('piece'),
  taxRateBp: zVatBp.default(2400),
  trackStock: z.boolean().default(true),
  priceMinor: zMoneyMinor.nullable().optional(),
  costMinor: zMoneyMinor.nullable().optional(),
  barcode: zBarcode.optional(),
  // the full list of variants. leave it out to keep the variants as they are (or one default variant on create).
  // variants left out of the list are archived when they have history, deleted otherwise.
  variants: z.array(VariantInput).min(1).max(50).optional(),
  // the full list of photos, in order. https, or an upload url from presignUpload.
  imageUrls: z.array(z.string().url().max(2000)).max(10).optional(),
});
export type ProductInput = z.infer<typeof ProductInput>;

// ---------------------------------------------------------------- stock

export const StockLevel = z.object({
  shopId: z.string(),
  variantId: z.string(),
  onHand: z.number(),
  inTransitIn: z.number(),
  reorderPoint: z.number().nullable(),
  // the shop's own price, when it differs from the base price (null: the base price applies)
  priceOverrideMinor: z.number().int().nullable().optional(),
  lastMovementAt: z.number().nullable(),
  waiting: z.number(), // customers waiting with notify me, for this shop or any shop
});
export type StockLevel = z.infer<typeof StockLevel>;

export const MovementInput = z.object({
  id: z.string().min(8).max(64), // uuid v7 made on the device, idempotency key
  shopId: z.string(),
  variantId: z.string(),
  qtyDelta: zQtyBase.refine((n) => n !== 0, 'zero'),
  kind: MovementKind,
  reason: AdjustReason.optional(),
  note: zText(LIMITS.note).optional(),
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
  // product and variant name in the reader's language
  productName: z.string().nullable().optional(),
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
  // the photo the person chose for their account, if they have one
  avatarUrl: z.string().nullable().optional(),
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

export const PostText = z.object({ title: zLine(LIMITS.postTitle), body: zText(LIMITS.postBody) });

export const Audience = z.object({
  scopes: z.array(z.object({ scopeType: ScopeType, scopeId: z.string().max(64) })).min(1).max(50),
  tags: z.array(z.string().max(40)).max(50).default([]),
  interests: z.array(z.string().max(64)).max(50).default([]),
  locales: z.array(Locale).max(3).default([]),
  savedAnyLinked: z.boolean().default(false),
  joinedWithinDays: z.number().int().nullable().default(null),
});
export type Audience = z.infer<typeof Audience>;

export const PostInput = z.object({
  kind: PostKind,
  defaultLocale: Locale,
  translations: z.partialRecord(Locale, PostText), // only the default language is required
  channels: z.array(Channel).min(1),
  audience: Audience,
  products: z.array(z.object({ variantId: z.string().max(64), offerPriceMinor: zMoneyMinor.nullable().default(null) })).max(100).default([]),
  coverUrl: z.string().max(2000).nullable().default(null),
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
  avatarUrl: z.string().nullable().optional(),
  status: z.enum(['active', 'suspended', 'removed']),
  assignments: z.array(z.object({ id: z.string(), roleId: z.string(), roleName: z.string(), scopeType: ScopeType, scopeId: z.string(), scopeName: z.string() })),
  // what the caller may do with this member, with reason codes when not
  canManage: z.boolean(),
  manageBlockedBy: ErrorCode.nullable(),
});
export type Member = z.infer<typeof Member>;

export const InviteInput = z.object({
  email: zEmail,
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
  // the business's page is /s/<orgSlug>, for the way in from a shelf QR
  orgSlug: z.string().optional(),
  // the business's time zone, for dates like the end of an offer
  timezone: z.string().optional(),
  name: z.string(),
  description: z.string().nullable(),
  images: z.array(ProductImage),
  categoryName: z.string().nullable(),
  categoryId: z.string().nullable().optional(),
  categoryIconKey: z.string().nullable().optional(),
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
  // the business's page is /s/<orgSlug>. optional so older clients and fixtures still fit
  orgSlug: z.string().optional(),
  scopeName: z.string(),
  scopeType: ScopeType,
  brandColor: z.string().nullable(),
  logoUrl: z.string().nullable(),
  imageUrl: z.string().nullable(),
  disabled: z.boolean(),
  interests: z.array(Category),
  // the business's own push limits, so the page promises what it keeps
  pushDailyCap: z.number().int().optional(),
  quietHours: z.string().optional(),
});
export type JoinPage = z.infer<typeof JoinPage>;

// a person's name on the public join page: letters (any script), spaces and . ' - only, so the
// page cannot be used to put links or other text in front of people
export const PERSON_NAME = /^[\p{L}\p{M}][\p{L}\p{M} .'’-]*$/u;
export const JoinInput = z.object({
  name: zLine(40).pipe(z.string().regex(PERSON_NAME, { message: 'invalid' })),
  email: zEmail,
  locale: Locale,
  emailNews: z.boolean(),
  push: z.boolean(),
  over15: z.literal(true),
  interests: z.array(z.string().max(64)).max(20).default([]),
  turnstileToken: z.string().max(2048).optional(),
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

// ---------------------------------------------------------------- stage 2 additions

export const ShopVariantSettingsInput = z.object({
  priceOverrideMinor: zMoneyMinor.nullable().optional(),
  isListed: z.boolean().optional(),
  reorderPoint: zQtyBase.pipe(z.number().min(0, { message: 'negative' })).nullable().optional(),
  reorderQty: zQtyBase.pipe(z.number().min(0, { message: 'negative' })).nullable().optional(),
});
export type ShopVariantSettingsInput = z.infer<typeof ShopVariantSettingsInput>;

export const UncountedPolicy = z.enum(['ignore', 'set_zero']);
export type UncountedPolicy = z.infer<typeof UncountedPolicy>;

export const StockCountLine = z.object({
  variantId: z.string(),
  productId: z.string(),
  name: z.string(),
  countedQty: z.number(),
  expectedQty: z.number(),
  difference: z.number(),
  differenceCostMinor: z.number().nullable(), // only with products.cost.view
  countedBy: z.string(),
  countedByName: z.string().nullable(),
  countedAt: z.number(),
});
export type StockCountLine = z.infer<typeof StockCountLine>;

export const StockCount = z.object({
  id: z.string(),
  shopId: z.string(),
  kind: z.enum(['full', 'partial']),
  filter: z.record(z.string(), z.string()).nullable(),
  status: z.enum(['open', 'review', 'applied', 'cancelled']),
  startedBy: z.string(),
  startedAt: z.number(),
  submittedAt: z.number().nullable(),
  appliedBy: z.string().nullable(),
  appliedAt: z.number().nullable(),
  uncountedPolicy: UncountedPolicy.nullable(),
  lines: z.array(StockCountLine),
});
export type StockCount = z.infer<typeof StockCount>;

export const TransferLine = z.object({
  variantId: z.string(),
  name: z.string(),
  qtySent: z.number(),
  qtyReceived: z.number().nullable(),
  lost: z.number(), // sent minus received once received
});
export type TransferLine = z.infer<typeof TransferLine>;

export const Transfer = z.object({
  id: z.string(),
  fromShopId: z.string(),
  toShopId: z.string(),
  // both names, so a shop that only receives still sees where it comes from
  fromShopName: z.string().optional(),
  toShopName: z.string().optional(),
  status: z.enum(['draft', 'sent', 'received', 'cancelled']),
  note: z.string().nullable(),
  createdBy: z.string(),
  createdAt: z.number(),
  sentAt: z.number().nullable(),
  receivedAt: z.number().nullable(),
  lines: z.array(TransferLine),
});
export type Transfer = z.infer<typeof Transfer>;

export const TransferInput = z.object({
  fromShopId: z.string(),
  toShopId: z.string(),
  note: zText(LIMITS.note).optional(),
  lines: z.array(z.object({ variantId: z.string().max(64), qty: zQtyBase.pipe(z.number().positive()) })).min(1).max(500),
});
export type TransferInput = z.infer<typeof TransferInput>;

export const AddCustomerInput = z.object({
  name: zLine(120),
  email: zEmail.optional(),
  phone: zPhone.optional(),
  locale: Locale.default('el'),
  shopId: z.string().max(64),
  emailNews: z.boolean().default(false),
  push: z.boolean().default(false),
  tags: z.array(z.string().min(1).max(40)).max(30).default([]),
});
export type AddCustomerInput = z.infer<typeof AddCustomerInput>;

export const Invite = z.object({
  id: z.string(),
  email: z.string(),
  roleId: z.string(),
  roleName: z.string(),
  scopeType: ScopeType,
  scopeId: z.string(),
  // null for the first owner of a business, invited by the server setup
  invitedBy: z.string().nullable(),
  createdAt: z.number(),
  expiresAt: z.number(),
});
export type Invite = z.infer<typeof Invite>;

export const AuditEntry = z.object({
  id: z.string(),
  actorId: z.string().nullable(),
  actorName: z.string().nullable(),
  actorAvatarUrl: z.string().nullable().optional(),
  actorKind: z.string(),
  action: z.string(),
  entityType: z.string().nullable(),
  entityId: z.string().nullable(),
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
  createdAt: z.number(),
});
export type AuditEntry = z.infer<typeof AuditEntry>;

export const DevOutboxItem = z.object({
  id: z.string(),
  channel: z.enum(['email', 'push', 'webpush', 'sms']),
  orgId: z.string().nullable(),
  userId: z.string().nullable(),
  customerId: z.string().nullable(),
  to: z.string().nullable(),
  locale: z.string().nullable(),
  title: z.string().nullable(),
  body: z.string().nullable(),
  // emails: the html that goes out next to the plain text body
  html: z.string().nullable().optional(),
  payload: z.unknown().nullable(),
  createdAt: z.number(),
});
export type DevOutboxItem = z.infer<typeof DevOutboxItem>;

export const SyncResult = z.object({
  cursor: z.string(),
  full: z.boolean(),
  products: z.array(Product),
  levels: z.array(StockLevel),
  categories: z.array(Category),
  tombstones: z.object({ products: z.array(z.string()), variants: z.array(z.string()), barcodes: z.array(z.string()) }),
});
export type SyncResult = z.infer<typeof SyncResult>;

export const StockAlertItem = z.object({
  id: z.string(),
  orgId: z.string(),
  orgName: z.string(),
  variantId: z.string(),
  productId: z.string(),
  productName: z.string(),
  imageUrl: z.string().nullable(),
  shopId: z.string().nullable(),
  shopName: z.string().nullable(),
  status: z.enum(['waiting', 'notified', 'cancelled']),
  createdAt: z.number(),
  notifiedAt: z.number().nullable(),
});
export type StockAlertItem = z.infer<typeof StockAlertItem>;

export const UnsubscribePage = z.object({
  orgName: z.string(),
  scopeName: z.string(),
  email: z.string().nullable(), // masked
  locale: Locale,
});
export type UnsubscribePage = z.infer<typeof UnsubscribePage>;

// ---------------------------------------------------------------- uploads

// avatar is the person's own photo (POST /v1/me/uploads/presign), the rest belong to a business
export const UploadPurpose = z.enum(['product', 'post', 'logo', 'shop', 'avatar', 'category']);
export type UploadPurpose = z.infer<typeof UploadPurpose>;

export const PresignInput = z.object({
  purpose: UploadPurpose,
  mime: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  // the hard ceiling, the size in force is the policy uploads.maxMegabytes
  bytes: z.number().int().positive().max(10_000_000),
});
export type PresignInput = z.infer<typeof PresignInput>;

// PUT the file to uploadUrl with these headers, then use publicUrl (in imageUrls, coverUrl).
export const PresignResult = z.object({
  fileId: z.string(),
  uploadUrl: z.string(),
  method: z.literal('PUT'),
  headers: z.record(z.string(), z.string()),
  publicUrl: z.string(),
  expiresAt: z.number(),
});
export type PresignResult = z.infer<typeof PresignResult>;

// ---------------------------------------------------------------- web push

// the push services browsers use. a subscription endpoint must be https on one of these hosts,
// so a stored endpoint can never make the server call somewhere else.
export const PUSH_SERVICE_HOSTS = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'] as const;
export const PUSH_SERVICE_SUFFIXES = ['.notify.windows.com', '.push.apple.com'] as const;

export function isPushServiceEndpoint(endpoint: string): boolean {
  let u: URL;
  try {
    u = new URL(endpoint);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return false;
  const host = u.hostname.toLowerCase();
  return (PUSH_SERVICE_HOSTS as readonly string[]).includes(host) || PUSH_SERVICE_SUFFIXES.some((s) => host.endsWith(s) && host.length > s.length);
}

// the browser's PushSubscription.toJSON(), plus which business this home screen app belongs to
export const PushSubscriptionInput = z.object({
  endpoint: z.string().max(1000).refine(isPushServiceEndpoint, 'not a known push service'),
  keys: z.object({
    p256dh: z.string().min(16).max(200).regex(/^[A-Za-z0-9_-]+=*$/),
    auth: z.string().min(8).max(100).regex(/^[A-Za-z0-9_-]+=*$/),
  }),
  orgId: z.string().max(64).nullable().optional(),
  locale: Locale.optional(),
});
export type PushSubscriptionInput = z.infer<typeof PushSubscriptionInput>;

// ---------------------------------------------------------------- invites without email

// what the invite link page shows before anyone signs in
export const InvitePreview = z.object({
  orgName: z.string(),
  scopeName: z.string(),
  roleName: z.string(),
  email: z.string(),
  // true: sign in with that account and accept. false: set a name and password to make one
  accountExists: z.boolean(),
  expiresAt: z.number(),
});
export type InvitePreview = z.infer<typeof InvitePreview>;

export const InviteRegisterInput = z.object({
  token: z.string().min(10).max(200),
  displayName: zLine(LIMITS.personName),
  password: zNewPassword,
  locale: Locale.optional(),
});
export type InviteRegisterInput = z.infer<typeof InviteRegisterInput>;

// the invite was created. link is the accept link for sharing by hand, emailed says whether it
// also went out by email (only when sending is live)
export const InviteCreated = z.object({
  id: z.string(),
  link: z.string(),
  emailed: z.boolean(),
  devLink: z.string().optional(),
});
export type InviteCreated = z.infer<typeof InviteCreated>;

export const ShopInput = z.object({
  name: zLine(LIMITS.shopName),
  slug: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/).optional(),
  city: zLine(LIMITS.city, 0).nullable().optional(),
  address: zLine(LIMITS.address, 0).nullable().optional(),
  phone: zPhone.nullable().optional(),
  email: zEmail.nullable().optional(),
});
export type ShopInput = z.infer<typeof ShopInput>;
