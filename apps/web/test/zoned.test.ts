// picking a date and time in the business's own zone, also on the nights the clocks change

import { describe, expect, it } from 'vitest';
import { fromWall, toWall } from '../src/lib/zoned';

const tz = 'Europe/Athens';

describe('zoned', () => {
  it('an ordinary time maps to the instant that shows it', () => {
    expect(fromWall({ y: 2026, m: 11, d: 18, h: 9, min: 0 }, tz)).toBe(Date.UTC(2026, 10, 18, 7, 0));
    expect(fromWall({ y: 2026, m: 7, d: 1, h: 9, min: 0 }, tz)).toBe(Date.UTC(2026, 6, 1, 6, 0));
  });

  it('a time skipped by the spring clock change moves forward, never back', () => {
    // 29 Mar 2026: 03:00 EET jumps to 04:00 EEST, so 03:30 does not exist
    const ms = fromWall({ y: 2026, m: 3, d: 29, h: 3, min: 30 }, tz);
    expect(toWall(ms, tz)).toMatchObject({ h: 4, min: 30 });
    expect(ms).toBe(Date.UTC(2026, 2, 29, 1, 30));
  });

  it('a time that repeats in the autumn takes the first one', () => {
    // 25 Oct 2026: 04:00 EEST goes back to 03:00 EET, so 03:30 happens twice
    expect(fromWall({ y: 2026, m: 10, d: 25, h: 3, min: 30 }, tz)).toBe(Date.UTC(2026, 9, 25, 0, 30));
  });

  it('round trips every quarter hour across both change days', () => {
    for (const [y, m, d] of [[2026, 3, 29], [2026, 10, 25]] as const) {
      for (let h = 0; h < 24; h++) for (const min of [0, 15, 30, 45]) {
        const ms = fromWall({ y, m, d, h, min }, tz);
        const back = toWall(ms, tz);
        const skipped = m === 3 && h === 3;
        if (!skipped) expect(back).toMatchObject({ y, m, d, h, min });
      }
    }
  });
});
