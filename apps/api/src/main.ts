// starts the api on http://localhost:8787. run `pnpm db:reset` once first.

import { serve } from '@hono/node-server';
import { existsSync } from 'node:fs';
import { DEFAULT_DB_PATH, migrate, openDb, seed } from '@custock/db';
import { createApp } from './app';
import { startWorker } from './worker';

const dbPath = process.env.CUSTOCK_DB ?? DEFAULT_DB_PATH;
const fresh = !existsSync(dbPath);
const db = openDb(dbPath);
migrate(db);
if (fresh) {
  const r = seed(db);
  console.log(`new database, seeded Lemoni (${r.customers} customers, ${r.movements} movements)`);
}

const dev = process.env.NODE_ENV !== 'production';
const port = Number(process.env.PORT ?? 8787);
const app = createApp({
  db,
  dev,
  jwtSecret: process.env.CUSTOCK_JWT_SECRET ?? 'dev-only-secret-change-me-before-anything-real',
  publicWebUrl: process.env.CUSTOCK_PUBLIC_WEB_URL ?? 'http://localhost:3000',
  corsOrigins: (process.env.CUSTOCK_CORS ?? 'http://localhost:3000,http://localhost:8081,http://localhost:19006').split(','),
});

if (!dev && !process.env.CUSTOCK_JWT_SECRET) {
  console.error('CUSTOCK_JWT_SECRET is required in production');
  process.exit(1);
}

const jwtSecret = process.env.CUSTOCK_JWT_SECRET ?? 'dev-only-secret-change-me-before-anything-real';
const publicWebUrl = process.env.CUSTOCK_PUBLIC_WEB_URL ?? 'http://localhost:3000';
const stopWorker = process.env.CUSTOCK_WORKER === '0' ? () => {} : startWorker({ cfg: { db, jwtSecret, publicWebUrl }, log: (l) => console.log(l) });

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
