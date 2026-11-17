// local time in the org timezone: day keys, start of day, quiet hours

export function dayKey(ts: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ts));
}

export function localMinutes(ts: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ts));
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return h * 60 + m;
}

// the first ms of the local day that contains ts
export function localDayStart(ts: number, timeZone: string): number {
  const key = dayKey(ts, timeZone);
  let lo = ts - 36 * 3600_000;
  let hi = ts;
  // binary search the moment the day key changes
  while (hi - lo > 1000) {
    const mid = Math.floor((lo + hi) / 2);
    if (dayKey(mid, timeZone) === key) hi = mid;
    else lo = mid;
  }
  return Math.floor(hi / 1000) * 1000;
}

function parseWindow(window: string): { start: number; end: number } | null {
  const m = window.match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return { start: Number(m[1]) * 60 + Number(m[2]), end: Number(m[3]) * 60 + Number(m[4]) };
}

export function inQuietHours(ts: number, window: string, timeZone: string): boolean {
  const w = parseWindow(window);
  if (!w || w.start === w.end) return false;
  const m = localMinutes(ts, timeZone);
  return w.start > w.end ? m >= w.start || m < w.end : m >= w.start && m < w.end;
}

// when quiet hours end, or ts itself when not in them
export function quietHoursEnd(ts: number, window: string, timeZone: string): number {
  if (!inQuietHours(ts, window, timeZone)) return ts;
  let t = ts - (ts % 60_000);
  for (let i = 0; i < 24 * 60 && inQuietHours(t, window, timeZone); i++) t += 60_000;
  return t;
}
