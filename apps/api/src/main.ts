// starts the api on http://localhost:8787.
// dev features (dev codes, dev outbox endpoints, the bot check stand in, the dev secret) only with
// CUSTOCK_DEV=1 or --dev (pnpm dev:api passes --dev).

import { serve } from '@hono/node-server';
import { existsSync } from 'node:fs';
import { DEFAULT_DB_PATH, migrate, openDb, seed } from '@custock/db';
import { createApp } from './app';
import { startWorker } from './worker';

const dev = process.env.CUSTOCK_DEV === '1' || process.argv.includes('--dev');
const DEV_SECRET = 'dev-only-secret-change-me-before-anything-real';
const jwtSecret = process.env.CUSTOCK_JWT_SECRET ?? (dev ? DEV_SECRET : '');
if (!dev && (jwtSecret.length < 32 || jwtSecret === DEV_SECRET)) {
  console.error('CUSTOCK_JWT_SECRET must be set to a random value of at least 32 characters (or run with CUSTOCK_DEV=1 locally)');
  process.exit(1);
}

const dbPath = process.env.CUSTOCK_DB ?? DEFAULT_DB_PATH;
const fresh = !existsSync(dbPath);
const db = openDb(dbPath);
migrate(db);
// the made up Lemoni business only lands in a new database when asked, or in dev
if (fresh && (process.env.CUSTOCK_SEED === '1' || dev)) {
  const r = seed(db);
  console.log(`new database, seeded Lemoni (${r.customers} customers, ${r.movements} movements)`);
}

const port = Number(process.env.PORT ?? 8787);
const publicWebUrl = process.env.CUSTOCK_PUBLIC_WEB_URL ?? 'http://localhost:3000';
const unsubSecret = process.env.CUSTOCK_UNSUB_SECRET;
const app = createApp({
  db,
  dev,
  jwtSecret,
  unsubSecret,
  publicWebUrl,
  corsOrigins: (process.env.CUSTOCK_CORS ?? 'http://localhost:3000,http://localhost:8081,http://localhost:19006').split(','),
  trustedProxy: process.env.CUSTOCK_TRUSTED_PROXY === '1',
  turnstileSecret: process.env.CUSTOCK_TURNSTILE_SECRET,
});

const stopWorker =
  process.env.CUSTOCK_WORKER === '0' ? () => {} : startWorker({ cfg: { db, jwtSecret, unsubSecret, publicWebUrl }, log: (l) => console.log(l) });

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`custock api on http://localhost:${info.port} (${dev ? 'dev' : 'production'}, db ${dbPath})`);
});

const stop = () => {
  stopWorker();
  server.close();
  db.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
