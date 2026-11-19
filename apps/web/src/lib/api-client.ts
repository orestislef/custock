'use client';

// the api for the browser. real client through the /api rewrite when the dev server was started
// with CUSTOCK_API_URL, fixtures in memory otherwise.

import { createApiClient, type CustockApi, type MeContext } from '@custock/core';
import { reportError } from './report-error';

// a production build always talks to the real api, sample data exists only while developing
export const apiMode: 'real' | 'fixtures' = process.env.NODE_ENV === 'production' || process.env.NEXT_PUBLIC_API_MODE === 'real' ? 'real' : 'fixtures';
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

// a random id this browser keeps for itself, also after signing out. every sign in sends it, so a
// new sign in ends the session this browser had before instead of leaving it counted as a device
const DEVICE_KEY = 'custock.device';
export function deviceId(): string | null {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
      id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return null; // storage off: the sign in still works, it just cannot replace an older one
  }
}

// the front door reads who this is to choose where to go. the admin it opens a moment later takes
// that answer instead of asking again: once, within 10 seconds, for the same session
let handedMe: { me: MeContext; session: string; at: number } | null = null;
export function handOffMe(me: MeContext) {
  const tk = loadTokens();
  handedMe = tk ? { me, session: tk.refreshToken, at: Date.now() } : null;
}
export function takeHandedMe(): MeContext | null {
  const h = handedMe;
  handedMe = null;
  return h && loadTokens()?.refreshToken === h.session && Date.now() - h.at < 10_000 ? h.me : null;
}

// access tokens live 15 minutes. before one runs out it is swapped for a new pair with the
// refresh token, once at a time across tabs (a refresh token used twice ends the session).
let refreshing: Promise<StoredTokens | null> | null = null;

async function refreshNow(): Promise<StoredTokens | null> {
  const run = async () => {
    const tk = loadTokens();
    if (!tk) return null;
    if (tk.expiresAt - Date.now() > 60_000) return tk; // another tab already did it
    try {
      const res = await fetch(`${basePath}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ refreshToken: tk.refreshToken }),
      });
      if (res.status === 401 || res.status === 403) { saveTokens(null); return null; }
      if (!res.ok) return tk;
      const next = (await res.json()) as StoredTokens;
      saveTokens(next);
      return next;
    } catch {
      return tk; // no signal: keep the old pair, the request itself will say it is offline
    }
  };
  const locks = typeof navigator !== 'undefined' ? (navigator as { locks?: { request: (name: string, cb: () => Promise<StoredTokens | null>) => Promise<StoredTokens | null> } }).locks : undefined;
  return locks ? locks.request('custock-refresh', run) : run();
}

async function accessToken(): Promise<string | undefined> {
  const tk = loadTokens();
  if (!tk) return undefined;
  if (tk.expiresAt - Date.now() > 60_000) return tk.accessToken;
  refreshing ??= refreshNow().finally(() => { refreshing = null; });
  return (await refreshing)?.accessToken;
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
      getAccessToken: accessToken,
      getLocale: opts.getLocale,
      getPermsVersion: opts.getPermsVersion,
      onUnauthorized: opts.onUnauthorized,
      onPermsStale: opts.onPermsStale,
      getDeviceId: deviceId,
      // a 5xx is ours to fix: the super admin sees it on the Errors screen
      onServerError: (e) => reportError({ source: 'api', method: e.method, apiPath: e.path, status: e.status }),
    });
  }
  if (process.env.NODE_ENV === 'production') throw new Error('no sample data in a production build');
  if (!fixture) {
    const token = loadTokens()?.accessToken;
    fixture = lazyFixtureApi(token?.startsWith('dev.') ? token.slice(4) : null);
  }
  return fixture;
}

// the sample data loads on first use, so it is never part of a production bundle
function lazyFixtureApi(initialUser: string | null): CustockApi {
  let loading: Promise<CustockApi> | null = null;
  // the condition is fixed at build time, so a production bundle does not even contain the chunk
  const load = () => (loading ??= process.env.NODE_ENV === 'production'
    ? Promise.reject(new Error('no sample data in a production build'))
    : import('./fixtures').then((m) => m.createFixtureApi(initialUser)));
  return new Proxy({} as CustockApi, {
    get: (_target, prop) => (typeof prop === 'symbol' || prop === 'then'
      ? undefined
      : (...args: unknown[]) => load().then((api) => (api[prop as keyof CustockApi] as (...a: unknown[]) => unknown)(...args))),
  });
}
