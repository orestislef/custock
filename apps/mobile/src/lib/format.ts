// numbers, money, quantities and dates with Intl in the user's language.

import type { Uom } from '@custock/core';

const LOCALE_TAG: Record<string, string> = { en: 'en-GB', el: 'el-GR', ru: 'ru-RU' };

export function tag(locale: string): string {
  return LOCALE_TAG[locale] ?? 'en-GB';
}

export function money(minor: number | null | undefined, currency: string, locale: string): string {
  if (minor === null || minor === undefined) return '';
  return new Intl.NumberFormat(tag(locale), { style: 'currency', currency }).format(minor / 100);
}

export function qty(base: number, uom: Uom, locale: string): string {
  if (uom === 'piece') return new Intl.NumberFormat(tag(locale)).format(base);
  return new Intl.NumberFormat(tag(locale), { maximumFractionDigits: 3 }).format(base / 1000);
}

export function num(n: number, locale: string): string {
  return new Intl.NumberFormat(tag(locale)).format(n);
}

export function date(ms: number, locale: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }): string {
  return new Intl.DateTimeFormat(tag(locale), opts).format(new Date(ms));
}

export function dateTime(ms: number, locale: string): string {
  return new Intl.DateTimeFormat(tag(locale), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(ms));
}

export function relative(ms: number, locale: string, now = Date.now()): string {
  const diff = ms - now;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(tag(locale), { numeric: 'auto' });
  if (abs < 60_000) return rtf.format(0, 'second');
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), 'minute');
  if (abs < 86_400_000) return rtf.format(Math.round(diff / 3_600_000), 'hour');
  if (abs < 7 * 86_400_000) return rtf.format(Math.round(diff / 86_400_000), 'day');
  return date(ms, locale);
}
