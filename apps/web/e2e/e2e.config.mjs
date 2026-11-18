// settings for the end to end run. everything runs on this machine: a throwaway api with the seeded
// Lemoni business (dev mode, outbox transport, nothing is ever sent) and a production build of the
// web under /custock, both from a snapshot of the working tree so other work in progress cannot
// break the build half way.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const repo = join(here, '..', '..', '..');

export default {
  repo,
  // two levels under the repo, so the web's turbopack root (two levels up) is the repo itself
  // E2E_BUILD_DIR lets two runs build side by side (a sibling folder of the repo root's e2e-build)
  build: process.env.E2E_BUILD_DIR ? join(repo, process.env.E2E_BUILD_DIR) : join(repo, 'e2e-build'),
  results: join(here, 'results'),
  basePath: '/custock',
  apiPort: Number(process.env.E2E_API_PORT ?? 8811),
  webPort: Number(process.env.E2E_WEB_PORT ?? 3811),
  password: 'custock',
  testTimeoutMs: 120_000,
  desktop: { width: 1280, height: 800 },
  phone: { width: 390, height: 844 },
  iphoneUA: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1',
};
