// opening hours per shop: set by who may change the shop's details, checked, cleared, shown to
// customers with the shop's time zone, and an old stored shape reads as not set.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { hashPassword, migrate, MIGRATIONS_DIR, openDb, seed, type Db, type SeedResult } from '@custock/db';
import { emptyWeek } from '@custock/core';
import { createApp, type App } from '../src/app';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const SECRET = 'shop-hours-test-secret-long-enough-1';
const clock = Date.now();

describe('opening hours per shop', () => {
  let db: Db;
  let s: SeedResult;
  let app: App;
  const tokens: Record<string, string> = {};

  async function call(method: string, path: string, who: string | null, body?: unknown) {
    const res = await app.request(path, {
      method,
      headers: { ...(who ? { Authorization: `Bearer ${tokens[who]}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json().catch(() => null)) as Json };
  }
  const O = () => `/v1/orgs/${s.orgId}`;
  const kitchen = { week: { ...emptyWeek(), mon: [{ from: '15:00', to: '20:00' }], tue: [{ from: '15:00', to: '20:00' }] }, note: '  Saturday   by appointment ' };

  beforeAll(async () => {
    db = openDb(':memory:');
    migrate(db);
    s = seed(db, { passwordHash: hashPassword('custock'), now: clock - 3_600_000 });
    app = createApp({ db, dev: true, jwtSecret: SECRET, publicWebUrl: 'http://localhost:3000', corsOrigins: [], now: () => clock, rateLimit: false });
    for (const who of ['eleni', 'maria', 'dimitris']) {
      const r = await app.request('/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `${who}@example.com`, password: 'custock' }) });
      tokens[who] = ((await r.json()) as { accessToken: string }).accessToken;
    }
  });

  it('the sample shops come with hours', async () => {
    const r = await call('GET', `${O()}/shops`, 'eleni');
    const kif = r.body.find((x: Json) => x.id === s.shops.kifisia);
    expect(kif.hours.week.mon).toEqual([{ from: '09:00', to: '21:00' }]);
    expect(kif.hours.week.sun).toEqual([]);
  });

  it('a manager sets them for her shop, the note is tidied, and it is audited', async () => {
    const r = await call('PATCH', `${O()}/shops/${s.shops.kifisia}`, 'maria', { hours: kitchen });
    expect(r.status).toBe(200);
    expect(r.body.hours.week.mon).toEqual([{ from: '15:00', to: '20:00' }]);
    expect(r.body.hours.note).toBe('Saturday by appointment');
    const audit = db.prepare("SELECT after_json FROM audit_log WHERE action = 'shop.updated' AND entity_id = ? ORDER BY created_at DESC LIMIT 1").get(s.shops.kifisia) as Json;
    expect(JSON.parse(audit.after_json).hours.week.mon[0].from).toBe('15:00');
  });

  it('wrong hours are refused: a close before the open, overlaps, bad times', async () => {
    const bad = async (mon: unknown) => (await call('PATCH', `${O()}/shops/${s.shops.kifisia}`, 'maria', { hours: { week: { ...emptyWeek(), mon } } })).status;
    expect(await bad([{ from: '20:00', to: '15:00' }])).toBe(400);
    expect(await bad([{ from: '09:00', to: '14:00' }, { from: '13:00', to: '18:00' }])).toBe(400);
    expect(await bad([{ from: '9am', to: '5pm' }])).toBe(400);
    // nothing changed
    expect((await call('GET', `${O()}/shops`, 'eleni')).body.find((x: Json) => x.id === s.shops.kifisia).hours.week.mon).toEqual([{ from: '15:00', to: '20:00' }]);
  });

  it('staff may not, nor a manager for another shop', async () => {
    expect((await call('PATCH', `${O()}/shops/${s.shops.kifisia}`, 'dimitris', { hours: kitchen })).status).toBe(403);
    expect((await call('PATCH', `${O()}/shops/${s.shops.glyfada}`, 'maria', { hours: kitchen })).status).toBe(403);
  });

  it('customers see each shop with its hours and time zone, no sign in needed', async () => {
    const shops = await call('GET', '/v1/public/orgs/lemoni/shops', null);
    expect(shops.status).toBe(200);
    const kif = shops.body.find((x: Json) => x.id === s.shops.kifisia);
    expect(kif.timezone).toBe('Europe/Athens');
    expect(kif.hours.week.mon).toEqual([{ from: '15:00', to: '20:00' }]);
    expect(kif).not.toHaveProperty('customerStock');
    const org = await call('GET', '/v1/public/orgs/lemoni', null);
    expect(org.body.shops.map((x: Json) => x.id)).toContain(s.shops.kifisia);
    const options = await call('GET', '/v1/public/orgs/lemoni/order-options', null);
    for (const sh of options.body.shops) expect(sh).toHaveProperty('timezone');
  });

  it('null clears them', async () => {
    const r = await call('PATCH', `${O()}/shops/${s.shops.kifisia}`, 'eleni', { hours: null });
    expect(r.status).toBe(200);
    expect(r.body.hours).toBeNull();
    const pub = await call('GET', '/v1/public/orgs/lemoni/shops', null);
    expect(pub.body.find((x: Json) => x.id === s.shops.kifisia).hours).toBeNull();
  });

  it('an old stored shape reads as not set, and the migration clears it', async () => {
    db.prepare('UPDATE shops SET opening_hours = ? WHERE id = ?').run(JSON.stringify({ mon_fri: '09:00-21:00', sat: '09:00-18:00', sun: null }), s.shops.marousi);
    expect((await call('GET', `${O()}/shops`, 'eleni')).body.find((x: Json) => x.id === s.shops.marousi).hours).toBeNull();
    db.exec(readFileSync(join(MIGRATIONS_DIR, '0020_shop_hours.sql'), 'utf8'));
    expect((db.prepare('SELECT opening_hours h FROM shops WHERE id = ?').get(s.shops.marousi) as Json).h).toBeNull();
    // a value in the new shape stays
    expect((db.prepare('SELECT opening_hours h FROM shops WHERE id = ?').get(s.shops.glyfada) as Json).h).toContain('"week"');
  });
});
