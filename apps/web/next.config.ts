import type { NextConfig } from 'next';
import path from 'node:path';

// the api lives on its own port. when CUSTOCK_API_URL is set, the browser talks to it through
// /api/v1/* on this origin, so no cors setup is needed in development.
const apiUrl = process.env.CUSTOCK_API_URL?.replace(/\/$/, '');

const nextConfig: NextConfig = {
  // the previous rendering model: pages read cookies for the language on every request.
  // cache components can come back once the customer pages are tuned for a static shell.
  cacheComponents: false,
  // the docker image (deploy/web.Dockerfile) runs the standalone server
  output: 'standalone',
  transpilePackages: ['@custock/core', '@custock/i18n', '@custock/tokens'],
  env: { NEXT_PUBLIC_API_MODE: apiUrl ? 'real' : 'fixtures' },
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
    ];
  },
};

export default nextConfig;
