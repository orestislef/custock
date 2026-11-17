// who a post reaches and why, from thinking/06: most specific subscription wins, consent per
// channel, push only with a device, the daily push cap, quiet hours, suppressed emails

import { followsShop, shopsInScope, type Audience, type AudiencePreview, type Channel, type Subscription, type Topology } from '@custock/core';
import type { Db } from '@custock/db';
import type { OrgRow } from '../types';
import { platform, Tenant } from '../lib/tenant';
import { inQuietHours, localDayStart } from '../lib/time';

const DAY = 86_400_000;

export interface Recipient {
  customerId: string;
  locale: 'en' | 'el' | 'ru';
  userId: string | null;
  email: string | null;
  emailVerified: boolean;
  emailOk: boolean;
  pushOk: boolean;
  hasDevice: boolean;
  suppressed: boolean;
  pushesToday: number;
  scopeIndex: number;
}

export function resolveAudience(db: Db, org: OrgRow, topology: Topology, audience: Audience, opts: { now: number; productIds?: string[] }): Recipient[] {
  const t = new Tenant(db, org.id);
  const customers = t.all<{ id: string; locale: Recipient['locale']; user_id: string | null; email: string | null; email_verified_at: number | null; email_ok: number; push_ok: number; created_at: number }>(
    'SELECT id, locale, user_id, email, email_verified_at, email_ok, push_ok, created_at FROM customers WHERE org_id = @org AND erased_at IS NULL',
  );
  const subsRows = t.all<{ customer_id: string; scope_type: Subscription['scopeType']; scope_id: string; status: Subscription['status'] }>(
    'SELECT customer_id, scope_type, scope_id, status FROM customer_subscriptions WHERE org_id = @org',
  );
  const subs = new Map<string, Subscription[]>();
  for (const s of subsRows) subs.set(s.customer_id, [...(subs.get(s.customer_id) ?? []), { scopeType: s.scope_type, scopeId: s.scope_id, status: s.status }]);
  const tags = audience.tags.length
    ? new Set(t.all<{ customer_id: string }>('SELECT DISTINCT customer_id FROM customer_tags WHERE org_id = @org AND tag IN (SELECT value FROM json_each(@tags))', { tags: audience.tags }).map((r) => r.customer_id))
    : null;
  const interests = audience.interests.length
    ? new Set(t.all<{ customer_id: string }>('SELECT DISTINCT customer_id FROM customer_interests WHERE org_id = @org AND category_id IN (SELECT value FROM json_each(@ids))', { ids: audience.interests }).map((r) => r.customer_id))
    : null;
  const saved = audience.savedAnyLinked && opts.productIds?.length
    ? new Set(t.all<{ customer_id: string }>('SELECT DISTINCT customer_id FROM customer_favorites WHERE org_id = @org AND product_id IN (SELECT value FROM json_each(@ids))', { ids: opts.productIds }).map((r) => r.customer_id))
    : null;
  const scopeShops = audience.scopes.map((s) => shopsInScope(topology, s));
  const devices = new Set(
    platform(db)
      .all<{ user_id: string }>('SELECT DISTINCT user_id FROM devices WHERE revoked_at IS NULL AND fcm_token IS NOT NULL')
      .map((r) => r.user_id),
  );
  const suppressed = new Set(platform(db).all<{ email: string }>('SELECT email FROM email_suppressions').map((r) => r.email));
  const dayStart = localDayStart(opts.now, org.timezone);
  const pushes = new Map(
    t.all<{ customer_id: string; n: number }>(
      `SELECT customer_id, count(*) AS n FROM deliveries WHERE org_id = @org AND channel = 'push' AND post_id IS NOT NULL
         AND status IN ('queued', 'held', 'sent', 'opened', 'clicked') AND created_at >= @since GROUP BY customer_id`,
      { since: dayStart },
    ).map((r) => [r.customer_id, r.n]),
  );

  const out: Recipient[] = [];
  for (const c of customers) {
    const s = subs.get(c.id) ?? [];
    const scopeIndex = scopeShops.findIndex((shops) => shops.some((shop) => followsShop(s, topology, shop)));
    if (scopeIndex < 0) continue;
    if (tags && !tags.has(c.id)) continue;
    if (interests && !interests.has(c.id)) continue;
    if (audience.locales.length && !audience.locales.includes(c.locale)) continue;
    if (audience.joinedWithinDays != null && c.created_at < opts.now - audience.joinedWithinDays * DAY) continue;
    if (saved && !saved.has(c.id)) continue;
    out.push({
      customerId: c.id,
      locale: c.locale,
      userId: c.user_id,
      email: c.email,
      emailVerified: !!c.email_verified_at,
      emailOk: !!c.email_ok,
      pushOk: !!c.push_ok,
      hasDevice: !!c.user_id && devices.has(c.user_id),
      suppressed: !!c.email && suppressed.has(c.email),
      pushesToday: pushes.get(c.id) ?? 0,
      scopeIndex,
    });
  }
  return out;
}

export function canPush(r: Recipient, cap: number): 'ok' | 'no_device' | 'no_consent' | 'cap_reached' {
  if (!r.hasDevice) return 'no_device';
  if (!r.pushOk) return 'no_consent';
  if (r.pushesToday >= cap) return 'cap_reached';
  return 'ok';
}

export function canEmail(r: Recipient): 'ok' | 'no_consent' | 'suppressed' {
  if (!r.email || !r.emailVerified || !r.emailOk) return 'no_consent';
  if (r.suppressed) return 'suppressed';
  return 'ok';
}

export function previewAudience(
  db: Db,
  org: OrgRow,
  topology: Topology,
  audience: Audience,
  channels: Channel[] | string[],
  opts: { now: number; productIds?: string[]; scopeName: (type: string, id: string) => string },
): AudiencePreview {
  const list = resolveAudience(db, org, topology, audience, opts);
  const wantPush = channels.includes('push');
  const wantEmail = channels.includes('email');
  const byLocale: Record<string, number> = {};
  for (const r of list) byLocale[r.locale] = (byLocale[r.locale] ?? 0) + 1;
  const push = list.map((r) => canPush(r, org.push_daily_cap));
  const email = list.map((r) => canEmail(r));
  return {
    total: list.length,
    byScope: audience.scopes.map((s, i) => ({
      scopeType: s.scopeType,
      scopeId: s.scopeId,
      name: opts.scopeName(s.scopeType, s.scopeId),
      count: list.filter((r) => r.scopeIndex === i).length,
    })),
    byLocale,
    push: {
      count: wantPush ? push.filter((x) => x === 'ok').length : 0,
      turnedOff: wantPush ? push.filter((x) => x === 'no_consent').length : 0,
      noApp: wantPush ? push.filter((x) => x === 'no_device').length : 0,
      capReached: wantPush ? push.filter((x) => x === 'cap_reached').length : 0,
      heldForQuietHours: wantPush && inQuietHours(opts.now, org.quiet_hours, org.timezone),
    },
    email: {
      count: wantEmail ? email.filter((x) => x === 'ok').length : 0,
      unconfirmed: wantEmail ? list.filter((r) => r.email && !r.emailVerified).length : 0,
      suppressed: wantEmail ? email.filter((x) => x === 'suppressed').length : 0,
    },
  };
}
