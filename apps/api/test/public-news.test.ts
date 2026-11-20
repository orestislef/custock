// news for everyone: a business can show its posts to visitors on its shop page (policy
// catalog.news). only what was sent to the feed for everyone, no drafts, scheduled or targeted
// posts, no audience or numbers, products only when the catalog is open, in the reader's language.

import { beforeAll, describe, expect, it } from 'vitest';
import { hashPassword, migrate, openDb, seed, type Db, type SeedResult } from '@custock/db';
import { createApp, type App } from '../src/app';
import { runJobs } from '../src/worker';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const SECRET = 'public-news-test-secret-long-enough-1';
const PUBLIC = 'http://localhost:3000';
const clock = Date.now();

describe('news for everyone', () => {
  let db: Db;
  let s: SeedResult;
  let app: App;
  const tokens: Record<string, string> = {};

  async function call(method: string, path: string, who: string | null, body?: unknown, lang?: string) {
    const res = await app.request(path, {
      method,
      headers: {
        ...(who ? { Authorization: `Bearer ${tokens[who]}` } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(lang ? { 'Accept-Language': lang } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json().catch(() => null)) as Json };
  }
  const O = () => `/v1/orgs/${s.orgId}`;
  const NEWS = '/v1/public/orgs/lemoni/posts';
  const ids = async (lang?: string) => ((await call('GET', NEWS, null, undefined, lang)).body.items as Json[]).map((i) => i.post.id);
  const settings = (patch: Record<string, unknown>) => call('PATCH', O(), 'eleni', patch);
  const jobs = () => runJobs({ cfg: { db, jwtSecret: SECRET, publicWebUrl: PUBLIC } }, clock);
  async function sent(title: string, extra: Record<string, unknown> = {}) {
    const post = await call('POST', `${O()}/posts`, 'eleni', {
      kind: 'news', defaultLocale: 'el', translations: { el: { title, body: 'κείμενο' } },
      channels: ['feed'], audience: { scopes: [{ scopeType: 'org', scopeId: s.orgId }] }, ...extra,
    });
    expect(post.status).toBe(201);
    expect((await call('POST', `${O()}/posts/${post.body.id}/publish`, 'eleni')).status).toBe(200);
    await jobs();
    return post.body.id as string;
  }

  beforeAll(async () => {
    db = openDb(':memory:');
    migrate(db);
    s = seed(db, { passwordHash: hashPassword('custock'), now: clock - 3_600_000 });
    app = createApp({ db, dev: true, jwtSecret: SECRET, publicWebUrl: PUBLIC, corsOrigins: [], now: () => clock, rateLimit: false });
    for (const who of ['eleni', 'dimitris']) {
      const r = await app.request('/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `${who}@example.com`, password: 'custock' }) });
      tokens[who] = ((await r.json()) as { accessToken: string }).accessToken;
    }
  });

  it('starts with followers only: nothing for visitors', async () => {
    expect((await call('GET', O(), 'eleni')).body.customerNews).toBe('followers');
    expect((await call('GET', NEWS, null)).status).toBe(404);
  });

  it('staff may not change it, the owner may', async () => {
    expect((await call('PATCH', O(), 'dimitris', { customerNews: 'everyone' })).status).toBe(403);
    expect((await settings({ customerNews: 'sometimes' })).status).toBe(400);
    const r = await settings({ customerNews: 'everyone' });
    expect(r.status).toBe(200);
    expect(r.body.customerNews).toBe('everyone');
  });

  it('visitors see what was sent, newest first, never a draft or a scheduled post', async () => {
    const r = await call('GET', NEWS, null);
    expect(r.status).toBe(200);
    const got = r.body.items.map((i: Json) => i.post.id);
    expect(got).toEqual([s.posts.offer, s.posts.arrival, s.posts.news]);
    expect(got).not.toContain(s.posts.event);
    expect(got).not.toContain(s.posts.draft);
    for (const it of r.body.items) {
      expect(it.post.status).toBe('sent');
      expect(it.post.authorId).toBe('');
      expect(it.post.authorName).toBeNull();
      expect(it.post.stats).toBeNull();
      expect(it.post.recipientsCount).toBeNull();
      expect(it.post.audience.scopes).toEqual([]);
      expect(it.orgName).toBeTruthy();
      expect(it.shopNames.length).toBeGreaterThan(0);
    }
  });

  it('a cancelled post, one not in the feed and one for some customers stay out', async () => {
    expect((await call('POST', `${O()}/posts/${s.posts.event}/cancel`, 'eleni')).status).toBe(200);
    const pushOnly = await sent('Μόνο ειδοποίηση', { channels: ['push'] });
    const forSome = await sent('Για όσους μιλούν αγγλικά', { audience: { scopes: [{ scopeType: 'org', scopeId: s.orgId }], locales: ['en'] } });
    const forAll = await sent('Για όλους');
    const got = await ids();
    expect(got[0]).toBe(forAll);
    expect(got).not.toContain(pushOnly);
    expect(got).not.toContain(forSome);
    expect(got).not.toContain(s.posts.event);
  });

  it('an offer that ended is gone', async () => {
    db.prepare('UPDATE posts SET valid_until = ? WHERE id = ?').run(clock - 1000, s.posts.offer);
    expect(await ids()).not.toContain(s.posts.offer);
    db.prepare('UPDATE posts SET valid_until = ? WHERE id = ?').run(clock + 5 * 86_400_000, s.posts.offer);
    expect(await ids()).toContain(s.posts.offer);
  });

  it('a post only for shops customers do not see stays out', async () => {
    const kif = await sent('Μόνο Κηφισιά', { audience: { scopes: [{ scopeType: 'shop', scopeId: s.shops.kifisia }] } });
    expect(await ids()).toContain(kif);
    db.prepare('UPDATE shops SET customer_visible = 0 WHERE id = ?').run(s.shops.kifisia);
    expect(await ids()).not.toContain(kif);
    db.prepare('UPDATE shops SET customer_visible = 1 WHERE id = ?').run(s.shops.kifisia);
  });

  it('texts come in the reader language, with the post language when it has none', async () => {
    const en = (await call('GET', NEWS, null, undefined, 'en')).body.items.find((i: Json) => i.post.id === s.posts.news).post;
    expect(Object.keys(en.translations).sort()).toEqual(['el', 'en']);
    expect(en.translations.en.title).toBe('We open earlier on Saturdays');
    const ru = (await call('GET', NEWS, null, undefined, 'ru')).body.items.find((i: Json) => i.post.id === s.posts.news).post;
    expect(Object.keys(ru.translations).sort()).toEqual(['el', 'ru']);
    // written in greek only: an english reader gets the greek
    const only = await sent('Μόνο ελληνικά');
    const el = (await call('GET', NEWS, null, undefined, 'en')).body.items.find((i: Json) => i.post.id === only).post;
    expect(Object.keys(el.translations)).toEqual(['el']);
    expect(el.translations.el.title).toBe('Μόνο ελληνικά');
  });

  it('products and prices follow the catalog rules', async () => {
    const arrival = async () => (await call('GET', NEWS, null)).body.items.find((i: Json) => i.post.id === s.posts.arrival).post;
    // the sample catalog is for followers: no products in the posts until it is open to everyone
    expect((await arrival()).products).toEqual([]);
    await settings({ customerCatalog: 'public' });
    expect((await arrival()).products.length).toBe(1);
    expect((await arrival()).products[0].priceMinor).not.toBeNull();
    await settings({ customerPrices: false });
    expect((await arrival()).products[0].priceMinor).toBeNull();
    await settings({ customerPrices: true });
    // a catalog for followers: the posts show, their products do not
    await settings({ customerCatalog: 'subscribers' });
    expect((await arrival()).products).toEqual([]);
    // no catalog at all: nothing
    await settings({ customerCatalog: 'off' });
    expect((await call('GET', NEWS, null)).status).toBe(404);
    await settings({ customerCatalog: 'public' });
    expect((await call('GET', NEWS, null)).status).toBe(200);
  });

  it('pages with a cursor', async () => {
    const all = await ids();
    const first = await call('GET', `${NEWS}?limit=2`, null);
    expect(first.body.items.map((i: Json) => i.post.id)).toEqual(all.slice(0, 2));
    expect(first.body.nextCursor).toBeTruthy();
    const next = await call('GET', `${NEWS}?limit=2&cursor=${encodeURIComponent(first.body.nextCursor)}`, null);
    expect(next.body.items.map((i: Json) => i.post.id)).toEqual(all.slice(2, 4));
  });

  it('posts switched off by the super admin, or back to followers: nothing', async () => {
    db.prepare(`UPDATE organizations SET disabled_features = '["posts"]' WHERE id = ?`).run(s.orgId);
    expect((await call('GET', NEWS, null)).status).toBe(404);
    db.prepare(`UPDATE organizations SET disabled_features = '[]' WHERE id = ?`).run(s.orgId);
    expect((await call('GET', NEWS, null)).status).toBe(200);
    await settings({ customerNews: 'followers' });
    expect((await call('GET', NEWS, null)).status).toBe(404);
  });

  it('an unknown business is not found', async () => {
    expect((await call('GET', '/v1/public/orgs/nobody-here/posts', null)).status).toBe(404);
  });
});
