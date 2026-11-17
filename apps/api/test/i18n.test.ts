// names in the reader's language: Accept-Language, else the user's language, else the org default

import { beforeAll, describe, expect, it } from 'vitest';
import { migrate, openDb, seed, hashPassword, type Db, type SeedResult } from '@custock/db';
import { createApp, type App } from '../src/app';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any
let db: Db;
let s: SeedResult;
let app: App;
const tokens: Record<string, string> = {};

async function get(path: string, who?: string, lang?: string) {
  const res = await app.request(path, { headers: { ...(who ? { Authorization: `Bearer ${tokens[who]}` } : {}), ...(lang ? { 'Accept-Language': lang } : {}) } });
  return (await res.json()) as Json;
}

beforeAll(async () => {
  db = openDb(':memory:');
  migrate(db);
  s = seed(db, { passwordHash: hashPassword('custock') });
  app = createApp({ db, dev: true, jwtSecret: 'i18n-test-secret-that-is-long-enough', publicWebUrl: 'http://localhost:3000', corsOrigins: [], rateLimit: false });
  for (const who of ['eleni', 'maria', 'anna']) {
    const res = await app.request('/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `${who}@example.com`, password: 'custock' }) });
    tokens[who] = ((await res.json()) as { accessToken: string }).accessToken;
  }
  // a little history to report on
  const count = await (await app.request(`/v1/orgs/${s.orgId}/shops/${s.shops.kifisia}/counts`, { method: 'POST', headers: { Authorization: `Bearer ${tokens.maria}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'partial' }) })).json() as { id: string };
  await app.request(`/v1/orgs/${s.orgId}/counts/${count.id}/lines/${s.variants['p-thyme-honey']}`, { method: 'PUT', headers: { Authorization: `Bearer ${tokens.maria}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ countedQty: 1 }) });
  tokens.countId = count.id;
});

const org = () => `/v1/orgs/${s.orgId}`;

describe('categories', () => {
  it('follow Accept-Language, else the user, else the org default', async () => {
    expect((await get(`${org()}/categories`, 'eleni', 'en')).map((c: { name: string }) => c.name)).toContain('Pantry');
    expect((await get(`${org()}/categories`, 'eleni', 'ru-RU')).map((c: { name: string }) => c.name)).toContain('Кладовая');
    expect((await get(`${org()}/categories`, 'eleni')).map((c: { name: string }) => c.name)).toContain('Κελάρι');
  });
  it('on products, public pages and the join page', async () => {
    const p = await get(`${org()}/products/${s.products['p-thyme-honey']}`, 'maria', 'en');
    expect(p.categoryName).toBe('Pantry');
    expect(p.displayName).toBe('Thyme honey 450 g');
    expect(p.name).toBe('Θυμαρίσιο μέλι 450g'); // the one to edit stays the default
    const join = await get('/v1/public/join/kif7q2', undefined, 'ru');
    expect(join.interests.map((x: { name: string }) => x.name)).toContain('Кладовая');
    const joinDefault = await get('/v1/public/join/kif7q2');
    expect(joinDefault.interests.map((x: { name: string }) => x.name)).toContain('Κελάρι');
  });
  it('anna reads russian in the customer catalog without saying so', async () => {
    const list = await get('/v1/c/orgs/lemoni/catalog', 'anna');
    const honey = list.find((x: { id: string }) => x.id === s.products['p-thyme-honey']);
    expect(honey.name).toBe('Тимьяновый мёд 450 г');
    expect(honey.categoryName).toBe('Кладовая');
    const feed = await get('/v1/c/feed', 'anna');
    const offer = feed.items.find((i: { post: { id: string } }) => i.post.id === s.posts.offer);
    expect(offer.post.products[0].name).toBe('Оливковое масло extra virgin 500 мл');
  });
});

describe('product names everywhere else', () => {
  it('reports, counts, movements, customer detail', async () => {
    const wanted = await get(`${org()}/reports/most-wanted`, 'maria', 'en');
    expect(wanted[0].name).toBe('Thyme honey 450 g');
    const top = await get(`${org()}/reports/top-sellers?days=60`, 'eleni', 'ru');
    expect(top.every((x: { name: string }) => /[а-яё]/i.test(x.name) || /extra virgin/.test(x.name))).toBe(true);
    const count = await get(`${org()}/counts/${tokens.countId}`, 'maria', 'en');
    expect(count.lines[0].name).toBe('Thyme honey 450 g');
    const moves = await get(`${org()}/movements?variantId=${s.variants['p-ceramic-cup:large']}&limit=1`, 'eleni', 'en');
    expect(moves.items[0].productName).toBe('Ceramic cup · Large 300 ml');
    const anna = (db.prepare("SELECT id FROM customers WHERE email = 'anna@example.com'").get() as { id: string }).id;
    const detail = await get(`${org()}/customers/${anna}`, 'maria', 'en');
    expect(detail.waitingFor.map((w: { productName: string }) => w.productName)).toContain('Thyme honey 450 g');
  });
});
