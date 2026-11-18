// the developer side of the platform: the api description lists every registered route with who
// may call it, it is public in dev and super admins only in production, and "This server" tells a
// super admin how the server runs without ever giving away a secret.

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword, migrate, openDb, seed, type Db } from '@custock/db';
import { uuidv7 } from '@custock/core';
import { createApp, type App } from '../src/app';
import { docPath } from '../src/openapi';
import { markWorkerRun, runtime } from '../src/lib/runtime';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const SECRET = 'platform-dev-test-secret-long-enough-1234';
const S3_SECRET = 'S3-SECRET-never-shown-0000000000000000';
const S3_KEY = 'S3KEYID-never-shown';
const SMTP_PASSWORD = 'smtp-password-never-shown';
const clock = Date.now();

async function call(app: App, method: string, path: string, token?: string) {
  const res = await app.request(path, { method, headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const text = await res.text();
  let body: Json = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // not json
  }
  return { status: res.status, body, text };
}

describe('platform developer screens', () => {
  let db: Db;
  let dev: App;
  let prod: App;
  const tokens: Record<string, string> = {};

  async function login(app: App, email: string) {
    const res = await app.request('/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'custock' }),
    });
    expect(res.status).toBe(200);
    return ((await res.json()) as Json).accessToken as string;
  }

  beforeAll(async () => {
    db = openDb(':memory:');
    migrate(db);
    seed(db, { passwordHash: hashPassword('custock'), now: clock });
    const root = uuidv7(clock);
    db.prepare(`INSERT INTO users (id, email, display_name, password_hash, locale, platform_role, created_at, updated_at) VALUES (?, ?, ?, ?, 'en', 'superadmin', ?, ?)`)
      .run(root, 'root@example.com', 'Root', hashPassword('custock'), clock, clock);
    const base = { db, jwtSecret: SECRET, publicWebUrl: 'https://example.test/custock', corsOrigins: [], now: () => clock, rateLimit: false };
    dev = createApp({ ...base, dev: true });
    prod = createApp({
      ...base,
      dev: false,
      sending: { email: true, fcm: false, webpush: true },
      storage: { kind: 's3', s3: { bucket: 'custock', region: 'auto', endpoint: 'https://acc.r2.cloudflarestorage.com', accessKeyId: S3_KEY, secretAccessKey: S3_SECRET, publicUrl: 'https://pub-123.r2.dev' } },
    });
    tokens.owner = await login(prod, 'eleni@example.com');
    tokens.staff = await login(prod, 'dimitris@example.com');
    tokens.root = await login(prod, 'root@example.com');
  });

  const saved = { ...process.env };
  afterEach(() => {
    for (const k of ['CUSTOCK_TRANSPORT', 'CUSTOCK_SMTP_URL', 'CUSTOCK_REV', 'CUSTOCK_BUILT_AT']) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('describes every route the api registers', async () => {
    const r = await call(dev, 'GET', '/v1/openapi.json');
    expect(r.status).toBe(200);
    const doc = r.body;
    const missing: string[] = [];
    for (const route of dev.routes) {
      if (route.method === 'ALL') continue;
      const op = doc.paths[docPath(route.path)]?.[route.method.toLowerCase()];
      if (!op) missing.push(`${route.method} ${route.path}`);
    }
    expect(missing).toEqual([]);
  });

  it('gives every operation a summary, a tag, who may call it and resolvable schemas', async () => {
    const doc = (await call(dev, 'GET', '/v1/openapi.json')).body;
    const names = new Set(Object.keys(doc.components.schemas));
    for (const [path, ops] of Object.entries<Json>(doc.paths)) {
      for (const [method, op] of Object.entries<Json>(ops)) {
        expect(op.summary, `${method} ${path}`).toMatch(/\S/);
        expect(op.tags?.length, `${method} ${path}`).toBe(1);
        expect(['public', 'user', 'org', 'superadmin']).toContain(op['x-access']);
        expect(Array.isArray(op['x-errors'])).toBe(true);
      }
    }
    for (const m of JSON.stringify(doc.paths).matchAll(/#\/components\/schemas\/([A-Za-z0-9_]+)/g)) expect(names.has(m[1]!), m[1]).toBe(true);
    const op = (p: string, m: string) => doc.paths[p][m];
    expect(op('/v1/orgs/{org}/products', 'get')['x-access']).toBe('org');
    expect(op('/v1/me/context', 'get')['x-access']).toBe('user');
    expect(op('/v1/public/join/{code}', 'get')['x-access']).toBe('public');
    expect(op('/v1/platform/overview', 'get')['x-access']).toBe('superadmin');
    expect(op('/v1/platform/server', 'get')['x-access']).toBe('superadmin');
    expect(op('/v1/orgs/{org}/movements', 'get')['x-permissions']).toContain('stock.history.view');
    expect(op('/v1/orgs/{org}/movements', 'get')['x-errors']).toContain('forbidden');
  });

  it('serves the api description only to super admins in production', async () => {
    expect((await call(prod, 'GET', '/v1/openapi.json')).status).toBe(401);
    expect((await call(prod, 'GET', '/v1/openapi.json', tokens.owner)).status).toBe(403);
    expect((await call(prod, 'GET', '/v1/openapi.json', tokens.staff)).status).toBe(403);
    const r = await call(prod, 'GET', '/v1/openapi.json', tokens.root);
    expect(r.status).toBe(200);
    expect(r.body.openapi).toBe('3.1.0');
  });

  it('shows this server to super admins only', async () => {
    expect((await call(prod, 'GET', '/v1/platform/server')).status).toBe(401);
    expect((await call(prod, 'GET', '/v1/platform/server', tokens.owner)).status).toBe(403);
    expect((await call(prod, 'GET', '/v1/platform/server', tokens.staff)).status).toBe(403);
    const r = await call(prod, 'GET', '/v1/platform/server', tokens.root);
    expect(r.status).toBe(200);
    expect(r.body.runtime.mode).toBe('production');
    expect(r.body.database.migrations.length).toBeGreaterThan(5);
    expect(r.body.database.bytes).toBeGreaterThan(0);
    expect(r.body.storage).toEqual({ kind: 's3', host: 'acc.r2.cloudflarestorage.com', bucket: 'custock', publicHost: 'pub-123.r2.dev' });
  });

  it('tells build, sending and worker state without a single secret', async () => {
    process.env.CUSTOCK_TRANSPORT = 'live';
    process.env.CUSTOCK_SMTP_URL = `smtps://shop%40gmail.com:${SMTP_PASSWORD}@smtp.gmail.com:465`;
    process.env.CUSTOCK_REV = 'abc1234';
    process.env.CUSTOCK_BUILT_AT = '2026-11-18T10:00:00Z';
    runtime.workerLastRunAt = null;
    let r = await call(prod, 'GET', '/v1/platform/server', tokens.root);
    expect(r.body.build).toEqual({ rev: 'abc1234', builtAt: '2026-11-18T10:00:00Z' });
    expect(r.body.sending).toEqual({ transport: 'live', email: { on: true, host: 'smtp.gmail.com:465' }, webpush: { on: true }, fcm: { on: false } });
    expect(r.body.worker.running).toBe(false);
    for (const secret of [SMTP_PASSWORD, 'shop%40gmail.com', 'shop@gmail.com', S3_SECRET, S3_KEY, SECRET]) expect(r.text).not.toContain(secret);

    markWorkerRun(clock - 5_000);
    r = await call(prod, 'GET', '/v1/platform/server', tokens.root);
    expect(r.body.worker.running).toBe(true);
    expect(r.body.worker.lastRunAt).toBe(clock - 5_000);
  });

  it('counts the job queue and the outbox of the last day', async () => {
    db.prepare(`INSERT INTO jobs (id, kind, payload, run_at, attempts, max_attempts, created_at) VALUES (?, 'x', '{}', ?, 0, 5, ?)`).run(uuidv7(clock), clock - 1000, clock);
    db.prepare(`INSERT INTO jobs (id, kind, payload, run_at, attempts, max_attempts, created_at) VALUES (?, 'x', '{}', ?, 0, 5, ?)`).run(uuidv7(clock), clock + 60_000, clock);
    db.prepare(`INSERT INTO jobs (id, kind, payload, run_at, attempts, max_attempts, created_at) VALUES (?, 'x', '{}', ?, 5, 5, ?)`).run(uuidv7(clock), clock - 1000, clock);
    const r = await call(prod, 'GET', '/v1/platform/server', tokens.root);
    expect(r.body.worker.queued).toBeGreaterThanOrEqual(1);
    expect(r.body.worker.scheduled).toBeGreaterThanOrEqual(1);
    expect(r.body.worker.failed).toBeGreaterThanOrEqual(1);
    expect(r.body.outbox).toEqual({ sent: expect.any(Number), failed: expect.any(Number), waiting: expect.any(Number) });
  });
});
