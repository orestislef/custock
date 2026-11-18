// starts the api on http://localhost:8787.
// dev features (dev codes, dev outbox endpoints, the bot check stand in, the dev secret, local
// uploads) only with CUSTOCK_DEV=1 or --dev (pnpm dev:api passes --dev).
// sending for real only with CUSTOCK_TRANSPORT=live, the credentials and CUSTOCK_ALLOW_SENDING=yes.

import { serve } from '@hono/node-server';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRemoteJWKSet } from 'jose';
import { DEFAULT_DB_PATH, hashPassword, migrate, openDb, rebuildSearch, seed } from '@custock/db';
import { createApp } from './app';
import { createLiveSender, liveProblems, type LiveSender } from './lib/live';
import type { Config } from './types';
import { startWorker } from './worker';

const env = process.env;
const fail = (msg: string): never => {
  console.error(msg);
  process.exit(1);
};

const dev = env.CUSTOCK_DEV === '1' || process.argv.includes('--dev');
const DEV_SECRET = 'dev-only-secret-change-me-before-anything-real';
const jwtSecret = env.CUSTOCK_JWT_SECRET ?? (dev ? DEV_SECRET : '');
if (!dev && (jwtSecret.length < 32 || jwtSecret === DEV_SECRET)) {
  fail('CUSTOCK_JWT_SECRET must be set to a random value of at least 32 characters (or run with CUSTOCK_DEV=1 locally)');
}

// who signs the tokens
let auth: Config['auth'] = { mode: 'local' };
const authMode = env.CUSTOCK_AUTH_MODE ?? 'local';
if (authMode === 'jwks') {
  const url = env.CUSTOCK_AUTH_JWKS_URL;
  const issuer = env.CUSTOCK_AUTH_ISSUER;
  const audience = env.CUSTOCK_AUTH_AUDIENCE;
  if (!url || !issuer || !audience) fail('CUSTOCK_AUTH_MODE=jwks needs CUSTOCK_AUTH_JWKS_URL, CUSTOCK_AUTH_ISSUER and CUSTOCK_AUTH_AUDIENCE');
  if (!url!.startsWith('https://') && !dev) fail('CUSTOCK_AUTH_JWKS_URL must be https');
  auth = { mode: 'jwks', issuer: issuer!, audience: audience!, keys: createRemoteJWKSet(new URL(url!)) };
} else if (authMode !== 'local') {
  fail(`unknown CUSTOCK_AUTH_MODE ${authMode} (local or jwks)`);
}

// how messages leave: the outbox table only (default), or for real
let live: LiveSender | undefined;
const transport = env.CUSTOCK_TRANSPORT ?? 'outbox';
if (transport === 'live') {
  const problems = liveProblems(env, existsSync);
  if (problems.length) fail(`CUSTOCK_TRANSPORT=live refused:\n  ${problems.join('\n  ')}`);
  live = createLiveSender({ serviceAccountPath: env.CUSTOCK_FCM_SERVICE_ACCOUNT!, smtpUrl: env.CUSTOCK_SMTP_URL!, mailFrom: env.CUSTOCK_MAIL_FROM! });
} else if (transport !== 'outbox') {
  fail(`unknown CUSTOCK_TRANSPORT ${transport} (outbox or live)`);
}

const dbPath = env.CUSTOCK_DB ?? DEFAULT_DB_PATH;
const fresh = !existsSync(dbPath);
const db = openDb(dbPath);
migrate(db);
// the made up Lemoni business only lands in a new database when asked, or in dev
// on a shared server CUSTOCK_SEED_PASSWORD replaces the public dev password of the demo accounts
if (fresh && (env.CUSTOCK_SEED === '1' || dev)) {
  if (!dev && env.CUSTOCK_SEED === '1' && (env.CUSTOCK_SEED_PASSWORD ?? '').length < 12) {
    fail('CUSTOCK_SEED outside dev needs CUSTOCK_SEED_PASSWORD (12+ characters)');
  }
  const r = seed(db, env.CUSTOCK_SEED_PASSWORD ? { passwordHash: hashPassword(env.CUSTOCK_SEED_PASSWORD) } : {});
  console.log(`new database, seeded Lemoni (${r.customers} customers, ${r.movements} movements)`);
}
// rowids can move after a restore or VACUUM INTO, the search index follows them again
rebuildSearch(db);

const port = Number(env.PORT ?? 8787);
const publicWebUrl = env.CUSTOCK_PUBLIC_WEB_URL ?? 'http://localhost:3000';
const unsubSecret = env.CUSTOCK_UNSUB_SECRET;
const app = createApp({
  db,
  dev,
  jwtSecret,
  unsubSecret,
  publicWebUrl,
  corsOrigins: (env.CUSTOCK_CORS ?? 'http://localhost:3000,http://localhost:8081,http://localhost:19006').split(','),
  trustedProxy: env.CUSTOCK_TRUSTED_PROXY === '1',
  turnstileSecret: env.CUSTOCK_TURNSTILE_SECRET,
  apiPublicUrl: env.CUSTOCK_API_URL ?? `http://localhost:${port}`,
  uploadDir: env.CUSTOCK_UPLOAD_DIR ?? join(dirname(dbPath), 'uploads'),
  auth,
});

const stopWorker =
  env.CUSTOCK_WORKER === '0' ? () => {} : startWorker({ cfg: { db, jwtSecret, unsubSecret, publicWebUrl }, live, log: (l) => console.log(l) });

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`custock api on http://localhost:${info.port} (${dev ? 'dev' : 'production'}, auth ${authMode}, transport ${transport}, db ${dbPath})`);
});

const stop = () => {
  stopWorker();
  server.close();
  db.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
