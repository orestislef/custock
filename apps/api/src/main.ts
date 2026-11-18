// starts the api on http://localhost:8787.
// dev features (dev codes, dev outbox endpoints, the bot check stand in, the dev secret, local
// uploads) only with CUSTOCK_DEV=1 or --dev (pnpm dev:api passes --dev).
// sending for real only with CUSTOCK_TRANSPORT=live, CUSTOCK_ALLOW_SENDING=yes and the settings of
// each channel (web push, FCM, SMTP). a channel without settings keeps its messages in the outbox.

import { serve } from '@hono/node-server';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRemoteJWKSet } from 'jose';
import { DEFAULT_DB_PATH, hashPassword, migrate, openDb, rebuildSearch, seed } from '@custock/db';
import { createApp } from './app';
import { createLiveSender, liveChannels, type LiveSender } from './lib/live';
import { newVapidKeys, vapidProblems } from './lib/webpush';
import { storageFromEnv } from './lib/storage';
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
let sending = { email: false, fcm: false, webpush: false };
const transport = env.CUSTOCK_TRANSPORT ?? 'outbox';
if (transport === 'live') {
  const { problems, channels, lines } = liveChannels(env, existsSync);
  if (problems.length) fail(`CUSTOCK_TRANSPORT=live refused:\n  ${problems.join('\n  ')}`);
  for (const l of lines) console.log(l);
  live = createLiveSender(channels);
  sending = { email: !!channels.smtp, fcm: !!channels.fcm, webpush: !!channels.vapid };
} else if (transport !== 'outbox') {
  fail(`unknown CUSTOCK_TRANSPORT ${transport} (outbox or live)`);
} else {
  console.log('transport outbox: nothing leaves the server, every email and push stays in the outbox table');
}

// the key browsers subscribe to web push with. a dev run makes a throwaway pair so the flow can
// be tried, nothing is sent in dev anyway.
let vapidPublicKey = env.CUSTOCK_VAPID_PUBLIC_KEY || undefined;
if (vapidPublicKey) {
  const pr = vapidProblems({ publicKey: vapidPublicKey, privateKey: env.CUSTOCK_VAPID_PRIVATE_KEY, subject: env.CUSTOCK_VAPID_SUBJECT });
  if (pr.length) fail(pr.join('\n'));
} else if (dev) {
  vapidPublicKey = newVapidKeys().publicKey;
}

// public signups without the bot check, on purpose
const turnstile = env.CUSTOCK_TURNSTILE ?? 'on';
if (turnstile !== 'on' && turnstile !== 'off') fail('CUSTOCK_TURNSTILE is on or off');
const turnstileOff = turnstile === 'off' && !dev;
if (turnstileOff) {
  console.warn('!!! CUSTOCK_TURNSTILE=off: the join pages take signups without a bot check. rate limits still apply.');
} else if (!dev && !env.CUSTOCK_TURNSTILE_SECRET) {
  console.warn('no CUSTOCK_TURNSTILE_SECRET: the join pages refuse signups (set it, or CUSTOCK_TURNSTILE=off)');
}

// shared with the web server next to us, so it can pass on the real client address
const internalKey = env.CUSTOCK_INTERNAL_KEY || undefined;
if (internalKey && internalKey.length < 32) fail('CUSTOCK_INTERNAL_KEY must be at least 32 characters');

const dbPath = env.CUSTOCK_DB ?? DEFAULT_DB_PATH;
const uploadDir = env.CUSTOCK_UPLOAD_DIR ?? join(dirname(dbPath), 'uploads');

// where photos go: an S3 compatible bucket (R2 or AWS), local files (dev, or on purpose), or nowhere
const storage = storageFromEnv(env, dev, uploadDir);
if (storage.problems.length) fail(`photo storage refused:\n  ${storage.problems.join('\n  ')}`);
console.log(storage.line);
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
  uploadDir,
  storage: storage.setting,
  auth,
  sending,
  turnstileOff,
  vapidPublicKey,
  internalKey,
  ownDomains: (env.CUSTOCK_OWN_DOMAINS ?? '').split(',').map((x) => x.trim()).filter(Boolean),
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
