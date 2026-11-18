// runs the api and the web in one container. the web starts once the api answers, and when
// either one exits the other is stopped too, so docker restarts the pair.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';

// the web passes the visitor's address to the api with this key. one per boot is enough
process.env.CUSTOCK_INTERNAL_KEY ||= randomBytes(32).toString('hex');

const children = [];
let stopping = false;

function start(name, args, cwd, env) {
  const child = spawn(process.execPath, args, { cwd, env: { ...process.env, ...env }, stdio: 'inherit' });
  child.on('exit', (code, signal) => {
    if (!stopping) console.log(`${name} stopped (${signal ?? code}), stopping the container`);
    stop(code ?? 1);
  });
  children.push(child);
  return child;
}

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const c of children) if (c.exitCode === null) c.kill('SIGTERM');
  setTimeout(() => process.exit(code), 5000).unref();
  Promise.all(children.map((c) => (c.exitCode === null ? new Promise((r) => c.once('exit', r)) : null))).then(() => process.exit(code));
}

process.on('SIGTERM', () => stop(0));
process.on('SIGINT', () => stop(0));

start('api', ['--import', 'tsx', 'apps/api/src/main.ts'], '/app', { PORT: '8787' });

async function waitForApi() {
  for (let i = 0; i < 120 && !stopping; i++) {
    try {
      if ((await fetch('http://127.0.0.1:8787/health')).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
}

await waitForApi();
if (!stopping) {
  // the web talks to the api inside the container. CUSTOCK_API_URL in .env is the public address
  start('web', ['apps/web/server.js'], '/app/web', { PORT: '3000', HOSTNAME: '0.0.0.0', CUSTOCK_API_URL: 'http://127.0.0.1:8787' });
}

// nightly snapshot of the database into the data volume (VACUUM INTO, newest 30 kept). it guards
// against mistakes and bad updates, not against losing the disk: copy /data/snapshots off the
// server too, or set up litestream (see deploy/README.md)
const DAY = 24 * 60 * 60 * 1000;
const db = process.env.CUSTOCK_DB ?? '/data/custock.db';
const out = process.env.CUSTOCK_SNAPSHOT_DIR ?? '/data/snapshots';
let lastSnapshot = 0;
function snapshot() {
  if (stopping || Date.now() - lastSnapshot < DAY - 60_000) return;
  lastSnapshot = Date.now();
  const s = spawn(process.execPath, ['scripts/db-snapshot.mjs', '--db', db, '--out', out, '--keep', '30'], { cwd: '/app', stdio: 'inherit' });
  s.on('exit', (code) => {
    if (code === 0) return;
    console.log(`snapshot failed (${code}), next try in an hour`);
    lastSnapshot = 0;
  });
}
if (process.env.CUSTOCK_SNAPSHOTS !== 'off') {
  // the first one ten minutes after boot, then once a day
  setTimeout(snapshot, 10 * 60 * 1000).unref();
  setInterval(snapshot, 60 * 60 * 1000).unref();
}
