// the platform role and what a super admin decided, read where access and sending are decided:
// lib/context.ts (permissions), routes/platform.ts guards (features, pauses, limits), the worker and
// the live outbox (sending). small and dependency free so all of them can use it.

import { FEATURES, PERMISSION_KEYS, type AccessAssignment, type Feature, type PlatformSettings, type PlatformSwitch } from '@custock/core';
import type { Db } from '@custock/db';
import { parseJson, platform } from './tenant';

export const PLATFORM_RANK = 1000;

export function isSuperadmin(db: Db, userId: string | null | undefined): boolean {
  if (!userId) return false;
  return platform(db).get<{ r: string | null }>('SELECT platform_role AS r FROM users WHERE id = @id AND deleted_at IS NULL', { id: userId })?.r === 'superadmin';
}

// every permission at org scope, above any role a business can hold
export function platformAssignment(orgId: string): AccessAssignment {
  return { id: 'platform', roleId: 'platform', rank: PLATFORM_RANK, permissions: PERMISSION_KEYS, scopeType: 'org', scopeId: orgId };
}

export interface OrgFlags {
  status: 'active' | 'suspended';
  disabledFeatures: Feature[];
  maxShops: number | null;
  maxStaff: number | null;
}

export function orgFlags(db: Db, orgId: string | null | undefined): OrgFlags | null {
  if (!orgId) return null;
  const r = platform(db).get<{ status: 'active' | 'suspended'; disabled_features: string; max_shops: number | null; max_staff: number | null }>(
    'SELECT status, disabled_features, max_shops, max_staff FROM organizations WHERE id = @id',
    { id: orgId },
  );
  if (!r) return null;
  const list = parseJson<string[]>(r.disabled_features, []);
  return {
    status: r.status,
    disabledFeatures: FEATURES.filter((f) => list.includes(f)),
    maxShops: r.max_shops,
    maxStaff: r.max_staff,
  };
}

export function orgFeatureOn(db: Db, orgId: string | null | undefined, feature: Feature): boolean {
  const f = orgFlags(db, orgId);
  return !f || !f.disabledFeatures.includes(feature);
}

// people working in a business, plus invites still open: what the staff limit counts.
// a super admin who is also a member is not counted
export function staffUsed(db: Db, orgId: string, now = Date.now()): number {
  return platform(db).get<{ n: number }>(
    `SELECT (SELECT count(*) FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.org_id = @o AND m.status = 'active' AND u.platform_role IS NULL)
          + (SELECT count(*) FROM invites WHERE org_id = @o AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at >= @now) AS n`,
    { o: orgId, now },
  )!.n;
}

export function shopsUsed(db: Db, orgId: string): number {
  return platform(db).get<{ n: number }>('SELECT count(*) AS n FROM shops WHERE org_id = @o AND archived_at IS NULL', { o: orgId })!.n;
}

// can this business add a shop or invite someone right now? the apps leave the button out when not
export function orgFull(db: Db, orgId: string, f: OrgFlags | null, now = Date.now()): { shopsFull: boolean; staffFull: boolean } {
  const shopsFull = f?.maxShops != null && shopsUsed(db, orgId) >= f.maxShops;
  const staffFull = platformPaused(db, 'pause_invites') || (f?.maxStaff != null && staffUsed(db, orgId, now) >= f.maxStaff);
  return { shopsFull, staffFull };
}

// customer facing pages and the customer app show this business: not paused, pages switched on
export function customerPagesOpen(db: Db, orgId: string): boolean {
  const f = orgFlags(db, orgId);
  return !f || (f.status === 'active' && !f.disabledFeatures.includes('customer_pages'));
}

export function platformSettings(db: Db): PlatformSettings {
  const rows = platform(db).all<{ key: string; value: string }>('SELECT key, value FROM platform_settings');
  const on = (k: PlatformSwitch) => rows.some((r) => r.key === k && r.value === '1');
  // on unless a super admin switched it off
  const stop = rows.find((r) => r.key === 'uploads_stop_at_free');
  return {
    pause_email: on('pause_email'), pause_push: on('pause_push'), pause_signups: on('pause_signups'), pause_invites: on('pause_invites'),
    uploads_stop_at_free: stop ? stop.value === '1' : true,
  };
}

// ---------------------------------------------------------------- photo storage against its free tier

export const STORAGE_STOP_PERCENT = 95;

export function storageFreeTier(env: Record<string, string | undefined> = process.env): { bytes: number; writes: number } {
  const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
  // the R2 free tier: 10 GB stored, 1 million writes (class A) a month
  return { bytes: num(env.CUSTOCK_STORAGE_FREE_BYTES, 10_000_000_000), writes: num(env.CUSTOCK_STORAGE_FREE_WRITES, 1_000_000) };
}

// photos the platform keeps: every confirmed file row not deleted (an upload slot nobody used is
// not a photo, see lib/files.ts). links to outside pictures (made up data) are not ours and not counted
const OWN_FILE = "deleted_at IS NULL AND confirmed_at IS NOT NULL AND storage_key NOT LIKE 'http%'";

export function storageBytes(db: Db, orgId?: string): number {
  return platform(db).get<{ n: number | null }>(
    `SELECT sum(bytes) AS n FROM files WHERE ${OWN_FILE} AND (@org IS NULL OR org_id = @org)`,
    { org: orgId ?? null },
  )?.n ?? 0;
}

function monthStart(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

// every upload slot is a write to the bucket, even when the photo is deleted later
export function storageWritesThisMonth(db: Db, now = Date.now()): number {
  return platform(db).get<{ n: number }>("SELECT count(*) AS n FROM files WHERE created_at >= @from AND confirmed_at IS NOT NULL AND storage_key NOT LIKE 'http%'", { from: monthStart(now) })!.n;
}

export function storageUse(db: Db, now = Date.now()) {
  const free = storageFreeTier();
  const bytesUsed = storageBytes(db);
  const writesThisMonth = storageWritesThisMonth(db, now);
  const percent = Math.max((bytesUsed / free.bytes) * 100, (writesThisMonth / free.writes) * 100);
  return {
    bytesUsed, bytesFree: free.bytes, writesThisMonth, writesFree: free.writes,
    percent: Math.round(percent * 10) / 10,
    stopAtFree: platformSettings(db).uploads_stop_at_free, stopPercent: STORAGE_STOP_PERCENT,
  };
}

// would one more upload of `bytes` cross the stop line? null when it may go
export function storageRefusal(db: Db, bytes: number, now = Date.now()): string | null {
  if (!platformSettings(db).uploads_stop_at_free) return null;
  const free = storageFreeTier();
  const line = STORAGE_STOP_PERCENT / 100;
  if (storageBytes(db) + bytes > free.bytes * line) return 'photo storage is nearly full (free tier)';
  if (storageWritesThisMonth(db, now) + 1 > free.writes * line) return 'the monthly upload allowance is nearly used (free tier)';
  return null;
}

export function platformPaused(db: Db, key: PlatformSwitch): boolean {
  return platform(db).get<{ value: string }>('SELECT value FROM platform_settings WHERE key = @k', { k: key })?.value === '1';
}

// may a message for this business go out now?
//   null       yes
//   'hold'     a platform wide pause: keep it queued, it goes once the pause is lifted
//   a reason   never for this message: the business is paused or the channel is switched off
export function sendGate(db: Db, channel: string, orgId: string | null | undefined): null | 'hold' | 'feature_off' | 'org_suspended' {
  if (channel === 'email' && platformPaused(db, 'pause_email')) return 'hold';
  if (channel === 'push' && platformPaused(db, 'pause_push')) return 'hold';
  const f = orgFlags(db, orgId);
  if (!f) return null;
  if (f.status === 'suspended') return 'org_suspended';
  if (channel === 'email' && f.disabledFeatures.includes('email')) return 'feature_off';
  if (channel === 'push' && f.disabledFeatures.includes('push')) return 'feature_off';
  return null;
}
