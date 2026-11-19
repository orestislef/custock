// the api for server components. real client when CUSTOCK_API_URL answers, fixtures otherwise.

import { createApiClient, type CustockApi } from '@custock/core';
import { headers } from 'next/headers';

let fixture: CustockApi | null = null;
let probe: Promise<boolean> | null = null;
let probedAt = 0;

async function reachable(url: string): Promise<boolean> {
  // re-check every 30 s so starting the api later is picked up
  if (probe && Date.now() - probedAt < 30_000) return probe;
  probedAt = Date.now();
  probe = fetch(`${url}/health`, { signal: AbortSignal.timeout(800), cache: 'no-store' })
    .then((r) => r.ok)
    .catch(() => false);
  return probe;
}

export async function serverApi(locale?: string): Promise<{ api: CustockApi; mode: 'real' | 'fixtures' }> {
  const url = process.env.CUSTOCK_API_URL?.replace(/\/$/, '');
  // the public demo is built from the sample data, there is no api
  if (process.env.NEXT_PUBLIC_DEMO === '1') {
    fixture ??= (await import('./fixtures')).createFixtureApi();
    return { api: fixture, mode: 'fixtures' };
  }
  // in production the api is always real. sample data is only a fallback while developing
  if (process.env.NODE_ENV === 'production') {
    return { api: createApiClient({ baseUrl: url ?? 'http://127.0.0.1:8787', getLocale: () => locale ?? null, headers: forwarded }), mode: 'real' };
  }
  if (url && (await reachable(url))) {
    return { api: createApiClient({ baseUrl: url, getLocale: () => locale ?? null, headers: forwarded }), mode: 'real' };
  }
  fixture ??= (await import('./fixtures')).createFixtureApi();
  return { api: fixture, mode: 'fixtures' };
}

// the visitor's address for the api's rate limits and consent records. the api only believes it
// with the shared internal key (CUSTOCK_INTERNAL_KEY, set for both processes by deploy/start.mjs).
// the reverse proxy appends the real address last.
export async function forwarded(): Promise<Record<string, string> | undefined> {
  const key = process.env.CUSTOCK_INTERNAL_KEY;
  if (!key) return undefined;
  try {
    const ip = (await headers()).get('x-forwarded-for')?.split(',').map((x) => x.trim()).filter(Boolean).at(-1);
    return ip ? { 'X-Custock-Internal': key, 'X-Custock-Client-Ip': ip } : undefined;
  } catch {
    return undefined; // outside a request, for example at build time
  }
}

export const isDev = process.env.NODE_ENV !== 'production' || process.env.CUSTOCK_SHOW_DEV === '1';
