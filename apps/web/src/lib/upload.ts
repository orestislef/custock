'use client';

// photos are shrunk in the browser (longest side 1600 px, webp or jpeg) and sent straight to
// storage with a presigned url, see thinking/13-stack.md. in sample data mode they stay local.

import type { CustockApi, UploadPurpose } from '@custock/core';
import { apiMode, basePath } from './api-client';
import { reportError } from './report-error';

const MAX = 1600;

async function shrink(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const webp = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/webp', 0.82));
  if (webp && webp.type === 'image/webp') return webp;
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), 'image/jpeg', 0.82));
}

// the api hands out its own absolute url. the browser goes through this origin (see next.config)
function sameOrigin(url: string): string {
  return url.replace(/^https?:\/\/[^/]+\/v1\//, `${basePath}/api/v1/`).replace(/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/files\//, `${basePath}/files/`);
}

export async function uploadPhoto(api: CustockApi, orgId: string, file: File, purpose: UploadPurpose = 'product'): Promise<string> {
  const blob = await shrink(file);
  if (apiMode === 'fixtures') {
    return new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.readAsDataURL(blob); });
  }
  const mime = blob.type === 'image/webp' ? 'image/webp' : 'image/jpeg';
  const slot = await api.presignUpload(orgId, { purpose, mime, bytes: blob.size });
  await put(slot, blob, purpose);
  return slot.publicUrl;
}

// ---------------------------------------------------------------- squares: profile photos and logos

const SQUARE = 512;

// a profile photo fills the square (center crop). a logo fits inside it on a transparent
// background, so a wide wordmark is never cut. photos go as webp, logos as png (the home screen
// icon is drawn from it, and png keeps the transparency everywhere).
async function square(file: File, mode: 'cover' | 'contain'): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = SQUARE;
  canvas.height = SQUARE;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  const { width: w, height: h } = bitmap;
  if (mode === 'cover') {
    const side = Math.min(w, h);
    ctx.drawImage(bitmap, (w - side) / 2, (h - side) / 2, side, side, 0, 0, SQUARE, SQUARE);
  } else {
    const scale = Math.min(SQUARE / w, SQUARE / h);
    const dw = Math.round(w * scale);
    const dh = Math.round(h * scale);
    ctx.drawImage(bitmap, 0, 0, w, h, (SQUARE - dw) / 2, (SQUARE - dh) / 2, dw, dh);
  }
  bitmap.close?.();
  if (mode === 'contain') {
    return new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), 'image/png'));
  }
  const webp = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/webp', 0.86));
  if (webp && webp.type === 'image/webp') return webp;
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), 'image/jpeg', 0.86));
}

// the bytes to the bucket. an answer that is not 2xx and a failed request (no network, or a bucket
// that refuses the browser, as a CORS preflight does) end the same way: one error code the screens
// turn into "the photo could not be added", and a report for the super admin. the report names
// the purpose and the status only, never the signed address or its query string.
async function put(slot: { uploadUrl: string; method: string; headers: Record<string, string> }, blob: Blob, purpose: UploadPurpose) {
  let status = 0;
  try {
    const res = await fetch(sameOrigin(slot.uploadUrl), { method: slot.method, headers: slot.headers, body: blob });
    status = res.status;
    if (res.ok) return;
  } catch {
    status = 0;
  }
  const host = (() => { try { return new URL(slot.uploadUrl, window.location.href).host; } catch { return 'bucket'; } })();
  reportError({ source: 'error', error: new Error(`photo upload failed (${purpose}): ${status ? `HTTP ${status}` : 'no answer (network or CORS)'} from ${host}`) });
  throw Object.assign(new Error('upload'), { code: 'upload_failed' });
}

// the person's own profile photo. returns the file id for updateMe({ avatarFileId })
export async function uploadAvatar(api: CustockApi, file: File): Promise<{ fileId: string; url: string }> {
  const blob = await square(file, 'cover');
  if (apiMode === 'fixtures') return { fileId: 'local-avatar', url: URL.createObjectURL(blob) };
  const mime = blob.type === 'image/webp' ? 'image/webp' : 'image/jpeg';
  const slot = await api.presignAvatar({ mime, bytes: blob.size });
  await put(slot, blob, 'avatar');
  return { fileId: slot.fileId, url: slot.publicUrl };
}

// the business logo. returns the file id for updateOrgSettings({ logoFileId })
export async function uploadLogo(api: CustockApi, orgId: string, file: File): Promise<{ fileId: string; url: string }> {
  const blob = await square(file, 'contain');
  if (apiMode === 'fixtures') return { fileId: 'local-logo', url: URL.createObjectURL(blob) };
  const slot = await api.presignUpload(orgId, { purpose: 'logo', mime: 'image/png', bytes: blob.size });
  await put(slot, blob, 'logo');
  return { fileId: slot.fileId, url: slot.publicUrl };
}
