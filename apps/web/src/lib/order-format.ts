// small helpers both sides of orders share: the wanted day (YYYY-MM-DD in the business's time zone)
// and how a status looks

import type { OrderStatus } from '@custock/core';
import { date } from './format';
import { fromWall, toWall } from './zoned';

const pad = (n: number) => String(n).padStart(2, '0');

export function msToDay(ms: number, tz: string): string {
  const w = toWall(ms, tz);
  return `${w.y}-${pad(w.m)}-${pad(w.d)}`;
}

export function dayToMs(day: string, tz: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return null;
  return fromWall({ y: Number(m[1]), m: Number(m[2]), d: Number(m[3]), h: 12, min: 0 }, tz);
}

// "Sat 22 Nov"
export function dayText(day: string | null, locale: string, tz: string): string | null {
  if (!day) return null;
  const ms = dayToMs(day, tz);
  return ms == null ? null : date(ms, locale, { weekday: 'short', day: 'numeric', month: 'short' }, tz);
}

// the colour a status chip takes: something to do, waiting, done, ended
export function statusTone(s: OrderStatus): 'accent' | 'few' | 'ok' | 'muted' {
  if (s === 'requested') return 'accent';
  if (s === 'quoted' || s === 'confirmed') return 'few';
  if (s === 'ready' || s === 'completed') return 'ok';
  return 'muted';
}

export const OPEN_STATUSES: readonly OrderStatus[] = ['requested', 'quoted', 'confirmed', 'ready'];
