// security headers that change per request: the Content-Security-Policy with a fresh nonce. Next
// reads the nonce from the request's CSP header and puts it on its inline scripts. script files
// are allowed from this origin only ('self'), so a plain <script src="/theme.js"> in the head runs
// before the first paint without a nonce. no 'strict-dynamic': it would switch 'self' off.
// the app has its own origin (custock.example.com), so 'self' is only this app's own files.
// the fixed headers (frames, sniffing, referrer, permissions) are in next.config.ts.

import { NextResponse, type NextRequest } from 'next/server';

const dev = process.env.NODE_ENV !== 'production';

function origin(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

// photos go straight from the browser to the bucket (R2 or AWS S3), so the upload address is allowed
const bucket = [origin(process.env.CUSTOCK_S3_ENDPOINT), origin(process.env.CUSTOCK_S3_PUBLIC_URL), 'https://*.r2.cloudflarestorage.com', 'https://*.amazonaws.com']
  .filter((x): x is string => !!x);

export function contentSecurityPolicy(nonce: string, opts: { https: boolean; dev?: boolean }): string {
  const isDev = opts.dev ?? dev;
  return [
    "default-src 'self'",
    // wasm-unsafe-eval: the barcode reader runs as WebAssembly. unsafe-eval only while developing
    `script-src 'self' 'nonce-${nonce}' 'wasm-unsafe-eval'${isDev ? " 'unsafe-eval'" : ''}`,
    // React writes style attributes, so inline styles stay allowed (they cannot run code)
    "style-src 'self' 'unsafe-inline'",
    // product photos can be any https picture, the camera preview and resized uploads are blob: and data:
    `img-src 'self' data: blob: https:${isDev ? ' http://localhost:* http://127.0.0.1:*' : ''}`,
    "font-src 'self' data:",
    `connect-src 'self' ${bucket.join(' ')}${isDev ? ' ws: http://localhost:* http://127.0.0.1:*' : ''}`,
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "frame-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(opts.https ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
}

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const https = request.headers.get('x-forwarded-proto') === 'https' || request.nextUrl.protocol === 'https:';
  const csp = contentSecurityPolicy(nonce, { https });
  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('Content-Security-Policy', csp);
  // someone typing or following an address that the web hands to the api (/files, /email and
  // their /api twins) gets the app's own not found page, not a json answer. photos and the email
  // assets themselves (a name with an extension, or an image request) still go through.
  const response = wantsPageForApiPath(request)
    ? NextResponse.rewrite(new URL(`${request.nextUrl.basePath}/__not-found`, request.url), { request: { headers } })
    : NextResponse.next({ request: { headers } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

const API_PATHS = /^\/(?:api\/)?(?:files|email|v1)(?:\/|$)/;

function wantsPageForApiPath(request: NextRequest): boolean {
  const path = request.nextUrl.pathname.slice(request.nextUrl.basePath.length) || '/';
  if (!API_PATHS.test(path)) return false;
  const navigation = request.headers.get('sec-fetch-mode') === 'navigate' || (request.headers.get('accept') ?? '').startsWith('text/html');
  if (!navigation) return false;
  const last = path.split('/').filter(Boolean).pop() ?? '';
  return !last.includes('.');
}

export const config = {
  matcher: [
    {
      // everything except built files, icons, the barcode reader, the service worker and the offline
      // page (it carries its own policy, it is served from the cache without a server)
      source: '/((?!_next/static|_next/image|icons/|wasm/|sw\.js|favicon|offline).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
