// photo storage: the SigV4 signing against the AWS example, the settings, and uploads in
// production mode with a bucket (through a fake fetch, never a real bucket), local files on
// purpose, and storage off.

import { beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashPassword, migrate, openDb, seed, type Db, type SeedResult } from '@custock/db';
import { createApp, type App } from '../src/app';
import { objectTarget, presignUrl, s3Store, storageFromEnv, type S3Config } from '../src/lib/storage';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const SECRET = 'storage-test-secret-that-is-long-enough';
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);

describe('SigV4 presigned urls', () => {
  it('match the example in the AWS documentation', () => {
    const url = presignUrl({
      method: 'GET', host: 'examplebucket.s3.amazonaws.com', path: '/test.txt', region: 'us-east-1',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      date: new Date('2013-05-24T00:00:00Z'), expiresIn: 86400,
    });
    expect(url).toBe(
      'https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404',
    );
  });

  it('address R2 by path and AWS by bucket host', () => {
    const r2: S3Config = { bucket: 'custock-photos', region: 'auto', endpoint: 'https://acct123.r2.cloudflarestorage.com', accessKeyId: 'k', secretAccessKey: 's', publicUrl: 'https://img.example.com' };
    expect(objectTarget(r2, 'orgs/a/products/b.webp')).toEqual({ host: 'acct123.r2.cloudflarestorage.com', path: '/custock-photos/orgs/a/products/b.webp', scheme: 'https:' });
    expect(objectTarget({ ...r2, endpoint: undefined, region: 'eu-central-1' }, 'k.jpg')).toEqual({ host: 'custock-photos.s3.eu-central-1.amazonaws.com', path: '/k.jpg', scheme: 'https:' });
  });
});

describe('storage settings', () => {
  const r2 = {
    CUSTOCK_S3_BUCKET: 'custock-photos', CUSTOCK_S3_REGION: 'auto', CUSTOCK_S3_ENDPOINT: 'https://acct123.r2.cloudflarestorage.com',
    CUSTOCK_S3_ACCESS_KEY_ID: 'AKIDEXAMPLE', CUSTOCK_S3_SECRET_ACCESS_KEY: 'secret', CUSTOCK_S3_PUBLIC_URL: 'https://img.example.com/',
  };
  it('a server without bucket settings refuses uploads instead of filling its disk', () => {
    expect(storageFromEnv({}, false, '/data/uploads')).toEqual({ setting: { kind: 'off' }, problems: [], line: 'storage: off, photo uploads are refused (set CUSTOCK_S3_*, or CUSTOCK_STORAGE=local on purpose)' });
    expect(storageFromEnv({}, true, '/x').setting).toEqual({ kind: 'local' });
    expect(storageFromEnv({ CUSTOCK_STORAGE: 'local' }, false, '/data/uploads').line).toBe('storage: local files in /data/uploads (chosen with CUSTOCK_STORAGE=local)');
    expect(storageFromEnv({ CUSTOCK_STORAGE: 'disk' }, false, '/x').problems).toEqual(['CUSTOCK_STORAGE is local or s3']);
  });
  it('R2 and AWS from the environment, one line for the log', () => {
    const a = storageFromEnv(r2, false, '/x');
    expect(a.problems).toEqual([]);
    expect(a.setting).toEqual({ kind: 's3', s3: { bucket: 'custock-photos', region: 'auto', endpoint: 'https://acct123.r2.cloudflarestorage.com', accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret', publicUrl: 'https://img.example.com' } });
    expect(a.line).toBe('storage: s3 bucket custock-photos at acct123.r2.cloudflarestorage.com, photos read from https://img.example.com');
    const aws = storageFromEnv({ ...r2, CUSTOCK_S3_ENDPOINT: '', CUSTOCK_S3_REGION: 'eu-central-1', CUSTOCK_S3_PUBLIC_URL: 'https://custock-photos.s3.eu-central-1.amazonaws.com' }, false, '/x');
    expect(aws.line).toBe('storage: s3 bucket custock-photos at aws eu-central-1, photos read from https://custock-photos.s3.eu-central-1.amazonaws.com');
  });
  it('a half filled bucket setting stops the server', () => {
    expect(storageFromEnv({ CUSTOCK_S3_BUCKET: 'custock-photos' }, false, '/x').problems).toEqual([
      'CUSTOCK_S3_REGION must be set (auto for R2, for example eu-central-1 for AWS)',
      'CUSTOCK_S3_ACCESS_KEY_ID must be set',
      'CUSTOCK_S3_SECRET_ACCESS_KEY must be set',
      'CUSTOCK_S3_PUBLIC_URL must be the https address photos are read from',
    ]);
    expect(storageFromEnv({ ...r2, CUSTOCK_S3_PUBLIC_URL: 'http://img.example.com' }, false, '/x').problems).toHaveLength(1);
    const dir = mkdtempSync(join(tmpdir(), 'custock-storage-'));
    const env = { ...process.env, CUSTOCK_DEV: '1', CUSTOCK_S3_BUCKET: 'custock-photos', CUSTOCK_DB: join(dir, 'x.db'), CUSTOCK_WORKER: '0' };
    const r = spawnSync(process.execPath, ['--import', 'tsx', 'src/main.ts'], { env, encoding: 'utf8', timeout: 30_000 });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('photo storage refused');
  });
});

// ---------------------------------------------------------------- uploads in production mode

let db: Db;
let s: SeedResult;
const clock = Date.UTC(2026, 10, 18, 10, 0, 0);

async function login(app: App, who: string): Promise<string> {
  const res = await app.request('/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `${who}@example.com`, password: 'custock' }) });
  return ((await res.json()) as Json).accessToken;
}

function caller(app: App, token: string) {
  return async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const raw = body instanceof Uint8Array;
    const res = await app.request(path, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body !== undefined && !raw ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body === undefined ? undefined : raw ? (body as Uint8Array) : JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: Json = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // not json
    }
    return { status: res.status, body: parsed, headers: res.headers };
  };
}

beforeAll(() => {
  db = openDb(':memory:');
  migrate(db);
  s = seed(db, { passwordHash: hashPassword('custock'), now: clock });
});

describe('photos in a bucket', () => {
  const s3: S3Config = { bucket: 'custock-photos', region: 'auto', endpoint: 'https://acct123.r2.cloudflarestorage.com', accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret', publicUrl: 'https://img.example.com' };
  const calls: { url: string; method: string }[] = [];
  const store = s3Store(s3, async (url, init) => {
    calls.push({ url: String(url), method: init?.method ?? 'GET' });
    return new Response(null, { status: 204 });
  });
  let app: App;
  let call: ReturnType<typeof caller>;

  beforeAll(async () => {
    app = createApp({ db, dev: false, jwtSecret: SECRET, publicWebUrl: 'https://orestislef.gr/custock', apiPublicUrl: 'https://orestislef.gr/custock/api', corsOrigins: [], now: () => clock, rateLimit: false, storage: { kind: 's3', s3 }, photoStore: store });
    call = caller(app, await login(app, 'maria'));
  });

  it('presign gives a signed PUT straight to the bucket and the public address', async () => {
    const r = await call('POST', `/v1/orgs/${s.orgId}/uploads/presign`, { purpose: 'product', mime: 'image/webp', bytes: 1234 });
    expect(r.status).toBe(201);
    const key = `orgs/${s.orgId}/products/${r.body.fileId}.webp`;
    expect(r.body.publicUrl).toBe(`https://img.example.com/${key}`);
    expect(r.body.headers).toEqual({ 'Content-Type': 'image/webp', 'Cache-Control': 'public, max-age=31536000, immutable' });
    const u = new URL(r.body.uploadUrl);
    expect(`${u.origin}${u.pathname}`).toBe(`https://acct123.r2.cloudflarestorage.com/custock-photos/${key}`);
    expect(Object.fromEntries(u.searchParams)).toMatchObject({
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': 'AKIDEXAMPLE/20261118/auto/s3/aws4_request',
      'X-Amz-Date': '20261118T100000Z',
      'X-Amz-Expires': '600',
      'X-Amz-SignedHeaders': 'cache-control;content-length;content-type;host',
    });
    expect(u.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
    expect(db.prepare('SELECT storage_key, bytes, mime FROM files WHERE id = ?').get(r.body.fileId)).toEqual({ storage_key: key, bytes: 1234, mime: 'image/webp' });
  });

  it('the photo goes on a product, and leaves the bucket when it is taken off', async () => {
    const r = await call('POST', `/v1/orgs/${s.orgId}/uploads/presign`, { purpose: 'product', mime: 'image/jpeg', bytes: 900 });
    const p = await call('POST', `/v1/orgs/${s.orgId}/products`, { name: 'Bucket photo', imageUrls: [r.body.publicUrl] });
    expect(p.status).toBe(201);
    expect(p.body.images[0].url).toBe(r.body.publicUrl);
    // a key of this org that was never handed out is refused
    expect((await call('POST', `/v1/orgs/${s.orgId}/products`, { name: 'x', imageUrls: [`https://img.example.com/orgs/${s.orgId}/products/00000000-0000-7000-8000-000000000000.jpg`] })).status).toBe(400);
    const off = await call('PATCH', `/v1/orgs/${s.orgId}/products/${p.body.id}`, { imageUrls: [] });
    expect(off.status).toBe(200);
    const del = calls.find((x) => x.method === 'DELETE')!;
    expect(del.url).toContain(`/custock-photos/orgs/${s.orgId}/products/${r.body.fileId}.jpg?`);
    expect(new URL(del.url).searchParams.get('X-Amz-SignedHeaders')).toBe('host');
    expect((db.prepare('SELECT deleted_at FROM files WHERE id = ?').get(r.body.fileId) as Json).deleted_at).toBe(clock);
    // the api does not take the bytes itself
    expect((await app.request(`/files/uploads/${s.orgId}/${r.body.fileId}.jpg`)).status).toBe(404);
  });
});

describe('profile photos and the business logo in a bucket', () => {
  const s3: S3Config = { bucket: 'custock-photos', region: 'auto', endpoint: 'https://acct123.r2.cloudflarestorage.com', accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret', publicUrl: 'https://img.example.com' };
  const deleted: string[] = [];
  const store = s3Store(s3, async (url, init) => {
    if (init?.method === 'DELETE') deleted.push(new URL(String(url)).pathname);
    return new Response(null, { status: 204 });
  });
  let app: App;
  let maria: ReturnType<typeof caller>;
  let eleni: ReturnType<typeof caller>;

  beforeAll(async () => {
    app = createApp({ db, dev: false, jwtSecret: SECRET, publicWebUrl: 'https://orestislef.gr/custock', apiPublicUrl: 'https://orestislef.gr/custock/api', corsOrigins: [], now: () => clock, rateLimit: false, storage: { kind: 's3', s3 }, photoStore: store });
    maria = caller(app, await login(app, 'maria'));
    eleni = caller(app, await login(app, 'eleni'));
  });

  it('a person sets, replaces and removes their own photo, the old one leaves the bucket', async () => {
    // only small images, and never through the business route
    expect((await maria('POST', '/v1/me/uploads/presign', { purpose: 'avatar', mime: 'image/webp', bytes: 2_000_000 })).status).toBe(413);
    expect((await maria('POST', '/v1/me/uploads/presign', { purpose: 'product', mime: 'image/webp', bytes: 100 })).status).toBe(400);
    expect((await maria('POST', `/v1/orgs/${s.orgId}/uploads/presign`, { purpose: 'avatar', mime: 'image/webp', bytes: 100 })).status).toBe(400);
    const a = await maria('POST', '/v1/me/uploads/presign', { purpose: 'avatar', mime: 'image/webp', bytes: 4000 });
    expect(a.status).toBe(201);
    const key = `users/${s.users.maria}/avatar/${a.body.fileId}.webp`;
    expect(a.body.publicUrl).toBe(`https://img.example.com/${key}`);
    expect(new URL(a.body.uploadUrl).pathname).toBe(`/custock-photos/${key}`);
    expect(db.prepare('SELECT org_id, purpose FROM files WHERE id = ?').get(a.body.fileId)).toEqual({ org_id: null, purpose: 'avatar' });
    // someone else's file cannot become my photo
    expect((await eleni('PATCH', '/v1/me', { avatarFileId: a.body.fileId })).status).toBe(404);
    expect((await maria('PATCH', '/v1/me', { avatarFileId: a.body.fileId })).status).toBe(204);
    expect((await maria('GET', '/v1/me/context')).body.user.avatarUrl).toBe(a.body.publicUrl);
    // the team list shows it
    const team = await eleni('GET', `/v1/orgs/${s.orgId}/members`);
    expect(team.body.find((m: Json) => m.userId === s.users.maria).avatarUrl).toBe(a.body.publicUrl);
    // a new photo replaces it, the old object is deleted
    const b = await maria('POST', '/v1/me/uploads/presign', { purpose: 'avatar', mime: 'image/webp', bytes: 3000 });
    expect((await maria('PATCH', '/v1/me', { avatarFileId: b.body.fileId })).status).toBe(204);
    expect(deleted).toContain(`/custock-photos/${key}`);
    expect((db.prepare('SELECT deleted_at FROM files WHERE id = ?').get(a.body.fileId) as Json).deleted_at).toBe(clock);
    // removing it leaves the initials
    expect((await maria('PATCH', '/v1/me', { avatarFileId: null })).status).toBe(204);
    expect((await maria('GET', '/v1/me/context')).body.user.avatarUrl).toBeNull();
    expect(deleted).toContain(`/custock-photos/users/${s.users.maria}/avatar/${b.body.fileId}.webp`);
  });

  it('the owner sets the business logo, others cannot, and the public page shows it', async () => {
    expect((await maria('POST', `/v1/orgs/${s.orgId}/uploads/presign`, { purpose: 'logo', mime: 'image/png', bytes: 3000 })).status).toBe(403);
    expect((await eleni('POST', `/v1/orgs/${s.orgId}/uploads/presign`, { purpose: 'logo', mime: 'image/jpeg', bytes: 3000 })).status).toBe(415);
    const l = await eleni('POST', `/v1/orgs/${s.orgId}/uploads/presign`, { purpose: 'logo', mime: 'image/png', bytes: 3000 });
    expect(l.status).toBe(201);
    expect(l.body.publicUrl).toBe(`https://img.example.com/orgs/${s.orgId}/logo/${l.body.fileId}.png`);
    const set = await eleni('PATCH', `/v1/orgs/${s.orgId}`, { logoFileId: l.body.fileId });
    expect(set.status).toBe(200);
    expect(set.body.logoUrl).toBe(l.body.publicUrl);
    const slug = (db.prepare('SELECT slug FROM organizations WHERE id = ?').get(s.orgId) as Json).slug;
    expect(((await (await app.request(`/v1/public/orgs/${slug}`)).json()) as Json).logoUrl).toBe(l.body.publicUrl);
    // a product photo is not a logo
    const ph = await eleni('POST', `/v1/orgs/${s.orgId}/uploads/presign`, { purpose: 'product', mime: 'image/png', bytes: 3000 });
    expect((await eleni('PATCH', `/v1/orgs/${s.orgId}`, { logoFileId: ph.body.fileId })).status).toBe(404);
    expect((await eleni('PATCH', `/v1/orgs/${s.orgId}`, { logoFileId: null })).body.logoUrl).toBeNull();
    expect(deleted).toContain(`/custock-photos/orgs/${s.orgId}/logo/${l.body.fileId}.png`);
  });
});

describe('local files on purpose, in production mode', () => {
  let app: App;
  let call: ReturnType<typeof caller>;
  const dir = mkdtempSync(join(tmpdir(), 'custock-local-'));

  beforeAll(async () => {
    app = createApp({ db, dev: false, jwtSecret: SECRET, publicWebUrl: 'https://orestislef.gr/custock', apiPublicUrl: 'https://orestislef.gr/custock/api', corsOrigins: [], now: () => clock, rateLimit: false, storage: { kind: 'local' }, uploadDir: dir });
    call = caller(app, await login(app, 'maria'));
  });

  it('upload, then fetch with the type and a long cache', async () => {
    const r = await call('POST', `/v1/orgs/${s.orgId}/uploads/presign`, { purpose: 'product', mime: 'image/png', bytes: png.length });
    expect(r.status).toBe(201);
    expect(r.body.uploadUrl).toMatch(/^https:\/\/orestislef\.gr\/custock\/api\/v1\/uploads\//);
    const path = new URL(r.body.uploadUrl).pathname.replace('/custock/api', '');
    expect((await call('PUT', path, png, { 'Content-Type': 'image/png' })).status).toBe(204);
    const res = await app.request(new URL(r.body.publicUrl).pathname.replace('/custock/api', ''));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(png);
    // the type, the slot and the path are all checked
    expect((await call('PUT', path, png, { 'Content-Type': 'image/png' })).status).toBe(409);
    expect((await call('PUT', path.replace(/.$/, 'x'), png, { 'Content-Type': 'image/png' })).status).toBe(403);
    expect((await app.request('/files/uploads/../../etc/passwd')).status).toBe(404);
    expect((await app.request(`/files/uploads/${s.orgId}/`)).status).toBe(404);
  });
});

describe('a local profile photo', () => {
  it('uploads without a business and is served back', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'custock-avatar-'));
    const app = createApp({ db, dev: false, jwtSecret: SECRET, publicWebUrl: 'https://orestislef.gr/custock', apiPublicUrl: 'https://orestislef.gr/custock/api', corsOrigins: [], now: () => clock, rateLimit: false, storage: { kind: 'local' }, uploadDir: dir });
    const call = caller(app, await login(app, 'anna'));
    const r = await call('POST', '/v1/me/uploads/presign', { purpose: 'avatar', mime: 'image/png', bytes: png.length });
    expect(r.status).toBe(201);
    const path = new URL(r.body.uploadUrl).pathname.replace('/custock/api', '');
    expect((await call('PUT', path, png, { 'Content-Type': 'image/png' })).status).toBe(204);
    expect(db.prepare('SELECT org_id, purpose FROM files WHERE id = ?').get(r.body.fileId)).toEqual({ org_id: null, purpose: 'avatar' });
    expect((await call('PATCH', '/v1/me', { avatarFileId: r.body.fileId })).status).toBe(204);
    expect((await app.request(new URL(r.body.publicUrl).pathname.replace('/custock/api', ''))).status).toBe(200);
  });
});

describe('storage off', () => {
  it('refuses uploads and serves nothing', async () => {
    const app = createApp({ db, dev: false, jwtSecret: SECRET, publicWebUrl: 'https://x', corsOrigins: [], now: () => clock, rateLimit: false, storage: { kind: 'off' } });
    const call = caller(app, await login(app, 'maria'));
    expect((await call('POST', `/v1/orgs/${s.orgId}/uploads/presign`, { purpose: 'product', mime: 'image/png', bytes: 10 })).status).toBe(501);
    expect((await app.request('/v1/uploads/abc.def', { method: 'PUT', body: png })).status).toBe(404);
  });
});
