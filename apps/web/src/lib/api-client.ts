'use client';

// the api for the browser. real client through the /api rewrite when the dev server was started
// with CUSTOCK_API_URL, fixtures in memory otherwise.

import { createApiClient, type CustockApi } from '@custock/core';
import { createFixtureApi } from './fixtures';

export const apiMode: 'real' | 'fixtures' = process.env.NEXT_PUBLIC_API_MODE === 'real' ? 'real' : 'fixtures';
// the path the app is served under ('' or for example '/custock'), fixed at build time
export const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

const TOKENS_KEY = 'custock.tokens';

export interface StoredTokens { accessToken: string; refreshToken: string; expiresAt: number }

export function loadTokens(): StoredTokens | null {
  try {
    const raw = localStorage.getItem(TOKENS_KEY);
    return raw ? (JSON.parse(raw) as StoredTokens) : null;
  } catch {
    return null;
  }
}

export function saveTokens(tokens: StoredTokens | null) {
  if (tokens) localStorage.setItem(TOKENS_KEY, JSON.stringify(tokens));
  else localStorage.removeItem(TOKENS_KEY);
}

let fixture: CustockApi | null = null;

export function createBrowserApi(opts: {
  getLocale: () => string;
  getPermsVersion?: (orgId: string) => number | null;
  onUnauthorized?: () => void;
  onPermsStale?: (orgId: string) => void;
}): CustockApi {
  if (apiMode === 'real') {
    return createApiClient({
      baseUrl: `${basePath}/api`,
      getAccessToken: () => loadTokens()?.accessToken,
      getLocale: opts.getLocale,
      getPermsVersion: opts.getPermsVersion,
      onUnauthorized: opts.onUnauthorized,
      onPermsStale: opts.onPermsStale,
    });
  }
  if (!fixture) {
    const token = loadTokens()?.accessToken;
    fixture = createFixtureApi(token?.startsWith('dev.') ? token.slice(4) : null);
  }
  return fixture;
}
