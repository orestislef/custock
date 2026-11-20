// drizzle schema for the tables queried through drizzle. the sql in migrations/ is the source of
// truth, these definitions mirror it. raw sql through the tenant helper is used for the rest.

import { sqliteTable, text, integer, real, primaryKey } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email'),
  phone: text('phone'),
  displayName: text('display_name'),
  passwordHash: text('password_hash'),
  emailVerifiedAt: integer('email_verified_at'),
  locale: text('locale').notNull(),
  isPlatformAdmin: integer('is_platform_admin').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  deletedAt: integer('deleted_at'),
});

export const organizations = sqliteTable('organizations', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  country: text('country').notNull(),
  currency: text('currency').notNull(),
  timezone: text('timezone').notNull(),
  defaultLocale: text('default_locale').notNull(),
  logoFileId: text('logo_file_id'),
  brandColor: text('brand_color'),
  allowNegativeStock: integer('allow_negative_stock').notNull(),
  postsNeedApproval: integer('posts_need_approval').notNull(),
  pushDailyCap: integer('push_daily_cap').notNull(),
  quietHours: text('quiet_hours').notNull(),
  customerCatalog: text('customer_catalog').notNull(),
  customerPrices: integer('customer_prices').notNull(),
  customerStock: text('customer_stock').notNull(),
  customerNews: text('customer_news').notNull(),
  fewLeftThreshold: integer('few_left_threshold').notNull(),
  supportAccessUntil: integer('support_access_until'),
  createdAt: integer('created_at').notNull(),
  archivedAt: integer('archived_at'),
});

export const shops = sqliteTable('shops', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull(),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  address: text('address'),
  city: text('city'),
  phone: text('phone'),
  email: text('email'),
  timezone: text('timezone'),
  lat: real('lat'),
  lng: real('lng'),
  openingHours: text('opening_hours'),
  imageFileId: text('image_file_id'),
  customerVisible: integer('customer_visible').notNull(),
  customerStock: text('customer_stock'),
  createdAt: integer('created_at').notNull(),
  archivedAt: integer('archived_at'),
});

export const shopGroups = sqliteTable('shop_groups', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull(),
  name: text('name').notNull(),
  createdAt: integer('created_at').notNull(),
  archivedAt: integer('archived_at'),
});

export const shopGroupShops = sqliteTable(
  'shop_group_shops',
  {
    orgId: text('org_id').notNull(),
    groupId: text('group_id').notNull(),
    shopId: text('shop_id').notNull(),
    addedAt: integer('added_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.shopId] })],
);

export const roles = sqliteTable('roles', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull(),
  templateKey: text('template_key'),
  name: text('name').notNull(),
  rank: integer('rank').notNull(),
  isLocked: integer('is_locked').notNull(),
  createdBy: text('created_by'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  archivedAt: integer('archived_at'),
});

export const memberships = sqliteTable('memberships', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull(),
  userId: text('user_id').notNull(),
  status: text('status').notNull(),
  permsVersion: integer('perms_version').notNull(),
  joinedAt: integer('joined_at').notNull(),
  removedAt: integer('removed_at'),
});

export const categories = sqliteTable('categories', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull(),
  parentId: text('parent_id'),
  name: text('name').notNull(),
  sort: integer('sort').notNull(),
  archivedAt: integer('archived_at'),
});

export const products = sqliteTable('products', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull(),
  categoryId: text('category_id'),
  name: text('name').notNull(),
  description: text('description'),
  brand: text('brand'),
  uom: text('uom').notNull(),
  taxRateBp: integer('tax_rate_bp').notNull(),
  trackStock: integer('track_stock').notNull(),
  customerVisible: integer('customer_visible').notNull(),
  customerStockHidden: integer('customer_stock_hidden').notNull(),
  searchKey: text('search_key').notNull(),
  createdBy: text('created_by'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  archivedAt: integer('archived_at'),
});

export const productVariants = sqliteTable('product_variants', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull(),
  productId: text('product_id').notNull(),
  sku: text('sku'),
  options: text('options'),
  priceMinor: integer('price_minor'),
  costMinor: integer('cost_minor'),
  isDefault: integer('is_default').notNull(),
  sort: integer('sort').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  archivedAt: integer('archived_at'),
});

export const customers = sqliteTable('customers', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull(),
  userId: text('user_id'),
  name: text('name'),
  email: text('email'),
  emailVerifiedAt: integer('email_verified_at'),
  phone: text('phone'),
  phoneVerifiedAt: integer('phone_verified_at'),
  locale: text('locale').notNull(),
  birthday: text('birthday'),
  emailOk: integer('email_ok').notNull(),
  pushOk: integer('push_ok').notNull(),
  smsOk: integer('sms_ok').notNull(),
  source: text('source').notNull(),
  joinLinkId: text('join_link_id'),
  searchKey: text('search_key'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  erasedAt: integer('erased_at'),
});

export const posts = sqliteTable('posts', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull(),
  kind: text('kind').notNull(),
  status: text('status').notNull(),
  defaultLocale: text('default_locale').notNull(),
  channels: text('channels').notNull(),
  audience: text('audience').notNull(),
  coverFileId: text('cover_file_id'),
  scheduledAt: integer('scheduled_at'),
  validFrom: integer('valid_from'),
  validUntil: integer('valid_until'),
  authorId: text('author_id').notNull(),
  approvedBy: text('approved_by'),
  sentAt: integer('sent_at'),
  recipientsCount: integer('recipients_count'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  deletedAt: integer('deleted_at'),
});

export const devOutbox = sqliteTable('dev_outbox', {
  id: text('id').primaryKey(),
  channel: text('channel').notNull(),
  orgId: text('org_id'),
  userId: text('user_id'),
  customerId: text('customer_id'),
  toAddress: text('to_address'),
  locale: text('locale'),
  title: text('title'),
  body: text('body'),
  payload: text('payload'),
  createdAt: integer('created_at').notNull(),
});
