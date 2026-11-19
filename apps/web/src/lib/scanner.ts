'use client';

// barcode reading in the browser. the native BarcodeDetector where it exists and knows retail
// codes (chrome on android, safari on recent ios with the shape detection flag, chrome on mac),
// else zxing compiled to wasm, served from our own origin (scripts/copy-wasm.mjs).

import { basePath } from './api-client';

// boundingBox: where in the camera picture, in camera pixels (both readers give it)
export interface Detected { rawValue: string; format: string; boundingBox?: { x: number; y: number; width: number; height: number } }
export interface Detector { detect(source: HTMLVideoElement): Promise<Detected[]> }

// everything a shop meets: retail barcodes, carton codes (itf-14), labels (code 128, 39) and qr
const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'itf', 'code_128', 'code_39', 'qr_code', 'data_matrix'] as const;

type NativeCtor = { new (o?: { formats?: string[] }): Detector; getSupportedFormats(): Promise<string[]> };

let made: Promise<Detector> | null = null;

export function createDetector(): Promise<Detector> {
  made ??= (async () => {
    const Native = (window as unknown as { BarcodeDetector?: NativeCtor }).BarcodeDetector;
    if (Native) {
      try {
        const supported = await Native.getSupportedFormats();
        const formats = FORMATS.filter((f) => supported.includes(f));
        if (formats.includes('ean_13')) return new Native({ formats });
      } catch { /* fall through to wasm */ }
    }
    const mod = await import('barcode-detector/ponyfill');
    mod.prepareZXingModule({
      overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? `${basePath}/wasm/${path}` : prefix + path) },
    });
    const d = new mod.BarcodeDetector({ formats: [...FORMATS] });
    return { detect: (v: HTMLVideoElement) => d.detect(v) };
  })();
  made.catch(() => { made = null; });
  return made;
}

export const hasCamera = () => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

export type CameraPermission = 'granted' | 'denied' | 'prompt';

export async function cameraPermission(): Promise<CameraPermission> {
  try {
    const s = await navigator.permissions.query({ name: 'camera' as PermissionName });
    return s.state;
  } catch {
    return 'prompt'; // safari before 16 has no permissions query for the camera
  }
}

export async function openCamera(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
  });
}

export function torchSupported(stream: MediaStream | null): boolean {
  const track = stream?.getVideoTracks()[0];
  const caps = track?.getCapabilities?.() as (MediaTrackCapabilities & { torch?: boolean }) | undefined;
  return !!caps?.torch;
}

export async function setTorch(stream: MediaStream | null, on: boolean): Promise<void> {
  const track = stream?.getVideoTracks()[0];
  if (!track) return;
  await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] }).catch(() => {});
}

// a short buzz on android, nothing elsewhere (ios safari has no vibration api)
export function buzz(ms = 12) {
  try { navigator.vibrate?.(ms); } catch { /* not allowed */ }
}

// the format names the api knows, from the detector's names
export function symbology(format: string): string {
  return ({ ean_13: 'ean13', ean_8: 'ean8', upc_a: 'upc_a', upc_e: 'upc_e', itf: 'itf14', code_128: 'code128', code_39: 'code39', qr_code: 'qr', data_matrix: 'datamatrix' } as Record<string, string>)[format] ?? format;
}
