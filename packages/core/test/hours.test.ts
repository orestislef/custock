// opening hours: the shape, open or closed in the shop's own time zone, and the week in short
import { describe, expect, it } from 'vitest';
import { emptyWeek, groupHours, openState, ShopHours } from '../src/index';

const day = (from: string, to: string) => [{ from, to }];
const week = (w: Partial<ShopHours['week']>, note: string | null = null): ShopHours => ({ week: { ...emptyWeek(), ...w }, note });
// mon to fri 15:00 to 20:00, like a kitchen that opens in the afternoon
const kitchen = week({ mon: day('15:00', '20:00'), tue: day('15:00', '20:00'), wed: day('15:00', '20:00'), thu: day('15:00', '20:00'), fri: day('15:00', '20:00') });
const ATHENS = 'Europe/Athens';
// times in UTC: athens is UTC+2 in november
const at = (iso: string) => Date.parse(iso);

describe('opening hours: the shape', () => {
  it('takes a week with up to three ranges a day and a trimmed note', () => {
    const r = ShopHours.safeParse({ week: { ...emptyWeek(), mon: [{ from: '09:00', to: '14:00' }, { from: '17:30', to: '21:00' }] }, note: '  Saturday   by appointment ' });
    expect(r.success).toBe(true);
    expect(r.success && r.data.note).toBe('Saturday by appointment');
  });

  it('refuses a close before the open, overlapping ranges, four ranges and bad times', () => {
    const bad = (mon: unknown) => ShopHours.safeParse({ week: { ...emptyWeek(), mon } }).success;
    expect(bad([{ from: '20:00', to: '15:00' }])).toBe(false);
    expect(bad([{ from: '09:00', to: '14:00' }, { from: '13:00', to: '18:00' }])).toBe(false);
    expect(bad([{ from: '08:00', to: '09:00' }, { from: '10:00', to: '11:00' }, { from: '12:00', to: '13:00' }, { from: '14:00', to: '15:00' }])).toBe(false);
    expect(bad([{ from: '9:00', to: '17:00' }])).toBe(false);
    expect(bad([{ from: '25:00', to: '26:00' }])).toBe(false);
    // midnight closing is written 24:00
    expect(bad([{ from: '18:00', to: '24:00' }])).toBe(true);
  });

  it('needs every day of the week', () => {
    expect(ShopHours.safeParse({ week: { mon: [] } }).success).toBe(false);
  });
});

describe('opening hours: open now or when it opens', () => {
  it('open inside a range, until its end, in the shop time zone', () => {
    // wednesday 18 november 2026, 16:30 in athens (14:30 utc)
    expect(openState(kitchen, at('2026-11-18T14:30:00Z'), ATHENS)).toEqual({ open: true, until: '20:00' });
  });

  it('before opening the same day', () => {
    // wednesday 11:00 athens
    expect(openState(kitchen, at('2026-11-18T09:00:00Z'), ATHENS)).toEqual({ open: false, opens: { in: 'today', day: 'wed', at: '15:00' } });
  });

  it('after closing it opens tomorrow, the closing minute itself is closed', () => {
    // wednesday 20:00 athens exactly
    expect(openState(kitchen, at('2026-11-18T18:00:00Z'), ATHENS)).toEqual({ open: false, opens: { in: 'tomorrow', day: 'thu', at: '15:00' } });
  });

  it('friday evening opens on monday, across the end of the week', () => {
    // friday 20 november 2026 21:00 athens
    expect(openState(kitchen, at('2026-11-20T19:00:00Z'), ATHENS)).toEqual({ open: false, opens: { in: 'later', day: 'mon', at: '15:00' } });
    // sunday 23:59 athens: monday is tomorrow
    expect(openState(kitchen, at('2026-11-22T21:59:00Z'), ATHENS)).toEqual({ open: false, opens: { in: 'tomorrow', day: 'mon', at: '15:00' } });
  });

  it('the day is the shop\'s, not utc\'s: 00:30 monday in athens is still sunday in utc', () => {
    const late = week({ mon: day('00:00', '02:00') });
    expect(openState(late, at('2026-11-22T22:30:00Z'), ATHENS)).toEqual({ open: true, until: '02:00' });
  });

  it('a lunch break: closed in it, opening again later the same day', () => {
    const split = week({ mon: [{ from: '09:00', to: '14:00' }, { from: '17:30', to: '21:00' }] });
    // monday 23 november 2026 15:00 athens
    expect(openState(split, at('2026-11-23T13:00:00Z'), ATHENS)).toEqual({ open: false, opens: { in: 'today', day: 'mon', at: '17:30' } });
  });

  it('nothing to say without hours', () => {
    expect(openState(null, Date.now(), ATHENS)).toBeNull();
    expect(openState(week({}), Date.now(), ATHENS)).toBeNull();
  });
});

describe('opening hours: the week in short', () => {
  it('days next to each other with the same hours share a line, closed days too', () => {
    const g = groupHours(week({ ...kitchen.week, sat: day('10:00', '14:00') }));
    expect(g.map((x) => [x.from, x.to, x.ranges.map((r) => `${r.from}-${r.to}`).join(',') || 'closed'])).toEqual([
      ['mon', 'fri', '15:00-20:00'],
      ['sat', 'sat', '10:00-14:00'],
      ['sun', 'sun', 'closed'],
    ]);
  });
});
