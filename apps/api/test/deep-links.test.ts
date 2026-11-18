// every notification opens the exact page it is about: the post to approve, the count to review,
// the transfer, the product, the new team member, in the right business and shop. nothing is sent.

import { beforeAll, describe, expect, it } from 'vitest';
import { hashPassword, migrate, openDb, seed, type Db, type SeedResult } from '@custock/db';
import { createApp, type App } from '../src/app';
import { pushPath, staffPath } from '../src/lib/webpush';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const SECRET = 'deep-links-test-secret-long-enough-1234';
const clock = Date.now();
const WEB = 'https://custock.example.com';

describe('where a notification takes you', () => {
  let db: Db;
  let s: SeedResult;
  let app: App;
  const tokens: Record<string, string> = {};

  async function call(method: string, path: string, who?: string, body?: unknown) {
    const res = await app.request(path, {
      method,
      headers: { ...(who ? { Authorization: `Bearer ${tokens[who]}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: Json = text;
    try { parsed = text ? JSON.parse(text) : null; } catch { /* not json */ }
    return { status: res.status, body: parsed };
  }
  const org = () => `/v1/orgs/${s.orgId}`;
  // the newest push of a kind for one person, with the page it opens
  const pushFor = (user: string, type: string): { url: string; title: string; body: string; actions: Json } | undefined => {
    const r = db.prepare(
      "SELECT title, body, payload FROM dev_outbox WHERE channel = 'push' AND user_id = ? AND json_extract(payload, '$.type') = ? ORDER BY rowid DESC LIMIT 1",
    ).get(s.users[user], type) as { title: string; body: string; payload: string } | undefined;
    if (!r) return undefined;
    const p = JSON.parse(r.payload);
    return { url: p.url, title: r.title, body: r.body, actions: p.actions };
  };
  const pushesOf = (type: string) => (db.prepare("SELECT user_id FROM dev_outbox WHERE channel = 'push' AND json_extract(payload, '$.type') = ?").all(type) as { user_id: string }[]).map((r) => r.user_id);
  const post = (title: string) => ({
    kind: 'news', defaultLocale: 'el', translations: { el: { title, body: 'κείμενο' } },
    channels: ['feed', 'push'], audience: { scopes: [{ scopeType: 'shop', scopeId: s.shops.kifisia }] },
  });

  beforeAll(async () => {
    db = openDb(':memory:');
    migrate(db);
    s = seed(db, { passwordHash: hashPassword('custock'), now: clock });
    app = createApp({ db, dev: true, jwtSecret: SECRET, publicWebUrl: WEB, corsOrigins: [], now: () => clock, rateLimit: false });
    for (const who of ['eleni', 'nikos', 'maria', 'dimitris', 'katerina']) {
      const r = await call('POST', '/v1/auth/login', undefined, { email: `${who}@example.com`, password: 'custock' });
      tokens[who] = r.body.accessToken;
    }
  });

  it('builds each destination with its business and shop', () => {
    const o = s.orgId;
    const k = s.shops.kifisia;
    expect(staffPath('/admin', o)).toBe(`/admin?org=${o}`);
    expect(staffPath('/admin/stock', o, k, { filter: 'low' })).toBe(`/admin/stock?filter=low&org=${o}&shop=${k}`);
    expect(pushPath(db, o, false, { type: 'approvalNeeded', postId: 'p1' })).toBe(`/admin/posts/p1?org=${o}`);
    expect(pushPath(db, o, false, { type: 'postPublished', postId: 'p1' })).toBe(`/admin/posts/p1?org=${o}`);
    expect(pushPath(db, o, false, { type: 'postReturned', postId: 'p1' })).toBe(`/admin/posts/p1?org=${o}`);
    expect(pushPath(db, o, false, { type: 'countReady', countId: 'c1', shopId: k })).toBe(`/admin/stock/counts/c1?org=${o}&shop=${k}`);
    expect(pushPath(db, o, false, { type: 'transferSent', transferId: 't1', shopId: k })).toBe(`/admin/stock/transfers/t1?org=${o}&shop=${k}`);
    expect(pushPath(db, o, false, { type: 'transferReceived', transferId: 't1', shopId: k })).toBe(`/admin/stock/transfers/t1?org=${o}&shop=${k}`);
    const low = pushPath(db, o, false, { type: 'lowStock', variantId: s.variants['p-mastiha'], shopId: k });
    expect(low.startsWith('/admin/stock/')).toBe(true);
    expect(low.endsWith(`?org=${o}&shop=${k}`)).toBe(true);
    expect(pushPath(db, o, false, { type: 'lowStock', variantId: 'gone', shopId: k })).toBe(`/admin/stock?filter=low&org=${o}&shop=${k}`);
    expect(pushPath(db, o, false, { type: 'inviteAccepted', membershipId: 'm1' })).toBe(`/admin/team?member=m1&org=${o}`);
    // customers land on the business's own pages
    expect(pushPath(db, o, true, { type: 'post', postId: 'p1' })).toBe('/s/lemoni/news?post=p1');
    expect(pushPath(db, o, true, { type: 'back_in_stock', productId: 'pr1' })).toBe('/s/lemoni/p/pr1');
    expect(pushPath(db, o, true, {})).toBe('/s/lemoni');
    expect(pushPath(db, o, false, {})).toBe(`/admin?org=${o}`);
  });

  it('a post waiting for approval opens its approval view, and its author hears what happened', async () => {
    const created = await call('POST', `${org()}/posts`, 'maria', post('Νέο λάδι'));
    expect(created.status).toBe(201);
    const id = created.body.id as string;
    const sent = await call('POST', `${org()}/posts/${id}/publish`, 'maria');
    expect(sent.body.status).toBe('pending_approval');
    // the approvers, not the author
    const asked = pushFor('nikos', 'approvalNeeded');
    expect(asked?.url).toBe(`${WEB}/admin/posts/${id}?org=${s.orgId}`);
    expect(asked?.actions?.[0]?.url).toBe(asked?.url);
    expect(pushFor('maria', 'approvalNeeded')).toBeUndefined();
    expect((await call('POST', `${org()}/posts/${id}/approve`, 'nikos')).status).toBe(200);
    const told = pushFor('maria', 'postPublished');
    expect(told?.url).toBe(`${WEB}/admin/posts/${id}?org=${s.orgId}`);
    expect(told?.body).toContain('Νέο λάδι');
    expect(pushFor('nikos', 'postPublished')).toBeUndefined();
  });

  it('a post stopped before approval tells its author', async () => {
    const id = (await call('POST', `${org()}/posts`, 'maria', post('Δεύτερο'))).body.id as string;
    await call('POST', `${org()}/posts/${id}/publish`, 'maria');
    expect((await call('POST', `${org()}/posts/${id}/cancel`, 'eleni')).body.status).toBe('cancelled');
    expect(pushFor('maria', 'postReturned')?.url).toBe(`${WEB}/admin/posts/${id}?org=${s.orgId}`);
  });

  it('a count sent for review opens that count in its shop', async () => {
    const count = (await call('POST', `${org()}/shops/${s.shops.kifisia}/counts`, 'dimitris', { kind: 'partial' })).body;
    await call('PUT', `${org()}/counts/${count.id}/lines/${s.variants['p-candle']}`, 'dimitris', { countedQty: 1 });
    expect((await call('POST', `${org()}/counts/${count.id}/submit`, 'dimitris')).body.status).toBe('review');
    expect(pushFor('maria', 'countReady')?.url).toBe(`${WEB}/admin/stock/counts/${count.id}?org=${s.orgId}&shop=${s.shops.kifisia}`);
  });

  it('a transfer opens in the receiving shop, and the sending shop hears it arrived short', async () => {
    const tahini = s.variants['p-tahini']!;
    const tr = (await call('POST', `${org()}/transfers`, 'nikos', { fromShopId: s.shops.marousi, toShopId: s.shops.kifisia, lines: [{ variantId: tahini, qty: 4 }] })).body;
    await call('POST', `${org()}/transfers/${tr.id}/send`, 'nikos');
    expect(pushFor('dimitris', 'transferSent')?.url).toBe(`${WEB}/admin/stock/transfers/${tr.id}?org=${s.orgId}&shop=${s.shops.kifisia}`);
    const got = await call('POST', `${org()}/transfers/${tr.id}/receive`, 'dimitris', { lines: [{ variantId: tahini, qtyReceived: 3 }] });
    expect(got.body.status).toBe('received');
    // people who can send from the sending shop, never the receiver, never staff without that right
    const back = pushFor('eleni', 'transferReceived');
    expect(back?.url).toBe(`${WEB}/admin/stock/transfers/${tr.id}?org=${s.orgId}&shop=${s.shops.marousi}`);
    expect(back?.body).toContain('3');
    expect(back?.body).toContain('1');
    const told = pushesOf('transferReceived');
    expect(told).toContain(s.users.nikos);
    expect(told).not.toContain(s.users.dimitris);
    expect(told).not.toContain(s.users.katerina);
  });
});
