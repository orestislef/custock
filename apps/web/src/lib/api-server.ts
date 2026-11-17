// the api for server components. real client when CUSTOCK_API_URL answers, fixtures otherwise.

import { createApiClient, type CustockApi } from '@custock/core';
import { createFixtureApi } from './fixtures';

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
  if (url && (await reachable(url))) {
    return { api: createApiClient({ baseUrl: url, getLocale: () => locale ?? null }), mode: 'real' };
  }
  fixture ??= createFixtureApi();
  return { api: fixture, mode: 'fixtures' };
}

export const isDev = process.env.NODE_ENV !== 'production' || process.env.CUSTOCK_SHOW_DEV === '1';
