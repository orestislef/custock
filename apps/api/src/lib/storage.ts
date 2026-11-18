// where photos live. s3 is one S3 compatible driver for Cloudflare R2 and AWS S3: the browser PUTs
// the file straight to the bucket with a presigned url (SigV4, signed here with node crypto, no sdk)
// and everyone reads it from the public bucket address. local keeps files next to the database and
// is for dev and tests, or a server where CUSTOCK_STORAGE=local was chosen on purpose. off refuses
// uploads, the default on a server with no bucket settings.

import { createHash, createHmac } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { UploadPurpose } from '@custock/core';

export interface S3Config {
  bucket: string;
  // auto for R2, for example eu-central-1 for AWS
  region: string;
  // R2: https://<account>.r2.cloudflarestorage.com. empty for AWS
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  // public read base: the r2.dev address, a custom domain, or the AWS bucket address
  publicUrl: string;
}

export type StorageSetting = { kind: 'local' } | { kind: 's3'; s3: S3Config } | { kind: 'off' };

const FOLDER: Record<UploadPurpose, string> = { product: 'products', post: 'posts', logo: 'logo', shop: 'shops', avatar: 'avatar', category: 'categories' };

// orgs/<org>/products/<uuid>.webp, as in thinking/13. a profile photo belongs to the person, not
// to a business: users/<user>/avatar/<uuid>.webp, with the user id where the org id would be
export function objectKey(ownerId: string, purpose: UploadPurpose, fileId: string, ext: string): string {
  if (purpose === 'avatar') return `users/${ownerId}/avatar/${fileId}.${ext}`;
  return `orgs/${ownerId}/${FOLDER[purpose]}/${fileId}.${ext}`;
}

export const OBJECT_KEY = /^(orgs\/[0-9a-f-]{36}\/(products|posts|logo|logos|shops|categories)|users\/[0-9a-f-]{36}\/avatar)\/[0-9a-f-]{36}\.(jpg|png|webp)$/;

// ---------------------------------------------------------------- SigV4 query signing

// RFC 3986 encoding as AWS wants it: everything but A-Z a-z 0-9 - _ . ~
export function awsEncode(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

const sha256hex = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const hmac = (key: string | Buffer, data: string) => createHmac('sha256', key).update(data, 'utf8').digest();

export interface PresignArgs {
  method: 'GET' | 'PUT' | 'DELETE' | 'HEAD';
  host: string;
  // the object path, not encoded, starting with /
  path: string;
  region: string;
  service?: string;
  accessKeyId: string;
  secretAccessKey: string;
  date: Date;
  expiresIn: number;
  // more headers the request must carry exactly, besides host
  headers?: Record<string, string>;
}

// a presigned url (AWS Signature Version 4, query string auth, unsigned payload)
export function presignUrl(a: PresignArgs): string {
  const service = a.service ?? 's3';
  const amzDate = a.date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const day = amzDate.slice(0, 8);
  const scope = `${day}/${a.region}/${service}/aws4_request`;
  const headers: Record<string, string> = { host: a.host };
  for (const [k, v] of Object.entries(a.headers ?? {})) headers[k.toLowerCase()] = String(v).trim().replace(/\s+/g, ' ');
  const names = Object.keys(headers).sort();
  const signedHeaders = names.join(';');
  const query = [
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', `${a.accessKeyId}/${scope}`],
    ['X-Amz-Date', amzDate],
    ['X-Amz-Expires', String(a.expiresIn)],
    ['X-Amz-SignedHeaders', signedHeaders],
  ]
    .map(([k, v]) => [awsEncode(k!), awsEncode(v!)] as const)
    .sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const path = a.path.split('/').map(awsEncode).join('/');
  const canonical = [a.method, path, query, names.map((n) => `${n}:${headers[n]}\n`).join(''), signedHeaders, 'UNSIGNED-PAYLOAD'].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonical)].join('\n');
  const key = hmac(hmac(hmac(hmac(`AWS4${a.secretAccessKey}`, day), a.region), service), 'aws4_request');
  const signature = createHmac('sha256', key).update(toSign, 'utf8').digest('hex');
  return `https://${a.host}${path}?${query}&X-Amz-Signature=${signature}`;
}

// R2 and custom endpoints use path style (<endpoint>/<bucket>/<key>), AWS the bucket host
export function objectTarget(s3: S3Config, key: string): { host: string; path: string; scheme: string } {
  if (s3.endpoint) {
    const u = new URL(s3.endpoint);
    return { host: u.host, path: `${u.pathname.replace(/\/$/, '')}/${s3.bucket}/${key}`, scheme: u.protocol };
  }
  return { host: `${s3.bucket}.s3.${s3.region}.amazonaws.com`, path: `/${key}`, scheme: 'https:' };
}

function signed(s3: S3Config, key: string, method: PresignArgs['method'], date: Date, expiresIn: number, headers?: Record<string, string>): string {
  const t = objectTarget(s3, key);
  const url = presignUrl({ method, host: t.host, path: t.path, region: s3.region, accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey, date, expiresIn, headers });
  // a local S3 lookalike over plain http in dev
  return t.scheme === 'http:' ? url.replace(/^https:/, 'http:') : url;
}

// ---------------------------------------------------------------- the drivers

export interface PresignedUpload {
  storageKey: string;
  uploadUrl: string;
  headers: Record<string, string>;
  publicUrl: string;
}

export interface PhotoStore {
  kind: 'local' | 's3' | 'off';
  // the browser sends these headers exactly, the bucket checks them
  presign(input: { orgId: string; fileId: string; purpose: UploadPurpose; mime: string; ext: string; bytes: number; now: number; expiresIn: number }): PresignedUpload | null;
  // best effort, never throws
  remove(storageKey: string): Promise<void>;
}

export const OBJECT_CACHE = 'public, max-age=31536000, immutable';

// onError hears about deletes that failed (lib/errors.ts records them), the call itself never throws
export function s3Store(s3: S3Config, fetchImpl: typeof fetch = (...a) => fetch(...a), onError?: (err: unknown, storageKey: string) => void): PhotoStore {
  const base = s3.publicUrl.replace(/\/$/, '');
  return {
    kind: 's3',
    presign(i) {
      const storageKey = objectKey(i.orgId, i.purpose, i.fileId, i.ext);
      // content type, length and cache header are part of the signature, the bucket refuses anything else
      const headers = { 'Content-Type': i.mime, 'Cache-Control': OBJECT_CACHE };
      const uploadUrl = signed(s3, storageKey, 'PUT', new Date(i.now), Math.round(i.expiresIn / 1000), { ...headers, 'Content-Length': String(i.bytes) });
      return { storageKey, uploadUrl, headers, publicUrl: `${base}/${storageKey}` };
    },
    async remove(storageKey) {
      if (!OBJECT_KEY.test(storageKey)) return;
      try {
        const res = await fetchImpl(signed(s3, storageKey, 'DELETE', new Date(), 60), { method: 'DELETE', signal: AbortSignal.timeout(10_000) });
        // 404 means it is already gone, which is what we wanted
        if (res && !res.ok && res.status !== 404) onError?.(new Error(`storage delete answered HTTP ${res.status}`), storageKey);
      } catch (err) {
        // a leftover object costs a few kilobytes, a failed request must not
        onError?.(err, storageKey);
      }
    },
  };
}

export function localStore(dir: string, sign: (i: { orgId: string; fileId: string; purpose: UploadPurpose; mime: string; bytes: number; now: number; expiresIn: number }) => string, apiBase: string): PhotoStore {
  return {
    kind: 'local',
    presign(i) {
      const storageKey = `uploads/${i.orgId}/${i.fileId}.${i.ext}`;
      return {
        storageKey,
        uploadUrl: `${apiBase}/v1/uploads/${sign(i)}`,
        headers: { 'Content-Type': i.mime },
        publicUrl: `${apiBase}/files/${storageKey}`,
      };
    },
    async remove(storageKey) {
      const m = storageKey.match(/^uploads\/([0-9a-f-]{36})\/([0-9a-f-]{36}\.(jpg|png|webp))$/);
      if (!m) return;
      await unlink(join(dir, m[1]!, m[2]!)).catch(() => {});
    },
  };
}

export const offStore: PhotoStore = { kind: 'off', presign: () => null, remove: async () => {} };

// ---------------------------------------------------------------- settings

const S3_VARS = ['CUSTOCK_S3_BUCKET', 'CUSTOCK_S3_REGION', 'CUSTOCK_S3_ENDPOINT', 'CUSTOCK_S3_ACCESS_KEY_ID', 'CUSTOCK_S3_SECRET_ACCESS_KEY', 'CUSTOCK_S3_PUBLIC_URL'] as const;

// which storage, from the environment. a half filled s3 setting is a problem, the server stops.
export function storageFromEnv(env: NodeJS.ProcessEnv, dev: boolean, uploadDir: string): { setting: StorageSetting; problems: string[]; line: string } {
  const kind = env.CUSTOCK_STORAGE || undefined;
  const anyS3 = S3_VARS.some((k) => env[k]);
  if (kind && kind !== 'local' && kind !== 's3') return { setting: { kind: 'off' }, problems: ['CUSTOCK_STORAGE is local or s3'], line: '' };
  if (kind === 'local') return { setting: { kind: 'local' }, problems: [], line: `storage: local files in ${uploadDir}${dev ? '' : ' (chosen with CUSTOCK_STORAGE=local)'}` };
  if (kind === 's3' || anyS3) {
    const problems: string[] = [];
    const bucket = env.CUSTOCK_S3_BUCKET ?? '';
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) problems.push('CUSTOCK_S3_BUCKET must be a bucket name');
    const region = env.CUSTOCK_S3_REGION ?? '';
    if (!/^[a-z0-9-]+$/.test(region)) problems.push('CUSTOCK_S3_REGION must be set (auto for R2, for example eu-central-1 for AWS)');
    if (!env.CUSTOCK_S3_ACCESS_KEY_ID) problems.push('CUSTOCK_S3_ACCESS_KEY_ID must be set');
    if (!env.CUSTOCK_S3_SECRET_ACCESS_KEY) problems.push('CUSTOCK_S3_SECRET_ACCESS_KEY must be set');
    const okUrl = (v: string | undefined) => {
      try {
        const u = new URL(v ?? '');
        return u.protocol === 'https:' || (dev && u.protocol === 'http:');
      } catch {
        return false;
      }
    };
    if (!okUrl(env.CUSTOCK_S3_PUBLIC_URL)) problems.push('CUSTOCK_S3_PUBLIC_URL must be the https address photos are read from');
    if (env.CUSTOCK_S3_ENDPOINT && !okUrl(env.CUSTOCK_S3_ENDPOINT)) problems.push('CUSTOCK_S3_ENDPOINT must be an https url (R2: https://<account>.r2.cloudflarestorage.com)');
    if (problems.length) return { setting: { kind: 'off' }, problems, line: '' };
    const s3: S3Config = {
      bucket, region, endpoint: env.CUSTOCK_S3_ENDPOINT || undefined, accessKeyId: env.CUSTOCK_S3_ACCESS_KEY_ID!, secretAccessKey: env.CUSTOCK_S3_SECRET_ACCESS_KEY!,
      publicUrl: env.CUSTOCK_S3_PUBLIC_URL!.replace(/\/$/, ''),
    };
    const where = s3.endpoint ? new URL(s3.endpoint).host : `aws ${region}`;
    return { setting: { kind: 's3', s3 }, problems: [], line: `storage: s3 bucket ${bucket} at ${where}, photos read from ${s3.publicUrl}` };
  }
  if (dev) return { setting: { kind: 'local' }, problems: [], line: `storage: local files in ${uploadDir} (dev)` };
  return { setting: { kind: 'off' }, problems: [], line: 'storage: off, photo uploads are refused (set CUSTOCK_S3_*, or CUSTOCK_STORAGE=local on purpose)' };
}
