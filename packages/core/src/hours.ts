// a shop's opening hours: per weekday up to three time ranges (a lunch break makes two), an empty
// day is closed, and a note for what does not fit ("Saturday by appointment"). times are the shop's
// own wall clock, read in its time zone. nothing goes past midnight: a shop open late closes at 24:00.

import { z } from './zod';
import { cleanLine, LIMITS } from './validate';

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

const HHMM = /^(([01]\d|2[0-3]):[0-5]\d|24:00)$/;

export function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export const HoursRange = z.object({
  from: z.string().regex(HHMM, { message: 'time' }),
  to: z.string().regex(HHMM, { message: 'time' }),
}).refine((r) => minutesOf(r.to) > minutesOf(r.from), { message: 'order', path: ['to'] });
export type HoursRange = z.infer<typeof HoursRange>;

// up to three ranges a day, in order, not overlapping
const DayRanges = z.array(HoursRange).max(3).refine(
  (list) => list.every((r, i) => i === 0 || minutesOf(r.from) >= minutesOf(list[i - 1]!.to)),
  { message: 'overlap' },
);

export const ShopHours = z.object({
  week: z.object(Object.fromEntries(WEEKDAYS.map((d) => [d, DayRanges])) as Record<Weekday, typeof DayRanges>),
  note: z.preprocess((v) => (typeof v === 'string' ? cleanLine(v) || null : v), z.string().max(LIMITS.hoursNote, { message: 'tooLong' }).nullable()).optional(),
});
export type ShopHours = z.infer<typeof ShopHours>;

// where the shop is in its week right now, in its own time zone
function localNow(now: number, timeZone: string): { day: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(now));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const day = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(get('weekday'));
  return { day: Math.max(0, day), minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

// open now and until when, or closed and when it opens next: today, tomorrow or a weekday.
// null when no day has hours at all (nothing to say).
export type OpenState =
  | { open: true; until: string }
  | { open: false; opens: { in: 'today' | 'tomorrow' | 'later'; day: Weekday; at: string } };

export function openState(hours: ShopHours | null | undefined, now: number, timeZone: string): OpenState | null {
  if (!hours || WEEKDAYS.every((d) => !hours.week[d]?.length)) return null;
  const { day, minutes } = localNow(now, timeZone);
  const today = hours.week[WEEKDAYS[day]!] ?? [];
  const current = today.find((r) => minutesOf(r.from) <= minutes && minutes < minutesOf(r.to));
  if (current) return { open: true, until: current.to };
  const later = today.find((r) => minutesOf(r.from) > minutes);
  if (later) return { open: false, opens: { in: 'today', day: WEEKDAYS[day]!, at: later.from } };
  for (let k = 1; k <= 7; k++) {
    const d = WEEKDAYS[(day + k) % 7]!;
    const first = hours.week[d]?.[0];
    if (first) return { open: false, opens: { in: k === 1 ? 'tomorrow' : 'later', day: d, at: first.from } };
  }
  return null;
}

// days next to each other with the same hours, for "Mon–Fri 15:00–20:00, Sat 10:00–14:00"
export interface HoursGroup { from: Weekday; to: Weekday; ranges: HoursRange[] }
export function groupHours(hours: ShopHours): HoursGroup[] {
  const key = (d: Weekday) => (hours.week[d] ?? []).map((r) => `${r.from}-${r.to}`).join(',');
  const out: HoursGroup[] = [];
  for (const d of WEEKDAYS) {
    const last = out[out.length - 1];
    if (last && key(last.to) === key(d)) last.to = d;
    else out.push({ from: d, to: d, ranges: hours.week[d] ?? [] });
  }
  return out;
}

// a week with nothing set, for a new form
export function emptyWeek(): ShopHours['week'] {
  return Object.fromEntries(WEEKDAYS.map((d) => [d, []])) as unknown as ShopHours['week'];
}
