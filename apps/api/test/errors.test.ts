// the error tracker: grouping, scrubbing, the browser report endpoint and its limits, super admin
// only access, reopening on repeat, retention, and the notice email (outbox only, nothing is sent).

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hashPassword, migrate, openDb, seed, type Db, type SeedResult } from '@custock/db';
import { uuidv7 } from '@custock/core';
import { createApp, type App } from '../src/app';
import { runCli } from '../src/cli';
import { drainOutbox, type LiveSender } from '../src/lib/live';
import { devOutboxTransport } from '../src/lib/transport';
import { s3Store } from '../src/lib/storage';
import { enqueue, runJobs } from '../src/worker';
import {
  captureError, cleanStack, ERROR_KEEP_MS, ERROR_MAX_ISSUES, ERROR_NOTICES_PER_DAY, normalizeRoute, pruneErrors, scrub, topFrame,
} from '../src/lib/errors';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const SECRET = 'errors-test-secret-long-enough-12345';
const clock = Date.now();
const WEB = 'http://localhost:3000/custock';

const browser = { browser: 'chrome', os: 'android' } as const;

describe('error tracker', () => {
  let db: Db;
  let s: SeedResult;
  let app: App;
  let limited: App;
  const tokens: Record<string, string> = {};

  async function call(target: App, method: string, path: string, token?: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await target.request(path, {
      method,
      headers: { ...headers, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: Json = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // not json
    }
    return { status: res.status, body: parsed };
  }

  const issues = () => db.prepare('SELECT * FROM error_events ORDER BY first_seen, rowid').all() as Json[];
  const notices = () => db.prepare("SELECT * FROM dev_outbox WHERE json_extract(payload, '$.type') = 'error_notice'").all() as Json[];

  beforeAll(async () => {
    db = openDb(':memory:');
    migrate(db);
    s = seed(db, { passwordHash: hashPassword('custock'), now: clock });
    app = createApp({ db, dev: false, jwtSecret: SECRET, publicWebUrl: WEB, corsOrigins: [], now: () => clock, rateLimit: false });
    limited = createApp({ db, dev: false, jwtSecret: SECRET, publicWebUrl: WEB, corsOrigins: [], now: () => clock });
    // a route that fails like real code does, with things in the message that must never be stored
    app.get('/v1/test/boom/:id', () => {
      throw new Error('boom for maria@example.com while reading row 42');
    });
    const login = async (email: string) => {
      const r = await call(app, 'POST', '/v1/auth/login', undefined, { email, password: 'custock' });
      expect(r.status).toBe(200);
      return r.body.accessToken as string;
    };
    const rootId = uuidv7(clock);
    db.prepare(`INSERT INTO users (id, email, display_name, password_hash, locale, created_at, updated_at) VALUES (?, 'root@example.com', 'Root', ?, 'en', ?, ?)`)
      .run(rootId, hashPassword('custock'), clock, clock);
    expect(await runCli(db, ['make-superadmin', '--email', 'root@example.com'], { env: {}, readStdin: async () => '', out: () => {} })).toBe(0);
    for (const who of ['eleni', 'dimitris', 'anna', 'root']) tokens[who] = await login(`${who}@example.com`);
  });

  beforeEach(() => {
    db.prepare('DELETE FROM error_events').run();
    db.prepare('DELETE FROM dev_outbox').run();
  });

  // ------------------------------------------------------------ scrubbing

  it('scrubs emails, tokens, passwords, secrets in urls and query strings', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    const dirty = [
      'failed for maria@example.com',
      `Authorization: Bearer ${jwt}`,
      `token ${jwt}`,
      'password=hunter2 and secret: s3cr3t-value',
      'GET https://example.com/reset?token=abcdef&next=/admin',
      'smtps://custock.app%40gmail.com:app-password-here@smtp.gmail.com:465',
      'invite AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-xyz expired',
      'code=482913 was wrong',
      'connect ECONNREFUSED 10.0.0.12:465',
      'call +30 694 123 4567 later',
    ].join('\n');
    const clean = scrub(dirty);
    for (const leak of ['maria@example.com', jwt, 'hunter2', 's3cr3t-value', 'token=abcdef', 'app-password-here', 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-xyz', '482913', '10.0.0.12', '694 123 4567']) {
      expect(clean).not.toContain(leak);
    }
    expect(clean).toContain('[email]');
    expect(clean).toContain('Authorization: [redacted]');
    expect(scrub(`sent Bearer ${jwt}`)).toBe('sent Bearer [token]');
    expect(clean).toContain('?[query]');
    expect(clean).toContain('[credentials]@smtp.gmail.com');
    // ids stay: they are how an issue is traced
    const id = '01a1edbb-4f4e-711e-9feb-b875fc41aaaf';
    expect(scrub(`org ${id} failed`)).toContain(id);
  });

  it('keeps stacks short, without absolute paths, and finds our own top frame', () => {
    const stack = [
      'Error: boom',
      '    at Object.<anonymous> (/app/node_modules/hono/dist/compose.js:22:17)',
      '    at rollupOrg (/app/apps/api/src/worker.ts:301:11)',
      '    at rollup (file:///app/apps/api/src/worker.ts:290:7)',
    ].join('\n');
    const clean = cleanStack(stack)!;
    expect(clean).not.toContain('/app/apps');
    expect(clean).toContain('apps/api/src/worker.ts:301:11');
    expect(topFrame(clean)).toBe('rollupOrg (apps/api/src/worker.ts)');
    expect(normalizeRoute('/v1/orgs/01a1edbb-4f4e-711e-9feb-b875fc41aaaf/products/42?x=1')).toBe('/v1/orgs/:id/products/:n');
  });

  // ------------------------------------------------------------ grouping

  it('groups occurrences that only differ by numbers and ids, and splits by route', () => {
    const a = captureError(db, { kind: 'worker', message: 'row 17 of 01a1edbb-4f4e-711e-9feb-b875fc41aaaf is missing', route: 'job send_post' }, { now: clock })!;
    const b = captureError(db, { kind: 'worker', message: 'row 93 of 01a1edbb-4f4e-711e-9feb-b875fc41aaab is missing', route: 'job send_post' }, { now: clock + 1 })!;
    const c = captureError(db, { kind: 'worker', message: 'row 93 of 01a1edbb-4f4e-711e-9feb-b875fc41aaab is missing', route: 'job rollup_day' }, { now: clock + 2 })!;
    expect(a.isNew).toBe(true);
    expect(b).toEqual({ id: a.id, isNew: false });
    expect(c.id).not.toBe(a.id);
    const rows = issues();
    expect(rows).toHaveLength(2);
    expect(rows[0].count).toBe(2);
    expect(rows[0].last_seen).toBe(clock + 1);
    expect(JSON.parse(rows[0].example).message).toContain('row 93');
  });

  it('records a 5xx from the api with the route pattern and nothing personal', async () => {
    const r = await call(app, 'GET', '/v1/test/boom/01a1edbb-4f4e-711e-9feb-b875fc41aaaf', tokens.eleni);
    expect(r.status).toBe(500);
    // the answer itself says nothing about internals
    expect(JSON.stringify(r.body)).not.toContain('boom');
    const [row] = issues();
    expect(row.kind).toBe('api');
    expect(row.route).toBe('/v1/test/boom/:id');
    expect(row.title).toContain('boom for [email]');
    const ex = JSON.parse(row.example);
    expect(ex.method).toBe('GET');
    expect(ex.status).toBe(500);
    expect(ex.stack).toContain('test/errors.test.ts');
    expect(JSON.stringify(row)).not.toContain('maria@example.com');
    // one request, one occurrence
    expect(row.count).toBe(1);
  });

  it('records a failed worker job, a failed send and a failed storage delete', async () => {
    enqueue(db, 'no_such_job', {}, clock - 1);
    await runJobs({ cfg: { db, jwtSecret: SECRET, publicWebUrl: WEB } }, clock);
    devOutboxTransport(db, () => {}).send({ channel: 'email', orgId: s.orgId, to: 'goes@example.com', locale: 'en', title: 'Hi', body: 'b' });
    const sender: LiveSender = { email: async () => { throw new Error('535 auth failed for goes@example.com'); } };
    await drainOutbox(db, sender, clock);
    const store = s3Store(
      { bucket: 'b', region: 'auto', endpoint: 'https://acct.r2.cloudflarestorage.com', accessKeyId: 'AKID', secretAccessKey: 'x', publicUrl: 'https://img.example.com' },
      async () => new Response('no', { status: 500 }),
      (err) => captureError(db, { kind: 'storage', error: err, route: 'storage delete' }, { now: clock }),
    );
    await store.remove(`orgs/${s.orgId}/products/${uuidv7(clock)}.webp`);
    const byKind = Object.fromEntries(issues().map((r) => [r.kind, r]));
    expect(byKind.worker.route).toBe('job no_such_job');
    expect(byKind.send.route).toBe('send email');
    expect(byKind.send.title).not.toContain('goes@example.com');
    expect(byKind.storage.title).toContain('HTTP 500');
  });

  // ------------------------------------------------------------ browsers

  it('takes a browser report: strict, small, without query strings', async () => {
    const ok = await call(app, 'POST', '/v1/client-errors', undefined, { source: 'error', message: 'x is not a function', stack: 'TypeError: x is not a function\n    at onClick (_next/static/chunks/page.js:1:200)', path: '/admin/stock', ...browser, build: 'abc123' });
    expect(ok.status).toBe(204);
    const api = await call(app, 'POST', '/v1/client-errors', undefined, { source: 'api', message: 'internal', path: '/admin', method: 'GET', apiPath: '/v1/orgs/01a1edbb-4f4e-711e-9feb-b875fc41aaaf/products', status: 502, ...browser });
    expect(api.status).toBe(204);
    const rows = issues();
    expect(rows.map((r) => r.kind)).toEqual(['client', 'client']);
    expect(JSON.parse(rows[0].example)).toMatchObject({ browser: 'chrome', os: 'android', build: 'abc123', userId: null });
    expect(rows[1].route).toBe('/v1/orgs/:id/products');
    expect(rows[1].title).toContain('HTTP 502 on GET');
    // a query string, an unknown field, a user agent string or a huge body are refused
    expect((await call(app, 'POST', '/v1/client-errors', undefined, { source: 'error', message: 'm', path: '/admin?token=x', ...browser })).status).toBe(400);
    expect((await call(app, 'POST', '/v1/client-errors', undefined, { source: 'error', message: 'm', path: '/a', email: 'x@example.com', ...browser })).status).toBe(400);
    expect((await call(app, 'POST', '/v1/client-errors', undefined, { source: 'error', message: 'm', path: '/a', browser: 'Mozilla/5.0 (iPhone)', os: 'ios' })).status).toBe(400);
    expect((await call(app, 'POST', '/v1/client-errors', undefined, JSON.stringify({ source: 'error', message: 'm', path: '/a', stack: 'x'.repeat(20_000), ...browser }))).status).toBe(413);
  });

  it('rate limits browser reports per address', async () => {
    const body = { source: 'error', message: 'flood', path: '/a', ...browser };
    const statuses: number[] = [];
    for (let i = 0; i < 22; i++) statuses.push((await call(limited, 'POST', '/v1/client-errors', undefined, body, { 'X-Forwarded-For': '203.0.113.9' })).status);
    expect(statuses.slice(0, 20).every((st) => st === 204)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
    expect(issues()).toHaveLength(1);
    expect(issues()[0].count).toBe(20);
  });

  // ------------------------------------------------------------ the super admin screen

  it('only super admins read and triage issues', async () => {
    captureError(db, { kind: 'api', message: 'database is locked', route: '/v1/orgs/:org/products' }, { now: clock });
    expect((await call(app, 'GET', '/v1/platform/errors')).status).toBe(401);
    for (const who of ['eleni', 'dimitris', 'anna']) {
      expect((await call(app, 'GET', '/v1/platform/errors', tokens[who])).status).toBe(403);
    }
    const [row] = issues();
    expect((await call(app, 'GET', `/v1/platform/errors/${row.id}`, tokens.eleni)).status).toBe(403);
    expect((await call(app, 'PATCH', `/v1/platform/errors/${row.id}`, tokens.eleni, { status: 'resolved' })).status).toBe(403);

    const list = await call(app, 'GET', '/v1/platform/errors', tokens.root);
    expect(list.status).toBe(200);
    expect(list.body.counts).toEqual({ open: 1, resolved: 0, ignored: 0 });
    expect(list.body.items[0]).toMatchObject({ kind: 'api', title: 'database is locked', count: 1, status: 'open' });
    const detail = await call(app, 'GET', `/v1/platform/errors/${row.id}`, tokens.root);
    expect(detail.body.example.message).toBe('database is locked');
    expect((await call(app, 'GET', '/v1/platform/errors?q=locked', tokens.root)).body.items).toHaveLength(1);
    expect((await call(app, 'GET', '/v1/platform/errors?kind=client', tokens.root)).body.items).toHaveLength(0);
  });

  it('a resolved issue comes back when it happens again, an ignored one stays quiet', async () => {
    const a = captureError(db, { kind: 'api', message: 'pool timeout', route: '/v1/me/context' }, { now: clock })!;
    const b = captureError(db, { kind: 'api', message: 'noisy but harmless', route: '/v1/me/context' }, { now: clock })!;
    const res = await call(app, 'PATCH', `/v1/platform/errors/${a.id}`, tokens.root, { status: 'resolved' });
    expect(res.body).toMatchObject({ status: 'resolved', resolvedAt: clock });
    await call(app, 'PATCH', `/v1/platform/errors/${b.id}`, tokens.root, { status: 'ignored' });
    captureError(db, { kind: 'api', message: 'pool timeout', route: '/v1/me/context' }, { now: clock + 5 });
    captureError(db, { kind: 'api', message: 'noisy but harmless', route: '/v1/me/context' }, { now: clock + 5 });
    const byId = Object.fromEntries(issues().map((r) => [r.id, r]));
    expect(byId[a.id]).toMatchObject({ status: 'open', resolved_at: null, count: 2 });
    expect(byId[b.id]).toMatchObject({ status: 'ignored', count: 2 });
    expect((await call(app, 'PATCH', `/v1/platform/errors/${a.id}`, tokens.root, { status: 'gone' })).status).toBe(400);
  });

  // ------------------------------------------------------------ retention

  it('keeps 30 days and at most 500 issues', () => {
    captureError(db, { kind: 'api', message: 'old one', route: '/x' }, { now: clock - ERROR_KEEP_MS - 1, notify: false });
    captureError(db, { kind: 'api', message: 'fresh one', route: '/x' }, { now: clock, notify: false });
    pruneErrors(db, clock);
    expect(issues().map((r) => r.title)).toEqual(['fresh one']);

    db.prepare('DELETE FROM error_events').run();
    const insert = db.prepare(`INSERT INTO error_events (id, fingerprint, kind, title, status, count, first_seen, last_seen, example) VALUES (?, ?, 'api', ?, 'open', 1, ?, ?, '{}')`);
    db.transaction(() => {
      for (let i = 0; i < ERROR_MAX_ISSUES + 20; i++) insert.run(uuidv7(clock), `fp${i}`, `issue ${i}`, clock - 1000 + i, clock - 1000 + i);
    })();
    pruneErrors(db, clock);
    const left = issues();
    expect(left).toHaveLength(ERROR_MAX_ISSUES);
    // the oldest seen went first
    expect(left.some((r) => r.title === 'issue 0')).toBe(false);
    expect(left.some((r) => r.title === `issue ${ERROR_MAX_ISSUES + 19}`)).toBe(true);
  });

  // ------------------------------------------------------------ the notice email

  it('emails the super admins once per new issue, at most 10 a day, through the outbox', () => {
    captureError(db, { kind: 'worker', message: 'brand new failure', route: 'job send_post' }, { now: clock });
    captureError(db, { kind: 'worker', message: 'brand new failure', route: 'job send_post' }, { now: clock + 1 });
    let mail = notices();
    expect(mail).toHaveLength(1);
    expect(mail[0].to_address).toBe('root@example.com');
    expect(mail[0].channel).toBe('email');
    expect(mail[0].html).toContain('/custock/admin/platform/errors/');
    // never sent from here: it waits in the outbox like every other email
    expect(mail[0].sent_at).toBeNull();
    for (let i = 0; i < 15; i++) captureError(db, { kind: 'api', message: `different failure ${'abcdefghijklmnop'[i]}`, route: `/v1/r${'abcdefghijklmnop'[i]}` }, { now: clock + 10 + i });
    mail = notices();
    expect(mail).toHaveLength(ERROR_NOTICES_PER_DAY);
    // a day later there is room again
    captureError(db, { kind: 'api', message: 'next day failure', route: '/v1/next' }, { now: clock + 86_400_000 + 60_000 });
    expect(notices()).toHaveLength(ERROR_NOTICES_PER_DAY + 1);
  });
});
