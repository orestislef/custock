'use client';

// a browser reports its own errors to the api (/v1/client-errors), for the super admin's Errors
// screen. only what helps fixing: the message, a short stack, the page without its query, the
// browser and system family and the build. never the user agent, never anything typed or stored.
// quiet by design: the same error once a minute, at most 20 a page visit, never blocking.

import type { CLIENT_BROWSERS, CLIENT_OSES, ClientErrorInput } from '@custock/core';
import { isStaleChunk, reloadForNewVersion } from './new-version';

type Browser = (typeof CLIENT_BROWSERS)[number];
type Os = (typeof CLIENT_OSES)[number];

// the path the app is served under, fixed at build time (same as api-client.ts)
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const BUILD = (process.env.NEXT_PUBLIC_BUILD_REV ?? '').replace(/[^A-Za-z0-9._-]/g, '').slice(0, 64);
const MAX_PER_PAGE = 20;
const SAME_AGAIN_MS = 60_000;

let sent = 0;
const recent = new Map<string, number>();

export function browserFamily(ua: string): Browser {
  if (/SamsungBrowser/i.test(ua)) return 'samsung';
  if (/Edg\//i.test(ua)) return 'edge';
  if (/OPR\/|Opera/i.test(ua)) return 'opera';
  if (/Firefox\/|FxiOS/i.test(ua)) return 'firefox';
  if (/Chrome\/|CriOS/i.test(ua)) return 'chrome';
  if (/Safari\//i.test(ua)) return 'safari';
  return 'other';
}

export function osFamily(ua: string): Os {
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  if (/CrOS/i.test(ua)) return 'chromeos';
  if (/Windows/i.test(ua)) return 'windows';
  if (/Mac OS X|Macintosh/i.test(ua)) return 'macos';
  if (/Linux/i.test(ua)) return 'linux';
  return 'other';
}

// the page as a pattern of itself, without query and hash
function pagePath(): string {
  const p = typeof location === 'undefined' ? '/' : location.pathname;
  const rel = basePath && p.startsWith(basePath) ? p.slice(basePath.length) || '/' : p;
  return rel.replace(/[^\x21-\x7e]/g, '').slice(0, 300) || '/';
}

// errors that are not ours: extensions, cross origin scripts, a known harmless browser warning
function notOurs(message: string, stack?: string): boolean {
  if (/^Script error\.?$/i.test(message)) return true;
  if (/ResizeObserver loop/i.test(message)) return true;
  if (/(chrome|moz|safari)-extension:\/\//i.test(`${message} ${stack ?? ''}`)) return true;
  return false;
}

type Report =
  | { source: 'error' | 'rejection' | 'boundary'; error: unknown }
  | { source: 'api'; method: string; apiPath: string; status: number };

export function reportError(r: Report) {
  try {
    if (typeof window === 'undefined' || sent >= MAX_PER_PAGE) return;
    const ua = navigator.userAgent;
    const base = { path: pagePath(), browser: browserFamily(ua), os: osFamily(ua), ...(BUILD ? { build: BUILD } : {}) };
    let body: ClientErrorInput;
    if (r.source === 'api') {
      const method = r.method.toUpperCase();
      if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return;
      body = { source: 'api', message: `HTTP ${r.status}`, method: method as ClientErrorInput['method'], apiPath: r.apiPath.split(/[?#]/)[0]!.slice(0, 300) || '/', status: Math.min(599, Math.max(500, r.status)), ...base };
    } else {
      const err = r.error;
      const message = (err instanceof Error ? `${err.name && err.name !== 'Error' ? `${err.name}: ` : ''}${err.message}` : typeof err === 'string' ? err : 'error').trim() || 'error';
      const stack = err instanceof Error && err.stack ? err.stack.slice(0, 4000) : undefined;
      if (notOurs(message, stack)) return;
      body = { source: r.source, message: message.slice(0, 500), ...(stack ? { stack } : {}), ...base };
    }
    const key = `${body.source}|${body.message}|${body.path}|${'apiPath' in body ? body.apiPath : ''}`;
    const last = recent.get(key);
    const now = Date.now();
    if (last && now - last < SAME_AGAIN_MS) return;
    recent.set(key, now);
    sent++;
    const url = `${basePath}/api/v1/client-errors`;
    const json = JSON.stringify(body);
    // keepalive so a report made while leaving the page still arrives
    void fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: json, keepalive: json.length < 60_000 }).catch(() => {});
  } catch {
    // reporting must never become the error
  }
}

let installed = false;

// once per page: uncaught errors and promise rejections nobody handled
export function installErrorReporting() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('error', (e) => {
    // a failed image or script load has no error object, the page handles those itself
    if (!e.error && !e.message) return;
    // the old version's files after a deploy: load the new version instead of reporting
    if (isStaleChunk(e.error ?? e.message) && reloadForNewVersion()) return;
    reportError({ source: 'error', error: e.error ?? e.message });
  });
  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason as unknown;
    if (isStaleChunk(reason) && reloadForNewVersion()) return;
    // a failed api call already reported itself as 5xx, a 4xx is an answer and not an error
    if (reason && typeof reason === 'object' && 'status' in reason && typeof (reason as { status: unknown }).status === 'number') return;
    reportError({ source: 'rejection', error: reason });
  });
}
