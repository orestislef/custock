import type { NextConfig } from 'next';
import path from 'node:path';

// the api lives on its own port. when CUSTOCK_API_URL is set, the browser talks to it through
// /api/v1/* on this origin, so no cors setup is needed in development.
const apiUrl = process.env.CUSTOCK_API_URL?.replace(/\/$/, '');
// set at build time to serve the app under a path, for example /custock on a shared domain
const basePath = process.env.CUSTOCK_BASE_PATH?.replace(/\/$/, '') || undefined;

const nextConfig: NextConfig = {
  // the previous rendering model: pages read cookies for the language on every request.
  // cache components can come back once the customer pages are tuned for a static shell.
  cacheComponents: false,
  // the docker image (deploy/web.Dockerfile) runs the standalone server
  output: 'standalone',
  // a separate build folder for side by side local builds (checks), the default otherwise
  distDir: process.env.CUSTOCK_NEXT_DIST || '.next',
  transpilePackages: ['@custock/core', '@custock/i18n', '@custock/tokens'],
  basePath,
  poweredByHeader: false,
  // fixed security headers for every page. the Content-Security-Policy, with its nonce, comes from
  // src/proxy.ts. the HSTS header is set by the reverse proxy in front (deploy/README.md).
  async headers() {
    const always = [
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'same-origin' },
      // the camera for scanning, nothing else
      { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), browsing-topics=()' },
    ];
    // pages whose address carries a one time token send no referrer at all
    const tokenPages = ['/admin/reset/:path*', '/invite/:path*', '/platform-invite/:path*', '/confirm/:path*', '/unsubscribe/:path*', '/account/:path*'];
    return [
      { source: '/:path*', headers: always },
      ...tokenPages.map((source) => ({ source, headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }] })),
    ];
  },
  env: {
    NEXT_PUBLIC_API_MODE: apiUrl || process.env.NODE_ENV === 'production' ? 'real' : 'fixtures',
    NEXT_PUBLIC_BASE_PATH: basePath ?? '',
    // the build revision browsers put on their error reports (deploy/ship.sh passes it)
    NEXT_PUBLIC_BUILD_REV: process.env.CUSTOCK_REV ?? process.env.CUSTOCK_BUILD_REV ?? '',
    NEXT_PUBLIC_SHOW_DEV: process.env.CUSTOCK_SHOW_DEV === '1' ? '1' : '',
  },
  images: {
    unoptimized: true,
    remotePatterns: [
      new URL('https://thumb.wikimedia.org/**'),
      new URL('https://upload.wikimedia.org/**'),
      new URL('https://live.staticflickr.com/**'),
    ],
  },
  turbopack: {
    root: path.join(__dirname, '..', '..'),
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
  async rewrites() {
    if (!apiUrl) return [];
    return [
      { source: '/api/v1/:path*', destination: `${apiUrl}/v1/:path*` },
      { source: '/files/:path*', destination: `${apiUrl}/files/:path*` },
      // the api's public address is <web>/api on a server; without the reverse proxy in front
      // (local runs) photos and email assets under it still reach the api
      { source: '/api/files/:path*', destination: `${apiUrl}/files/:path*` },
      { source: '/api/email/:path*', destination: `${apiUrl}/email/:path*` },
    ];
  },
};

export default nextConfig;
