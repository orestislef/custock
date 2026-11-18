// an hourly budget for outgoing email across the whole platform. a public page that sends email to
// any typed address (join confirmations) could otherwise use up the mail account's daily quota in
// minutes, and then sign in codes and password resets stop for everyone. over the budget, normal
// mail waits in the outbox for the next hour and the super admins hear about it once. mail people
// need to get into their account is not held (it has its own limits per ip and per address).

import type { Db } from '@custock/db';
import { platform } from './tenant';
import { pushSuperadmins } from './platform-notify';

export const DEFAULT_EMAIL_BUDGET_PER_HOUR = 300;
const HOUR = 3600_000;

export const BUDGET_EXEMPT_MAIL: ReadonlySet<string> = new Set([
  'otp', 'password_reset', 'password_changed', 'email_change', 'email_changed', 'email_reverted', 'delete_code', 'error_notice',
]);

export function emailBudgetPerHour(env: Record<string, string | undefined> = process.env): number {
  const v = Number(env.CUSTOCK_EMAIL_BUDGET_PER_HOUR);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : DEFAULT_EMAIL_BUDGET_PER_HOUR;
}

export function emailsSentLastHour(db: Db, now: number): number {
  return platform(db).get<{ n: number }>("SELECT count(*) AS n FROM dev_outbox WHERE channel = 'email' AND sent_at >= @from", { from: now - HOUR })!.n;
}

// told once per hour that mail is waiting
export function noteBudgetReached(db: Db, now: number, limit: number): boolean {
  const p = platform(db);
  const last = Number(p.get<{ value: string }>("SELECT value FROM platform_settings WHERE key = 'email_budget_alert_at'")?.value ?? 0);
  if (now - last < HOUR) return false;
  p.run(
    "INSERT INTO platform_settings (key, value, updated_at) VALUES ('email_budget_alert_at', @v, @now) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    { v: String(now), now },
  );
  pushSuperadmins(db, 'budget', { limit }, { path: '/admin/platform/server', tag: 'email-budget' });
  return true;
}
