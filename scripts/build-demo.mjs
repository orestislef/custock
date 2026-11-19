// builds the public demo into demo/ (GitHub Pages, https://orestislef.github.io/custock/demo/):
// the real web app as static files, running on the sample data in the browser. no server, no api,
// nothing is sent anywhere.
//
//   node scripts/build-demo.mjs
//
// the app's own files are not touched. a copy goes to apps/.web-demo, where what a static host
// cannot run is taken out or wrapped: the proxy and the route handlers go, every page with an id in
// its address gets the ids of the sample data (and a short series for what a visitor makes), pages
// that read the query string get an empty one, and the front page becomes the demo's start. then
// `next build` with CUSTOCK_DEMO=1 (next.config.ts) exports it and the result replaces demo/.

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const web = join(root, 'apps', 'web');
const tmp = join(root, 'apps', '.web-demo');
const out = join(root, 'demo');
const BASE = '/custock/demo';

const log = (line) => console.log(`[demo] ${line}`);

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, files);
    else files.push(p);
  }
  return files;
}

// folders, deepest first (so a folder is handled before the one around it)
function walkDirs(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { walkDirs(p, out); out.push(p); }
  }
  return out;
}

// 1. a copy of the web app, without its build folders and installed packages
rmSync(tmp, { recursive: true, force: true });
const skip = new Set(['node_modules', '.next', 'e2e', 'out']);
cpSync(web, tmp, {
  recursive: true,
  filter: (src) => {
    const rel = relative(web, src);
    if (!rel) return true;
    const first = rel.split(sep)[0];
    return !skip.has(first) && !first.startsWith('.next') && !first.startsWith('e2e-build');
  },
});
const app = join(tmp, 'src', 'app');
// the workspace packages are linked into the app's own node_modules, so the copy links them too
mkdirSync(join(tmp, 'node_modules', '@custock'), { recursive: true });
for (const name of readdirSync(join(web, 'node_modules', '@custock'))) {
  symlinkSync(join(root, 'packages', name), join(tmp, 'node_modules', '@custock', name), 'junction');
}

// 2. what a static host cannot run: the proxy (headers per request) and the route handlers
rmSync(join(tmp, 'src', 'proxy.ts'), { force: true });
for (const f of walk(app)) if (/[\\/]route\.tsx?$/.test(f)) rmSync(f);

// the server actions (joining, unsubscribing, the email change way back) cannot run without a
// server: the same code runs in the browser on the sample data instead
const actions = join(app, 'actions.ts');
let actionsSrc = readFileSync(actions, 'utf8');
const swap = (a, b) => {
  if (!actionsSrc.includes(a)) throw new Error(`actions.ts changed, update scripts/build-demo.mjs: ${a}`);
  actionsSrc = actionsSrc.replace(a, b);
};
swap("'use server';\n", '// demo copy: these run in the browser on the sample data (scripts/build-demo.mjs)\n');
swap("import { serverApi, isDev } from '@/lib/api-server';", "import { createBrowserApi } from '@/lib/api-client';\nconst isDev = true;\nasync function serverApi(_locale?: string) {\n  return { api: createBrowserApi({ getLocale: () => document.documentElement.lang || 'en' }), mode: 'fixtures' as const };\n}");
swap("import { getLocale } from '@/lib/i18n-server';", "async function getLocale(): Promise<Locale> {\n  return (/(?:^|;\\s*)locale=(en|el|ru)\\b/.exec(document.cookie)?.[1] ?? 'en') as Locale;\n}");
writeFileSync(actions, actionsSrc);

// 3. the ids every page with an id in its address is built for
writeFileSync(join(tmp, 'src', 'demo-params.ts'), `// written by scripts/build-demo.mjs, only in the demo copy
import { demoRouteIds } from '@/lib/fixtures';

export function demoParams(segment: string): Record<string, string | string[]>[] {
  const ids = demoRouteIds();
  const one = (key: string, list: string[]) => list.map((v) => ({ [key]: v }));
  switch (segment) {
    case 'admin/[org]': return one('org', ids.orgSlugs);
    case 'admin/[org]/[...rest]': return [{ rest: ['demo'] }];
    case 'admin/[org]/customers/[id]': return one('id', ids.customers);
    case 'admin/[org]/posts/[id]': return one('id', ids.posts);
    case 'admin/[org]/print/[id]': return one('id', ids.joinLinks);
    case 'admin/[org]/print/label/[id]': return one('id', ids.products);
    case 'admin/[org]/stock/[id]': return one('id', ids.products);
    case 'admin/[org]/stock/counts/[id]': return one('id', ids.counts);
    case 'admin/[org]/stock/transfers/[id]': return one('id', ids.transfers);
    case 'admin/[org]/team/roles/[id]': return one('id', ids.roles);
    case 'admin/platform/[orgId]': return [{ orgId: 'org-lemoni' }];
    case 'j/[code]': return one('code', ids.joinCodes);
    case 'p/[code]': return one('code', ids.productCodes);
    case 's/[org]': return one('org', ids.orgSlugs);
    case 's/[org]/p/[id]': return one('id', ids.products);
    default: {
      // links with a one time token (invites, resets, confirmations): one sample page
      const key = /\\[([^\\]]+)\\]$/.exec(segment)?.[1] ?? 'token';
      return [{ [key]: 'demo' }];
    }
  }
}
`);

const dynamicDirs = [...new Set(walk(app).map((f) => dirname(f)))].filter((d) => /[\\/]\[[^\]]+\]$/.test(d));
for (const dir of dynamicDirs) {
  const segment = relative(app, dir).split(sep).join('/');
  const layout = join(dir, 'layout.tsx');
  const params = `export async function generateStaticParams() {\n  return demoParams('${segment}');\n}\n`;
  if (existsSync(layout)) {
    renameSync(layout, join(dir, 'layout.orig.tsx'));
    writeFileSync(layout, `import { demoParams } from '@/demo-params';\nexport * from './layout.orig';\nexport { default } from './layout.orig';\n${params}`);
  } else {
    writeFileSync(layout, `import { demoParams } from '@/demo-params';\nexport default function DemoSegment({ children }: { children: React.ReactNode }) {\n  return children;\n}\n${params}`);
  }
}
log(`${dynamicDirs.length} pages with ids in their address`);

// 4. pages that read the query string get an empty one (a static page is the same for every query)
let wrapped = 0;
for (const f of walk(app)) {
  if (!/[\\/]page\.tsx$/.test(f)) continue;
  const src = readFileSync(f, 'utf8');
  if (/^'use client'/.test(src) || !/searchParams/.test(src)) continue;
  renameSync(f, f.replace(/page\.tsx$/, 'page.orig.tsx'));
  writeFileSync(f, `import Orig from './page.orig';\nexport * from './page.orig';\n\nexport default function DemoPage(props: Record<string, unknown>) {\n  return <Orig {...(props as never)} searchParams={Promise.resolve({})} />;\n}\n`);
  wrapped++;
}
log(`${wrapped} pages read the query string`);

// 5. the start page, and a line on every page that this is a demo
writeFileSync(join(tmp, 'src', 'components', 'demo-banner.tsx'), `// written by scripts/build-demo.mjs, only in the demo copy
export function DemoBanner() {
  return (
    <div aria-hidden="true" style={{ position: 'fixed', top: 'calc(6px + env(safe-area-inset-top))', left: '50%', transform: 'translateX(-50%)', zIndex: 2147483000, pointerEvents: 'none',
      padding: '3px 10px', borderRadius: 999, background: 'var(--c-accent)', color: '#fff', font: '600 11px/16px system-ui, sans-serif', whiteSpace: 'nowrap', opacity: 0.92 }}>
      Demo · made up data · nothing is sent
    </div>
  );
}
`);
renameSync(join(app, 'layout.tsx'), join(app, 'layout.orig.tsx'));
writeFileSync(join(app, 'layout.tsx'), `import Orig from './layout.orig';
import { DemoBanner } from '@/components/demo-banner';
export { metadata, viewport } from './layout.orig';

export default function DemoRoot({ children }: { children: React.ReactNode }) {
  return <Orig params={Promise.resolve({})}><>{children}<DemoBanner /></></Orig>;
}
`);
writeFileSync(join(app, 'page.tsx'), readFileSync(join(root, 'scripts', 'demo', 'start-page.tsx'), 'utf8'));

// 6. the files the route handlers served: the app manifests and the business's home screen icons.
// a static host sends a file without an extension as a download, so the business icons point at
// the app's own png icons
const manifests = join(tmp, 'src', 'lib', 'manifests.ts');
const iconLine = "  return `${base()}/s/${encodeURIComponent(slug)}/icon/${size}?v=${version}${maskable ? '&maskable=1' : ''}`;";
const manifestsSrc = readFileSync(manifests, 'utf8');
if (!manifestsSrc.includes(iconLine)) throw new Error('orgIconPath in lib/manifests.ts changed, update scripts/build-demo.mjs');
writeFileSync(manifests, manifestsSrc.replace(iconLine, "  void slug; void version; void maskable;\n  return `${base()}/icons/${size === 512 ? 'icon-512' : 'icon-192'}.png`;"));
const manifest = (name, start, scope) => JSON.stringify({
  name, short_name: name, start_url: `${BASE}${start}`, scope: `${BASE}${scope}`, display: 'standalone', background_color: '#F3F3F0', theme_color: '#B0234F',
  icons: [{ src: `${BASE}/icons/icon-192.png`, sizes: '192x192', type: 'image/png' }, { src: `${BASE}/icons/icon-512.png`, sizes: '512x512', type: 'image/png' }],
}, null, 2);
writeFileSync(join(tmp, 'public', 'manifest.webmanifest'), manifest('Custock', '/admin/', '/'));
const lemoni = join(tmp, 'public', 's', 'lemoni');
mkdirSync(lemoni, { recursive: true });
writeFileSync(join(lemoni, 'manifest.webmanifest'), manifest('Lemoni', '/s/lemoni/', '/s/lemoni/'));

// 7. a static host serves folders, so every address ends in a slash (trailingSlash in
// next.config.ts). the app compares paths without one ('/admin/login'), so the copy gets a
// usePathname that leaves it off
writeFileSync(join(tmp, 'src', 'demo-navigation.ts'), `// written by scripts/build-demo.mjs, only in the demo copy
import { usePathname as nextPathname } from 'next/dist/client/components/navigation';
export * from 'next/dist/client/components/navigation';

export function usePathname(): string {
  const p = nextPathname();
  return p && p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p;
}
`);

// type checks run on the real app (scripts/check.mjs); the copy only needs to build
const config = join(tmp, 'next.config.ts');
writeFileSync(config, readFileSync(config, 'utf8').replace('export default nextConfig;', `nextConfig.typescript = { ignoreBuildErrors: true };
nextConfig.turbopack = { ...nextConfig.turbopack, resolveAlias: { ...nextConfig.turbopack?.resolveAlias, 'next/navigation': './src/demo-navigation.ts' } };
export default nextConfig;`));

// 8. build
log('building (a few minutes)');
const next = join(root, 'node_modules', 'next', 'dist', 'bin', 'next');
const built = spawnSync(process.execPath, [next, 'build'], {
  cwd: tmp,
  stdio: 'inherit',
  env: { ...process.env, CUSTOCK_DEMO: '1', CUSTOCK_BASE_PATH: BASE, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1', CUSTOCK_API_URL: '' },
});
if (built.status !== 0) {
  log('build failed, demo/ left as it was');
  process.exit(built.status ?? 1);
}

// 9. replace demo/ with the export
rmSync(out, { recursive: true, force: true });
cpSync(join(tmp, 'out'), out, { recursive: true });

// the browser asks for each page's parts as one flat file (__next.admin.login.__PAGE__.txt), the
// export (built on windows) wrote them as folders (__next.admin/login/__PAGE__.txt): flatten them
let flattened = 0;
for (const dir of walkDirs(out)) {
  const name = dir.split(sep).pop();
  if (!name.startsWith('__next.') || !statSync(dir).isDirectory()) continue;
  for (const f of walk(dir)) {
    const flat = join(dirname(dir), relative(dirname(dir), f).split(sep).join('.'));
    if (!existsSync(flat)) { cpSync(f, flat); flattened++; }
  }
  rmSync(dir, { recursive: true, force: true });
}
log(`${flattened} page parts flattened`);
// the old hand made demo registered a service worker at this address that serves its own cached
// pages. browsers fetch sw.js again on a visit, so this one clears its caches, signs itself off
// and reloads the page once, and returning visitors get the new demo. the demo itself has none.
writeFileSync(join(out, 'sw.js'), `// the demo has no service worker. this one only removes the old demo's worker and its caches.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const key of await caches.keys()) await caches.delete(key);
    await self.registration.unregister();
    for (const client of await self.clients.matchAll({ type: 'window' })) client.navigate(client.url);
  })());
});
`);
rmSync(join(out, 'offline'), { recursive: true, force: true });

// the sample photos are hotlinked under free licenses, the credits go with them
cpSync(join(root, 'scripts', 'demo', 'CREDITS.md'), join(out, 'CREDITS.md'));
// the display face (Commissioner) is under the SIL Open Font License
cpSync(join(root, 'scripts', 'demo', 'OFL.txt'), join(out, 'OFL.txt'));
writeFileSync(join(out, 'README.md'), `# Custock demo

The real web app with made up data, served as static files by GitHub Pages at
https://orestislef.github.io/custock/demo/. Everything stays in the browser tab, nothing is sent
anywhere, and a reload starts over.

Built by \`node scripts/build-demo.mjs\` from apps/web. Do not edit these files by hand.
`);

// 10. GitHub Pages runs Jekyll on this repository, which leaves out names starting with _ unless
// _config.yml includes them
const underscored = new Set(walk(out).flatMap((f) => relative(out, f).split(sep)).filter((n) => n.startsWith('_')));
const patterns = [...readFileSync(join(root, '_config.yml'), 'utf8').matchAll(/^\s*-\s*(\S+)\s*$/gm)].map((m) => m[1]);
const covered = (n) => patterns.some((p) => (p.endsWith('*') ? n.startsWith(p.slice(0, -1)) : n === p));
const missing = [...underscored].filter((n) => !covered(n));
if (missing.length) log(`_config.yml does not include: ${missing.slice(0, 10).join(', ')}`);

rmSync(tmp, { recursive: true, force: true });
const size = walk(out).reduce((n, f) => n + statSync(f).size, 0);
log(`done: ${walk(out).length} files, ${(size / 1024 / 1024).toFixed(1)} MB in demo/`);
