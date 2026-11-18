// the developer side of the platform, for super admins: the api description and the state of
// this server. GET /v1/openapi.json is public in dev and super admins only in production.
// GET /v1/platform/server sits under the /v1/platform/* guard in routes/platform.ts and checks
// again here, so it stays closed whatever the order of registration.
//
// nothing secret ever leaves this file: no keys, passwords, tokens or full urls with credentials,
// only on or off and hostnames.

import { statSync } from 'node:fs';
import type { Hono, MiddlewareHandler } from 'hono';
import type { ServerInfo } from '@custock/core';
import type { AppEnv, Config } from '../types';
import { requireAuth } from '../lib/context';
import { ApiProblem } from '../lib/problem';
import { isSuperadmin } from '../lib/platform-access';
import { platform } from '../lib/tenant';
import { runtime } from '../lib/runtime';
import { buildOpenApi } from '../openapi';

const DAY = 24 * 60 * 60 * 1000;

const onlySuperadmin = (c: Parameters<MiddlewareHandler<AppEnv>>[0]) => {
  if (!isSuperadmin(c.get('cfg').db, c.get('user').id)) throw new ApiProblem(403, 'forbidden', 'super admins only');
};

// dev: anyone. production: a signed in super admin
const openApiGate: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.get('cfg').dev) return next();
  return requireAuth(c, async () => {
    onlySuperadmin(c);
    await next();
  });
};

function hostOf(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).host || null;
  } catch {
    return null;
  }
}

function fileBytes(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

export function serverInfo(cfg: Config, now: number, env: NodeJS.ProcessEnv = process.env): ServerInfo {
  const db = cfg.db;
  const p = platform(db);
  const file = (db as unknown as { name?: string }).name ?? '';
  const onDisk = !!file && file !== ':memory:' && !file.startsWith('file::memory:');
  const pageSize = Number(db.pragma('page_size', { simple: true })) || 0;
  const pageCount = Number(db.pragma('page_count', { simple: true })) || 0;

  const migrations = (() => {
    try {
      return p.all<{ name: string; applied_at: number }>('SELECT name, applied_at FROM schema_migrations ORDER BY name').map((m) => ({ name: m.name, appliedAt: m.applied_at }));
    } catch {
      return [];
    }
  })();

  const jobs = p.get<{ queued: number; scheduled: number; failed: number }>(
    `SELECT coalesce(sum(CASE WHEN run_at <= @now AND attempts < max_attempts THEN 1 ELSE 0 END), 0) AS queued,
            coalesce(sum(CASE WHEN run_at > @now AND attempts < max_attempts THEN 1 ELSE 0 END), 0) AS scheduled,
            coalesce(sum(CASE WHEN attempts >= max_attempts THEN 1 ELSE 0 END), 0) AS failed
       FROM jobs WHERE done_at IS NULL`,
    { now },
  ) ?? { queued: 0, scheduled: 0, failed: 0 };

  const transport = env.CUSTOCK_TRANSPORT === 'live' ? 'live' : 'outbox';
  const out = p.get<{ sent: number; failed: number; waiting: number }>(
    `SELECT coalesce(sum(CASE WHEN sent_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS sent,
            coalesce(sum(CASE WHEN sent_at IS NULL AND last_error IS NOT NULL THEN 1 ELSE 0 END), 0) AS failed,
            coalesce(sum(CASE WHEN sent_at IS NULL AND last_error IS NULL THEN 1 ELSE 0 END), 0) AS waiting
       FROM dev_outbox WHERE created_at >= @since`,
    { since: now - DAY },
  ) ?? { sent: 0, failed: 0, waiting: 0 };

  const storage = cfg.storage ?? { kind: 'local' as const };
  const s3 = storage.kind === 's3' ? storage.s3 : null;
  const sending = cfg.sending ?? { email: false, fcm: false, webpush: false };
  const last = runtime.workerLastRunAt;

  return {
    build: { rev: env.CUSTOCK_REV?.trim() || null, builtAt: env.CUSTOCK_BUILT_AT?.trim() || null },
    runtime: {
      mode: cfg.dev ? 'dev' : 'production',
      node: process.version,
      startedAt: runtime.startedAt,
      uptimeSeconds: Math.max(0, Math.round((now - runtime.startedAt) / 1000)),
    },
    database: {
      bytes: onDisk ? fileBytes(file) : pageSize * pageCount,
      walBytes: onDisk ? fileBytes(`${file}-wal`) : 0,
      migrations,
    },
    sending: {
      transport,
      email: { on: transport === 'live' && sending.email, host: transport === 'live' && sending.email ? hostOf(env.CUSTOCK_SMTP_URL) : null },
      webpush: { on: transport === 'live' && sending.webpush },
      fcm: { on: transport === 'live' && sending.fcm },
    },
    storage: {
      kind: storage.kind,
      host: s3 ? hostOf(s3.endpoint) ?? `s3.${s3.region}.amazonaws.com` : null,
      bucket: s3 ? s3.bucket : null,
      publicHost: s3 ? hostOf(s3.publicUrl) : null,
    },
    worker: {
      running: last !== null && now - last < 60_000,
      lastRunAt: last,
      queued: jobs.queued,
      scheduled: jobs.scheduled,
      failed: jobs.failed,
    },
    outbox: { sent: out.sent, failed: out.failed, waiting: out.waiting },
  };
}

export function platformDevRoutes(app: Hono<AppEnv>) {
  let openapi: Record<string, unknown> | null = null;
  app.get('/v1/openapi.json', openApiGate, (c) => {
    c.header('Cache-Control', 'no-store');
    return c.json((openapi ??= buildOpenApi(app, process.env.CUSTOCK_REV?.trim() || '0.1.0')));
  });

  app.get('/v1/platform/server', requireAuth, (c) => {
    onlySuperadmin(c);
    const cfg = c.get('cfg');
    c.header('Cache-Control', 'no-store');
    return c.json(serverInfo(cfg, (cfg.now ?? Date.now)()));
  });
}
