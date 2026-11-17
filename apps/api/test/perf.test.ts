// the speed check on a big made up business. slow to set up (about half a minute), so it only runs
// when asked: CUSTOCK_PERF=1 pnpm --filter @custock/api test

import { describe, expect, it } from 'vitest';
import { bench } from '../scripts/bench';

describe.skipIf(process.env.CUSTOCK_PERF !== '1')('speed on 2,000 products, 200,000 movements, 20,000 customers', () => {
  it('every list, search, dashboard and report answers under 150 ms (median)', async () => {
    const { rows, cleanup } = await bench({ runs: 5 });
    try {
      for (const r of rows) {
        expect(r.status, r.name).toBe(200);
        expect(r.median, r.name).toBeLessThan(150);
      }
    } finally {
      cleanup();
    }
  }, 300_000);
});
