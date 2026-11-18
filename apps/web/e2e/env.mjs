// starts and stops the throwaway environment: snapshot, build, api, web.

import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import cfg from './e2e.config.mjs';

const node = process.execPath;
const r = (...p) => join(cfg.repo, ...p);
const b = (...p) => join(cfg.build, ...p);

const SKIP = new Set(['node_modules', '.next', 'screenshots', 'e2e', 'tsconfig.tsbuildinfo', 'data']);
const keep = (src) => !src.split(/[\\/]/).some((part) => SKIP.has(part));

function link(target, path) {
  mkdirSync(join(path, '..'), { recursive: true });
  symlinkSync(target, path, 'junction');
}

// a copy of the code as it is right now: web, api and the shared packages
export function snapshot() {
  if (existsSync(cfg.build)) rmSync(cfg.build, { recursive: true, force: true, maxRetries: 3 });
  mkdirSync(cfg.build, { recursive: true });
  writeFileSync(b('.gitignore'), '*\n');
  cpSync(r('apps', 'web'), b('web'), { recursive: true, filter: keep });
  cpSync(r('apps', 'api'), b('api'), { recursive: true, filter: keep });
  for (const p of ['core', 'db', 'i18n', 'tokens']) cpSync(r('packages', p), b('pkgs', p), { recursive: true, filter: keep });
  mkdirSync(b('demo', 'assets', 'js'), { recursive: true });
  cpSync(r('demo', 'assets', 'js', 'images.js'), b('demo', 'assets', 'js', 'images.js'));
  for (const p of ['core', 'i18n', 'tokens']) link(b('pkgs', p), b('web', 'node_modules', '@custock', p));
  for (const p of ['core', 'db', 'i18n']) link(b('pkgs', p), b('api', 'node_modules', '@custock', p));
  link(b('pkgs', 'core'), b('pkgs', 'db', 'node_modules', '@custock', 'core'));
}

export function buildWeb() {
  const env = {
    ...process.env,
    CUSTOCK_BASE_PATH: cfg.basePath,
    CUSTOCK_API_URL: `http://127.0.0.1:${cfg.apiPort}`,
    CUSTOCK_REV: 'e2e',
    NEXT_TELEMETRY_DISABLED: '1',
    NODE_OPTIONS: '--max-old-space-size=4096',
    MSYS_NO_PATHCONV: '1',
  };
  const wasm = spawnSync(node, ['scripts/copy-wasm.mjs'], { cwd: b('web'), env, stdio: 'inherit' });
  if (wasm.status !== 0) throw new Error('copy-wasm failed');
  const res = spawnSync(node, [r('node_modules', 'next', 'dist', 'bin', 'next'), 'build'], { cwd: b('web'), env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  mkdirSync(cfg.results, { recursive: true });
  writeFileSync(join(cfg.results, 'build.log'), `${res.stdout ?? ''}\n${res.stderr ?? ''}`);
  if (res.status !== 0) throw new Error(`next build failed, see results/build.log\n${(res.stderr || res.stdout || '').slice(-3000)}`);
  // the standalone server needs its static files and public folder next to it, like the docker image
  const standalone = standaloneDir();
  cpSync(b('web', '.next', 'static'), join(standalone, '.next', 'static'), { recursive: true });
  cpSync(b('web', 'public'), join(standalone, 'public'), { recursive: true });
  return standalone;
}

export function standaloneDir() {
  return b('web', '.next', 'standalone', 'e2e-build', 'web');
}

export function builtStandalone() {
  const s = standaloneDir();
  return existsSync(join(s, 'server.js')) ? s : null;
}

const procs = [];
export const dbFile = join(tmpdir(), `custock-e2e.db`);
export const uploadDir = join(tmpdir(), `custock-e2e-uploads`);
export const apiLog = [];
export const webLog = [];

export function apiEnv(extra = {}) {
  const web = `http://localhost:${cfg.webPort}${cfg.basePath}`;
  return {
    ...process.env,
    CUSTOCK_DEV: '1',
    CUSTOCK_SEED: '1',
    CUSTOCK_DB: dbFile,
    CUSTOCK_UPLOAD_DIR: uploadDir,
    CUSTOCK_STORAGE: 'local',
    CUSTOCK_TRANSPORT: 'outbox',
    CUSTOCK_ALLOW_SENDING: 'no',
    PORT: String(cfg.apiPort),
    CUSTOCK_PUBLIC_WEB_URL: web,
    CUSTOCK_API_URL: `${web}/api`,
    CUSTOCK_CORS: `http://localhost:${cfg.webPort}`,
    CUSTOCK_TURNSTILE: 'off',
    CUSTOCK_REV: 'e2e',
    CUSTOCK_BUILT_AT: new Date().toISOString(),
    // never a real channel, whatever the shell has set
    CUSTOCK_SMTP_URL: '',
    CUSTOCK_MAIL_FROM: '',
    CUSTOCK_FCM_SERVICE_ACCOUNT: '',
    CUSTOCK_S3_BUCKET: '',
    CUSTOCK_S3_ACCESS_KEY_ID: '',
    CUSTOCK_S3_SECRET_ACCESS_KEY: '',
    ...extra,
  };
}

async function wait(url, ms = 90_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      if ((await fetch(url)).status < 500) return;
    } catch {}
    await new Promise((ok) => setTimeout(ok, 400));
  }
  throw new Error(`${url} did not answer`);
}

export async function startApi() {
  for (const f of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]) rmSync(f, { force: true });
  rmSync(uploadDir, { recursive: true, force: true });
  const p = spawn(node, ['--import', 'tsx', 'src/main.ts'], { cwd: b('api'), env: apiEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
  p.stdout.on('data', (d) => apiLog.push(String(d)));
  p.stderr.on('data', (d) => apiLog.push(String(d)));
  procs.push(p);
  await wait(`http://127.0.0.1:${cfg.apiPort}/health`);
}

export async function startWeb(standalone) {
  const p = spawn(node, ['server.js'], {
    cwd: standalone,
    env: { ...process.env, PORT: String(cfg.webPort), HOSTNAME: '127.0.0.1', NODE_ENV: 'production', CUSTOCK_API_URL: `http://127.0.0.1:${cfg.apiPort}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  p.stdout.on('data', (d) => webLog.push(String(d)));
  p.stderr.on('data', (d) => webLog.push(String(d)));
  procs.push(p);
  await wait(`http://127.0.0.1:${cfg.webPort}${cfg.basePath}`);
}

// the api's command line on the same throwaway database
export function cli(args, extraEnv = {}) {
  const res = spawnSync(node, ['--import', 'tsx', 'src/cli.ts', ...args], { cwd: b('api'), env: apiEnv(extraEnv), encoding: 'utf8' });
  return { code: res.status, out: `${res.stdout ?? ''}${res.stderr ?? ''}` };
}

export function stopAll() {
  for (const p of procs) {
    try { p.kill(); } catch {}
  }
}
