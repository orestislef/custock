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

export function date(ms: number, locale: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }): string {
  return new Intl.DateTimeFormat(intlLocale(locale), { timeZone: 'Europe/Athens', ...opts }).format(ms);
}

export function dateTime(ms: number, locale: string): string {
  return date(ms, locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
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
