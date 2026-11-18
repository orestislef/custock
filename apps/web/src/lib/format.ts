import type { Uom } from '@custock/core';

const INTL: Record<string, string> = { en: 'en-GB', el: 'el-GR', ru: 'ru-RU' };
export const intlLocale = (locale: string) => INTL[locale] ?? 'en-GB';

export function money(minor: number | null | undefined, currency: string, locale: string): string {
  if (minor == null) return '';
  return new Intl.NumberFormat(intlLocale(locale), { style: 'currency', currency }).format(minor / 100);
}

// quantities are stored in base units: pieces x1, kg/l/m x1000
export function qtyNumber(base: number, uom: Uom, locale: string): string {
  if (uom === 'piece') return new Intl.NumberFormat(intlLocale(locale)).format(base);
  return new Intl.NumberFormat(intlLocale(locale), { maximumFractionDigits: 3 }).format(base / 1000);
}

export function number(n: number, locale: string): string {
  return new Intl.NumberFormat(intlLocale(locale)).format(n);
}

export function percent(n: number, locale: string): string {
  return new Intl.NumberFormat(intlLocale(locale), { style: 'percent', maximumFractionDigits: 0 }).format(n);
}

// dates show in the business's time zone, never the device's. the admin and the customer pages
// set it once the business is known (setDisplayTimeZone), server rendered pages pass it in.
export const DEFAULT_TIME_ZONE = 'Europe/Athens';
let displayZone = DEFAULT_TIME_ZONE;

export function setDisplayTimeZone(tz: string | null | undefined) {
  // only in the browser: on the server one module serves every request
  if (typeof window === 'undefined') return;
  displayZone = validZone(tz) ? tz! : DEFAULT_TIME_ZONE;
}

export function displayTimeZone(): string {
  return displayZone;
}

const zoneOk = new Map<string, boolean>();
function validZone(tz: string | null | undefined): boolean {
  if (!tz) return false;
  let ok = zoneOk.get(tz);
  if (ok === undefined) {
    try {
      new Intl.DateTimeFormat('en-GB', { timeZone: tz });
      ok = true;
    } catch {
      ok = false;
    }
    zoneOk.set(tz, ok);
  }
  return ok;
}

export function date(ms: number, locale: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }, tz?: string | null): string {
  const zone = validZone(tz) ? tz! : displayZone;
  return new Intl.DateTimeFormat(intlLocale(locale), { timeZone: zone, ...opts }).format(ms);
}

// 24 hour clock in every language: the shops are in europe and en means en-GB here
export function dateTime(ms: number, locale: string, tz?: string | null): string {
  return date(ms, locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }, tz);
}

// the hour of the day (0 to 23) in the business's time zone
export function hourIn(ms: number, tz?: string | null): number {
  const zone = validZone(tz) ? tz! : displayZone;
  return Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: zone }).format(ms)) % 24;
}

export function relative(ms: number, locale: string, now = Date.now()): string {
  const rtf = new Intl.RelativeTimeFormat(intlLocale(locale), { numeric: 'auto' });
  const diff = ms - now;
  const abs = Math.abs(diff);
  const minute = 60_000, hour = 3_600_000, day = 86_400_000;
  if (abs < minute) return rtf.format(0, 'second');
  if (abs < hour) return rtf.format(Math.round(diff / minute), 'minute');
  if (abs < day) return rtf.format(Math.round(diff / hour), 'hour');
  if (abs < 7 * day) return rtf.format(Math.round(diff / day), 'day');
  return date(ms, locale);
}

// masks used when the caller has no customers.contact.view
export function maskEmail(email: string): string {
  const [user, domain] = email.split('@');
  if (!user || !domain) return email;
  return `${user.slice(0, 2)}***@${domain}`;
}
