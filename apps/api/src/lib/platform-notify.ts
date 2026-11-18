// pushes for super admins: a new error, photo storage crossing 70% or 90% of the free tier, and a
// new owner joining a business. they go to the staff app on every device a super admin turned
// alerts on (subscriptions without a business), through the normal outbox. the platform wide push
// pause does not hold them, they are how the super admin hears that something needs him.

import { pickLocale, translator } from '@custock/i18n';
import type { Db } from '@custock/db';
import { platform } from './tenant';
import { devOutboxTransport } from './transport';
import { storageUse } from './platform-access';

export type PlatformAlert = 'error' | 'storage' | 'owner' | 'budget';
export const PLATFORM_ALERT_TYPE = 'platform_alert';

let webBase = 'http://localhost:3000';
export function setPlatformNotifyBase(url: string | undefined) {
  if (url) webBase = url.replace(/\/$/, '');
}

export function pushSuperadmins(
  db: Db,
  alert: PlatformAlert,
  params: Record<string, string | number>,
  opts: { path: string; tag: string },
): number {
  const p = platform(db);
  const admins = p.all<{ id: string; locale: string | null }>(
    "SELECT id, locale FROM users WHERE platform_role = 'superadmin' AND deleted_at IS NULL",
  );
  const outbox = devOutboxTransport(db, () => {});
  for (const a of admins) {
    const tr = translator(pickLocale(a.locale), 'server');
    outbox.send({
      channel: 'push', userId: a.id, orgId: null, locale: a.locale,
      title: tr(`push.platform.${alert}.title`, params),
      body: tr(`push.platform.${alert}.body`, params),
      payload: { type: PLATFORM_ALERT_TYPE, alert, tag: opts.tag, url: `${webBase}${opts.path}` },
    });
  }
  return admins.length;
}

// storage crossing a line: told once per line, again only after it went back under and up again
const LINES = [70, 90] as const;
export function checkStorageAlert(db: Db, now = Date.now()): number | null {
  const p = platform(db);
  const pct = storageUse(db, now).percent;
  const reached = [...LINES].reverse().find((l) => pct >= l) ?? 0;
  const last = Number(p.get<{ value: string }>("SELECT value FROM platform_settings WHERE key = 'storage_alert_line'")?.value ?? 0);
  if (reached === last) return null;
  p.run(
    "INSERT INTO platform_settings (key, value, updated_at) VALUES ('storage_alert_line', @v, @now) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    { v: String(reached), now },
  );
  if (reached > last) {
    pushSuperadmins(db, 'storage', { percent: Math.floor(pct) }, { path: '/admin/platform#storage', tag: `storage-${reached}` });
    return reached;
  }
  return null;
}
