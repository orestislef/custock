// a category's picture: a built in icon or the business's own photo in the bucket. only known
// icons and the business's own category uploads are accepted, a replaced or removed photo leaves
// the bucket, and the staff lists, products and the public business page carry the picture.

import { beforeAll, describe, expect, it } from 'vitest';
import { hashPassword, migrate, openDb, seed, type Db, type SeedResult } from '@custock/db';
import { CATEGORY_ICON_KEYS, isCategoryIconKey } from '@custock/core';
import { createApp, type App } from '../src/app';
import { s3Store, type S3Config } from '../src/lib/storage';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const SECRET = 'category-pictures-test-secret-long-enough';
const clock = Date.now();

describe('category pictures', () => {
  let db: Db;
  let s: SeedResult;
  let app: App;
  const tokens: Record<string, string> = {};
  const deleted: string[] = [];
  const s3: S3Config = { bucket: 'custock-photos', region: 'auto', endpoint: 'https://acct123.r2.cloudflarestorage.com', accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret', publicUrl: 'https://img.example.com' };
  const store = s3Store(s3, async (url, init) => {
    if (init?.method === 'DELETE') deleted.push(new URL(String(url)).pathname);
    return new Response(null, { status: 204 });
  });

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
  const row = (sql: string, ...a: unknown[]) => db.prepare(sql).get(...a) as Json;

  beforeAll(async () => {
    db = openDb(':memory:');
    migrate(db);
    s = seed(db, { passwordHash: hashPassword('custock'), now: clock });
    app = createApp({
      db, dev: false, jwtSecret: SECRET, publicWebUrl: 'https://custock.example.com', apiPublicUrl: 'https://custock.example.com/api',
      corsOrigins: [], now: () => clock, rateLimit: false, storage: { kind: 's3', s3 }, photoStore: store,
    });
    for (const who of ['eleni', 'maria', 'dimitris']) {
      const r = await call('POST', '/v1/auth/login', undefined, { email: `${who}@example.com`, password: 'custock' });
      tokens[who] = r.body.accessToken;
    }
  });

  it('the icon set has unique, stable keys', () => {
    expect(CATEGORY_ICON_KEYS.length).toBeGreaterThanOrEqual(15);
    expect(new Set(CATEGORY_ICON_KEYS).size).toBe(CATEGORY_ICON_KEYS.length);
    for (const k of ['bottle', 'jar', 'cheese', 'bread', 'fruit', 'vegetable', 'coffee', 'wine', 'gift', 'box', 'tag', 'leaf', 'fish', 'meat', 'sweets']) expect(isCategoryIconKey(k)).toBe(true);
    expect(isCategoryIconKey('rocket')).toBe(false);
    expect(isCategoryIconKey('toString')).toBe(false);
  });

  it('a category gets an icon, only a known one', async () => {
    const base = `/v1/orgs/${s.orgId}/categories`;
    expect((await call('POST', base, 'eleni', { name: 'Rockets', iconKey: 'rocket' })).status).toBe(400);
    const c = await call('POST', base, 'eleni', { name: 'Cheeses', iconKey: 'cheese' });
    expect(c.status).toBe(201);
    expect(c.body).toMatchObject({ name: 'Cheeses', iconKey: 'cheese', imageUrl: null });
    // the list and the products carry it, for the photo-less placeholder
    const list = await call('GET', base, 'dimitris');
    expect(list.body.find((x: Json) => x.id === c.body.id)).toMatchObject({ iconKey: 'cheese', imageUrl: null });
    const p = await call('POST', `/v1/orgs/${s.orgId}/products`, 'eleni', { name: 'Graviera', uom: 'piece', categoryId: c.body.id, variants: [{ priceMinor: 900 }] });
    expect(p.status).toBe(201);
    const got = await call('GET', `/v1/orgs/${s.orgId}/products/${p.body.id}`, 'eleni');
    expect(got.body.categoryIconKey).toBe('cheese');
    // changing the icon, then removing the picture
    expect((await call('PATCH', `${base}/${c.body.id}`, 'eleni', { iconKey: 'jar' })).body.iconKey).toBe('jar');
    expect((await call('PATCH', `${base}/${c.body.id}`, 'eleni', { iconKey: null })).body).toMatchObject({ iconKey: null, imageUrl: null });
  });

  it('a photo replaces the icon, is checked, confirmed, replaced and removed from the bucket', async () => {
    const base = `/v1/orgs/${s.orgId}/categories`;
    const c = await call('POST', base, 'eleni', { name: 'Honey', iconKey: 'jar' });
    // only people who manage categories may upload one, small squares only
    expect((await call('POST', `/v1/orgs/${s.orgId}/uploads/presign`, 'dimitris', { purpose: 'category', mime: 'image/webp', bytes: 3000 })).status).toBe(403);
    expect((await call('POST', `/v1/orgs/${s.orgId}/uploads/presign`, 'eleni', { purpose: 'category', mime: 'image/webp', bytes: 2_000_000 })).status).toBe(413);
    const a = await call('POST', `/v1/orgs/${s.orgId}/uploads/presign`, 'eleni', { purpose: 'category', mime: 'image/webp', bytes: 3000 });
    expect(a.status).toBe(201);
    const keyA = `orgs/${s.orgId}/categories/${a.body.fileId}.webp`;
    expect(a.body.publicUrl).toBe(`https://img.example.com/${keyA}`);
    expect(row('SELECT purpose, confirmed_at FROM files WHERE id = ?', a.body.fileId)).toEqual({ purpose: 'category', confirmed_at: null });
    // a product photo or a made up id is not a category photo
    const prod = await call('POST', `/v1/orgs/${s.orgId}/uploads/presign`, 'eleni', { purpose: 'product', mime: 'image/webp', bytes: 3000 });
    expect((await call('PATCH', `${base}/${c.body.id}`, 'eleni', { imageFileId: prod.body.fileId })).status).toBe(404);
    expect((await call('PATCH', `${base}/${c.body.id}`, 'eleni', { imageFileId: 'nope' })).status).toBe(404);
    // the photo goes on, the icon goes away, the file counts now
    const set = await call('PATCH', `${base}/${c.body.id}`, 'eleni', { imageFileId: a.body.fileId });
    expect(set.status).toBe(200);
    expect(set.body).toMatchObject({ iconKey: null, imageUrl: a.body.publicUrl });
    expect(row('SELECT confirmed_at FROM files WHERE id = ?', a.body.fileId).confirmed_at).toBe(clock);
    // a new photo replaces it, the old one leaves the bucket
    const b = await call('POST', `/v1/orgs/${s.orgId}/uploads/presign`, 'eleni', { purpose: 'category', mime: 'image/webp', bytes: 2500 });
    expect((await call('PATCH', `${base}/${c.body.id}`, 'eleni', { imageFileId: b.body.fileId })).body.imageUrl).toBe(b.body.publicUrl);
    expect(deleted).toContain(`/custock-photos/${keyA}`);
    expect(row('SELECT deleted_at FROM files WHERE id = ?', a.body.fileId).deleted_at).toBe(clock);
    // choosing an icon again drops the photo too
    const icon = await call('PATCH', `${base}/${c.body.id}`, 'eleni', { iconKey: 'bottle' });
    expect(icon.body).toMatchObject({ iconKey: 'bottle', imageUrl: null });
    expect(deleted).toContain(`/custock-photos/orgs/${s.orgId}/categories/${b.body.fileId}.webp`);
    // another business's category photo cannot be used here
    const other = row("SELECT id FROM organizations WHERE id <> ? LIMIT 1", s.orgId);
    if (other) {
      db.prepare("INSERT INTO files (id, org_id, storage_key, purpose, is_public, mime, bytes, created_at, confirmed_at) VALUES ('f-other', ?, 'orgs/x/categories/f.webp', 'category', 1, 'image/webp', 10, ?, ?)").run(other.id, clock, clock);
      expect((await call('PATCH', `${base}/${c.body.id}`, 'eleni', { imageFileId: 'f-other' })).status).toBe(404);
    }
  });

  it('deleting a category takes its photo out of the bucket', async () => {
    const base = `/v1/orgs/${s.orgId}/categories`;
    const c = await call('POST', base, 'eleni', { name: 'Gifts' });
    const f = await call('POST', `/v1/orgs/${s.orgId}/uploads/presign`, 'eleni', { purpose: 'category', mime: 'image/webp', bytes: 2000 });
    expect((await call('PATCH', `${base}/${c.body.id}`, 'eleni', { imageFileId: f.body.fileId })).status).toBe(200);
    expect((await call('DELETE', `${base}/${c.body.id}`, 'eleni')).status).toBe(204);
    expect(deleted).toContain(`/custock-photos/orgs/${s.orgId}/categories/${f.body.fileId}.webp`);
    expect(row('SELECT deleted_at FROM files WHERE id = ?', f.body.fileId).deleted_at).toBe(clock);
    // a photo given at creation is confirmed right away
    const g = await call('POST', `/v1/orgs/${s.orgId}/uploads/presign`, 'eleni', { purpose: 'category', mime: 'image/webp', bytes: 2000 });
    const made = await call('POST', base, 'eleni', { name: 'Teas', imageFileId: g.body.fileId });
    expect(made.status).toBe(201);
    expect(made.body.imageUrl).toBe(g.body.publicUrl);
    expect(row('SELECT confirmed_at FROM files WHERE id = ?', g.body.fileId).confirmed_at).toBe(clock);
  });

  it('the public business page lists categories with something to see, in the visitor language', async () => {
    const base = `/v1/orgs/${s.orgId}/categories`;
    // the seed business writes Greek first, English is a translation
    const c = await call('POST', base, 'eleni', { name: 'Ελαιόλαδα', translations: { en: 'Olive oils' }, iconKey: 'bottle' });
    const empty = await call('POST', base, 'eleni', { name: 'Nothing yet', iconKey: 'box' });
    await call('POST', `/v1/orgs/${s.orgId}/products`, 'eleni', { name: 'Koroneiki 1l', uom: 'piece', categoryId: c.body.id, variants: [{ priceMinor: 1200 }] });
    const slug = row('SELECT slug FROM organizations WHERE id = ?', s.orgId).slug;
    db.prepare("UPDATE organizations SET customer_catalog = 'public' WHERE id = ?").run(s.orgId);
    const res = await app.request(`/v1/public/orgs/${slug}`, { headers: { 'Accept-Language': 'en' } });
    const body = (await res.json()) as Json;
    const tile = body.categories.find((x: Json) => x.id === c.body.id);
    expect(tile).toMatchObject({ name: 'Olive oils', iconKey: 'bottle', imageUrl: null });
    const el = (await (await app.request(`/v1/public/orgs/${slug}`, { headers: { 'Accept-Language': 'el' } })).json()) as Json;
    expect(el.categories.find((x: Json) => x.id === c.body.id).name).toBe('Ελαιόλαδα');
    expect(body.categories.some((x: Json) => x.id === empty.body.id)).toBe(false);
    // the catalog filters by it, and its products carry the category for the placeholder
    const cat = (await (await app.request(`/v1/public/orgs/${slug}/catalog?categoryId=${c.body.id}`)).json()) as Json;
    expect(cat.length).toBeGreaterThan(0);
    expect(cat.every((p: Json) => p.categoryId === c.body.id && p.categoryIconKey === 'bottle')).toBe(true);
    // a closed catalog shows no categories
    db.prepare("UPDATE organizations SET customer_catalog = 'off' WHERE id = ?").run(s.orgId);
    expect(((await (await app.request(`/v1/public/orgs/${slug}`)).json()) as Json).categories).toEqual([]);
    db.prepare("UPDATE organizations SET customer_catalog = 'subscribers' WHERE id = ?").run(s.orgId);
  });
});
