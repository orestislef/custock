// wall clock time in a given time zone, without a date library. a business picks dates and times
// in its own zone (Europe/Athens for most), whatever zone the phone or computer is set to.

export interface Wall { y: number; m: number; d: number; h: number; min: number }

const partsCache = new Map<string, Intl.DateTimeFormat>();

function partsFormat(tz: string): Intl.DateTimeFormat {
  let f = partsCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    partsCache.set(tz, f);
  }
  return f;
}

// the wall clock in tz at the instant ms
export function toWall(ms: number, tz: string): Wall {
  const p: Record<string, number> = {};
  for (const x of partsFormat(tz).formatToParts(ms)) if (x.type !== 'literal') p[x.type] = Number(x.value);
  return { y: p.year!, m: p.month!, d: p.day!, h: p.hour! % 24, min: p.minute! };
}

function offsetAt(ms: number, tz: string): number {
  const w = toWall(ms, tz);
  const asUtc = Date.UTC(w.y, w.m - 1, w.d, w.h, w.min);
  return asUtc - Math.floor(ms / 60_000) * 60_000;
}

const sameWall = (a: Wall, b: Wall) => a.y === b.y && a.m === b.m && a.d === b.d && a.h === b.h && a.min === b.min;

// the instant when the wall clock in tz shows w. in the hour skipped by a clock change the time
// moves forward (02:30 does not exist on the spring night, it becomes 03:30), in the hour that
// repeats the first one wins.
export function fromWall(w: Wall, tz: string): number {
  const guess = Date.UTC(w.y, w.m - 1, w.d, w.h, w.min);
  const a = guess - offsetAt(guess, tz);
  const b = guess - offsetAt(a, tz);
  // every instant within an hour either side that really shows this wall time
  const shows = [a, b, a - 3_600_000, a + 3_600_000, b - 3_600_000, b + 3_600_000].filter((ms) => sameWall(toWall(ms, tz), w));
  if (shows.length) return Math.min(...shows);
  // the wall time does not exist: the clocks jumped over it, so take the later reading
  return Math.max(a, b);
}

export const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

// 0 Monday ... 6 Sunday, for a calendar date (no time zone involved)
export function weekdayMon(y: number, m: number, d: number): number {
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

export function addDays(w: Pick<Wall, 'y' | 'm' | 'd'>, n: number): { y: number; m: number; d: number } {
  const t = new Date(Date.UTC(w.y, w.m - 1, w.d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

export function addMonths(y: number, m: number, n: number): { y: number; m: number } {
  const i = y * 12 + (m - 1) + n;
  return { y: Math.floor(i / 12), m: (i % 12) + 1 };
}

export const dayKey = (x: { y: number; m: number; d: number }) => x.y * 10_000 + x.m * 100 + x.d;

// a calendar day as noon utc, so Intl can name it without any zone shifting the date
export const dayInstant = (x: { y: number; m: number; d: number }) => Date.UTC(x.y, x.m - 1, x.d, 12);

export function deviceZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'UTC';
  }
}

// "Eastern European Time" in the app's language, or the zone id when the browser cannot name it
export function zoneName(tz: string, intlLocale: string): string {
  try {
    const part = new Intl.DateTimeFormat(intlLocale, { timeZone: tz, timeZoneName: 'longGeneric' }).formatToParts(Date.now()).find((p) => p.type === 'timeZoneName');
    if (part?.value) return part.value;
  } catch {}
  return tz.replace(/_/g, ' ');
}

// true when tz shows the same wall clock as the device right now and through the year
export function sameZone(tz: string): boolean {
  const dev = deviceZone();
  if (dev === tz) return true;
  const now = Date.now();
  return [0, 120, 240].every((dd) => offsetAt(now + dd * 86_400_000, tz) === offsetAt(now + dd * 86_400_000, dev));
}
