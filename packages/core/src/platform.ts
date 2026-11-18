// the platform level above every business: super admins, the businesses they look after, the
// features and limits they set per business, and the emergency switches for the whole platform.

import { z } from 'zod';
import { Locale, zEmail, zLine } from './contract';
import { LIMITS } from './validate';

// features a super admin can switch off for one business. on unless listed in disabledFeatures
export const FEATURES = ['customer_pages', 'posts', 'email', 'push', 'transfers', 'counts', 'reports', 'uploads'] as const;
export const Feature = z.enum(FEATURES);
export type Feature = z.infer<typeof Feature>;

export function featureOn(access: { disabledFeatures?: readonly string[] } | null | undefined, feature: Feature): boolean {
  return !access?.disabledFeatures?.includes(feature);
}

// platform wide emergency switches, on means paused
export const PLATFORM_SWITCHES = ['pause_email', 'pause_push', 'pause_signups', 'pause_invites'] as const;
export const PlatformSwitch = z.enum(PLATFORM_SWITCHES);
export type PlatformSwitch = z.infer<typeof PlatformSwitch>;

export const PlatformSettings = z.object({
  pause_email: z.boolean(),
  pause_push: z.boolean(),
  pause_signups: z.boolean(),
  pause_invites: z.boolean(),
  // refuse new uploads at 95% of the storage free tier (on unless switched off)
  uploads_stop_at_free: z.boolean(),
});
export type PlatformSettings = z.infer<typeof PlatformSettings>;
export const PlatformSettingsPatch = PlatformSettings.partial();
export type PlatformSettingsPatch = z.infer<typeof PlatformSettingsPatch>;

export const OrgStatus = z.enum(['active', 'suspended']);
export type OrgStatus = z.infer<typeof OrgStatus>;

// what a super admin decides for a business. owners can read it, only a super admin changes it
export const OrgControls = z.object({
  status: OrgStatus,
  disabledFeatures: z.array(Feature),
  maxShops: z.number().int().positive().nullable(),
  maxStaff: z.number().int().positive().nullable(),
  // what the limits are measured against, for the screens
  shops: z.number(),
  staff: z.number(),
});
export type OrgControls = z.infer<typeof OrgControls>;

export const OrgControlsPatch = z.object({
  status: OrgStatus.optional(),
  disabledFeatures: z.array(Feature).max(FEATURES.length).optional(),
  maxShops: z.number().int().min(1).max(10_000).nullable().optional(),
  maxStaff: z.number().int().min(1).max(100_000).nullable().optional(),
});
export type OrgControlsPatch = z.infer<typeof OrgControlsPatch>;

export const PendingInvite = z.object({
  id: z.string(),
  email: z.string(),
  createdAt: z.number(),
  expiresAt: z.number(),
  expired: z.boolean(),
});
export type PendingInvite = z.infer<typeof PendingInvite>;

export const PlatformBusiness = z.object({
  orgId: z.string(),
  name: z.string(),
  slug: z.string(),
  createdAt: z.number(),
  defaultLocale: Locale,
  currency: z.string(),
  status: OrgStatus,
  disabledFeatures: z.array(Feature),
  owners: z.array(z.object({ userId: z.string(), name: z.string().nullable(), email: z.string().nullable() })),
  counts: z.object({ shops: z.number(), staff: z.number(), products: z.number(), customers: z.number() }),
  pendingOwnerInvites: z.array(PendingInvite),
  // bytes of the photos this business keeps in storage
  storageBytes: z.number(),
});
export type PlatformBusiness = z.infer<typeof PlatformBusiness>;

export const PlatformBusinessDetail = PlatformBusiness.extend({
  controls: OrgControls,
  shops: z.array(z.object({ id: z.string(), name: z.string() })),
});
export type PlatformBusinessDetail = z.infer<typeof PlatformBusinessDetail>;

// money is summed per currency, a platform can hold businesses in more than one
export const MoneyByCurrency = z.array(z.object({ currency: z.string(), minor: z.number() }));
export type MoneyByCurrency = z.infer<typeof MoneyByCurrency>;

export const PlatformOverview = z.object({
  businesses: z.number(),
  suspended: z.number(),
  shops: z.number(),
  staff: z.number(),
  customers: z.number(),
  products: z.number(),
  salesToday: MoneyByCurrency,
  sales14d: MoneyByCurrency,
  emailsSent14d: z.number(),
  pushesSent14d: z.number(),
  pendingInvites: z.number(),
  storage: z.lazy(() => StorageUse),
});
export type PlatformOverview = z.infer<typeof PlatformOverview>;

// the photo bucket against its free tier. reads go straight from browsers to the public url, the
// app cannot count them (see the bucket's own dashboard)
export const StorageUse = z.object({
  bytesUsed: z.number(),
  bytesFree: z.number(),
  writesThisMonth: z.number(),
  writesFree: z.number(),
  // the higher of the two, 0 to 100 and above
  percent: z.number(),
  stopAtFree: z.boolean(),
  // uploads are refused from this percentage when stopAtFree is on
  stopPercent: z.number(),
});
export type StorageUse = z.infer<typeof StorageUse>;

export const NewBusinessInput = z.object({
  name: zLine(LIMITS.shopName),
  slug: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/).optional(),
  shopName: zLine(LIMITS.shopName).optional(),
  ownerEmail: zEmail,
  ownerName: zLine(LIMITS.personName, 0).optional(),
  locale: Locale.optional(),
});
export type NewBusinessInput = z.infer<typeof NewBusinessInput>;

export const BusinessCreated = z.object({
  orgId: z.string(),
  slug: z.string(),
  inviteId: z.string(),
  link: z.string(),
  emailed: z.boolean(),
});
export type BusinessCreated = z.infer<typeof BusinessCreated>;

export const PlatformInviteInput = z.object({
  email: zEmail,
  locale: Locale.optional(),
});
export type PlatformInviteInput = z.infer<typeof PlatformInviteInput>;

export const SuperAdmin = z.object({
  userId: z.string(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  you: z.boolean(),
});
export type SuperAdmin = z.infer<typeof SuperAdmin>;

export const SuperAdmins = z.object({
  admins: z.array(SuperAdmin),
  invites: z.array(PendingInvite),
});
export type SuperAdmins = z.infer<typeof SuperAdmins>;

// what the super admin invite page shows before anyone signs in
export const PlatformInvitePreview = z.object({
  email: z.string(),
  invitedBy: z.string().nullable(),
  accountExists: z.boolean(),
  expiresAt: z.number(),
});
export type PlatformInvitePreview = z.infer<typeof PlatformInvitePreview>;

export const PlatformAuditEntry = z.object({
  id: z.string(),
  action: z.string(),
  actorName: z.string().nullable(),
  orgId: z.string().nullable(),
  orgName: z.string().nullable(),
  details: z.unknown().nullable(),
  createdAt: z.number(),
});
export type PlatformAuditEntry = z.infer<typeof PlatformAuditEntry>;
