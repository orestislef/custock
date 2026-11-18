// photo uploads. presign hands out a signed, short lived upload slot, the browser sends the file
// there. s3 (R2 or AWS): a presigned PUT straight to the bucket, the api never carries the bytes.
// local (dev, tests, or CUSTOCK_STORAGE=local on purpose): the api stores the file under
// CUSTOCK_UPLOAD_DIR and serves it at /files/uploads/<org>/<file>. off: uploads are refused.
// the response shape is the same for all of them.

import type { Hono } from 'hono';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { PresignInput, uuidv7, type PresignResult, type UploadPurpose } from '@custock/core';
import { DEFAULT_DB_PATH } from '@custock/db';
import type { AppEnv, Config } from '../types';
import { cfgOf, has, need, nowOf, orgOf } from '../lib/context';
import { ApiProblem, forbidden, notFound } from '../lib/problem';
import { localStore, offStore, s3Store, type PhotoStore } from '../lib/storage';
import { platform } from '../lib/tenant';

const TTL = 10 * 60_000;
export const MAX_UPLOAD_BYTES = 5_000_000;
const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MIME: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

const PERM: Record<UploadPurpose, string> = {
  product: 'products.edit',
  post: 'posts.create',
  logo: 'org.settings.manage',
  shop: 'shop.settings.manage',
};

export function uploadDir(cfg: Config): string {
  return cfg.uploadDir ?? join(dirname(DEFAULT_DB_PATH), 'uploads');
}

const apiBase = (cfg: Config) => (cfg.apiPublicUrl ?? 'http://localhost:8787').replace(/\/$/, '');

function key(cfg: Config): string {
  return createHmac('sha256', cfg.jwtSecret).update('custock uploads').digest('base64url');
}

interface Slot {
  f: string; // file id
  o: string; // org id
  m: string; // mime
  b: number; // declared bytes
  p: UploadPurpose;
  u: string; // user id
  e: number; // expires at
}

function sign(cfg: Config, slot: Slot): string {
  const payload = Buffer.from(JSON.stringify(slot)).toString('base64url');
  return `${payload}.${createHmac('sha256', key(cfg)).update(payload).digest('base64url')}`;
}

function read(cfg: Config, token: string): Slot | null {
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const want = createHmac('sha256', key(cfg)).update(payload).digest('base64url');
  if (want.length !== sig.length || !timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return null;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Slot;
  } catch {
    return null;
  }
}

// the file must really be what it says it is
function looksLike(mime: string, b: Buffer): boolean {
  if (mime === 'image/jpeg') return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (mime === 'image/png') return b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mime === 'image/webp') return b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP';
  return false;
}

const stores = new WeakMap<Config, PhotoStore>();

// the store for this config: the one handed in (tests), s3, off, or local by default
export function photoStoreOf(cfg: Config): PhotoStore {
  if (cfg.photoStore) return cfg.photoStore;
  let store = stores.get(cfg);
  if (!store) {
    const setting = cfg.storage ?? { kind: 'local' };
    store = setting.kind === 's3'
      ? s3Store(setting.s3)
      : setting.kind === 'off'
        ? offStore
        : localStore(uploadDir(cfg), (i) => sign(cfg, { f: i.fileId, o: i.orgId, m: i.mime, b: i.bytes, p: i.purpose, u: '', e: i.now + i.expiresIn }), apiBase(cfg));
    stores.set(cfg, store);
  }
  return store;
}

export function uploadRoutes(app: Hono<AppEnv>) {
  app.post('/v1/orgs/:org/uploads/presign', async (c) => {
    const input = PresignInput.parse(await c.req.json());
    const perm = PERM[input.purpose];
    if (!has(c, perm)) need(c, perm);
    const cfg = cfgOf(c);
    const store = photoStoreOf(cfg);
    if (store.kind === 'off') throw new ApiProblem(501 as 500, 'internal', 'photo storage is not set up on this server');
    const now = nowOf(c);
    const { org } = orgOf(c);
    const user = c.get('user').id;
    const fileId = uuidv7(now);
    const ext = EXT[input.mime]!;
    let slot: ReturnType<PhotoStore['presign']>;
    if (store.kind === 'local' && !cfg.photoStore) {
      // the local slot carries the uploader, the file row is written when the bytes arrive
      const token = sign(cfg, { f: fileId, o: org.id, m: input.mime, b: input.bytes, p: input.purpose, u: user, e: now + TTL });
      const base = apiBase(cfg);
      slot = { storageKey: `uploads/${org.id}/${fileId}.${ext}`, uploadUrl: `${base}/v1/uploads/${token}`, headers: { 'Content-Type': input.mime }, publicUrl: `${base}/files/uploads/${org.id}/${fileId}.${ext}` };
    } else {
      slot = store.presign({ orgId: org.id, fileId, purpose: input.purpose, mime: input.mime, ext, bytes: input.bytes, now, expiresIn: TTL });
      if (!slot) throw new ApiProblem(501 as 500, 'internal', 'photo storage is not set up on this server');
      // the browser talks to the bucket directly, so the file row is written now
      platform(cfg.db).run(
        `INSERT INTO files (id, org_id, storage_key, purpose, is_public, mime, bytes, created_by, created_at)
         VALUES (@id, @org, @key, @purpose, 1, @mime, @bytes, @u, @now)`,
        { id: fileId, org: org.id, key: slot.storageKey, purpose: input.purpose, mime: input.mime, bytes: input.bytes, u: user, now },
      );
    }
    const body: PresignResult = { fileId, uploadUrl: slot.uploadUrl, method: 'PUT', headers: slot.headers, publicUrl: slot.publicUrl, expiresAt: now + TTL };
    return c.json(body, 201);
  });

  // the signed slot is the permission. size, type and the bytes themselves are checked.
  app.put('/v1/uploads/:token', async (c) => {
    const cfg = cfgOf(c);
    if (photoStoreOf(cfg).kind !== 'local') throw notFound();
    const slot = read(cfg, c.req.param('token'));
    const now = nowOf(c);
    if (!slot || slot.e < now || !slot.u) throw forbidden('upload slot expired or invalid');
    if ((c.req.header('Content-Type') ?? '').split(';')[0]!.trim() !== slot.m) throw new ApiProblem(415 as 400, 'validation', 'content type does not match the slot');
    const declared = Number(c.req.header('Content-Length') ?? '0');
    if (declared > slot.b || declared > MAX_UPLOAD_BYTES) throw new ApiProblem(413 as 400, 'validation', 'file too large');
    const buf = Buffer.from(await c.req.arrayBuffer());
    if (!buf.length || buf.length > slot.b || buf.length > MAX_UPLOAD_BYTES) throw new ApiProblem(413 as 400, 'validation', 'file too large');
    if (!looksLike(slot.m, buf)) throw new ApiProblem(415 as 400, 'validation', 'not an image of that type');
    const name = `${slot.f}.${EXT[slot.m]}`;
    const storageKey = `uploads/${slot.o}/${name}`;
    const db = platform(cfg.db);
    if (db.get('SELECT 1 FROM files WHERE id = @id', { id: slot.f })) throw new ApiProblem(409, 'conflict', 'already uploaded');
    const dir = join(uploadDir(cfg), slot.o);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, name), buf);
    db.run(
      `INSERT INTO files (id, org_id, storage_key, purpose, is_public, mime, bytes, created_by, created_at)
       VALUES (@id, @org, @key, @purpose, 1, @mime, @bytes, @u, @now)`,
      { id: slot.f, org: slot.o, key: storageKey, purpose: slot.p, mime: slot.m, bytes: buf.length, u: slot.u, now },
    );
    return c.body(null, 204);
  });

  app.get('/files/uploads/:org/:name', (c) => {
    if (photoStoreOf(cfgOf(c)).kind !== 'local') throw notFound();
    const org = c.req.param('org');
    const name = c.req.param('name');
    const m = name.match(/^[0-9a-f-]{36}\.(jpg|png|webp)$/);
    if (!/^[0-9a-f-]{36}$/.test(org) || !m) throw notFound();
    const path = join(uploadDir(cfgOf(c)), org, name);
    if (!existsSync(path)) throw notFound();
    c.header('Content-Type', MIME[m[1]!]!);
    c.header('Cache-Control', 'public, max-age=31536000, immutable');
    c.header('X-Content-Type-Options', 'nosniff');
    return c.body(readFileSync(path));
  });
}
