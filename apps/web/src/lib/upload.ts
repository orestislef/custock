'use client';

// photos are shrunk in the browser (longest side 1600 px, webp or jpeg) and sent straight to
// storage with a presigned url, see thinking/13-stack.md. in sample data mode they stay local.

import type { CustockApi, UploadPurpose } from '@custock/core';
import { apiMode, basePath } from './api-client';

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
  const res = await fetch(sameOrigin(slot.uploadUrl), { method: slot.method, headers: slot.headers, body: blob });
  if (!res.ok) throw Object.assign(new Error('upload'), { code: 'internal' });
  return slot.publicUrl;
}
