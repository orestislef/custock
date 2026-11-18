// first load javascript of each route in a built web, the way the browser fetches it: the root
// files plus every chunk the route's layouts and page need, gzipped. no server needed.
//   node apps/web/scripts/route-sizes.mjs <web dir with .next> [route ...]

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { gzipSync } from 'node:zlib';
import vm from 'node:vm';

const web = resolve(process.argv[2] ?? 'apps/web');
const only = process.argv.slice(3);
const next = join(web, '.next');
const build = JSON.parse(readFileSync(join(next, 'build-manifest.json'), 'utf8'));
const size = new Map();
const gz = (f) => {
  if (!size.has(f)) { const p = join(next, f); size.set(f, existsSync(p) ? gzipSync(readFileSync(p)).length : 0); }
  return size.get(f);
};

const manifests = [];
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (f === 'page_client-reference-manifest.js') manifests.push(p); } };
walk(join(next, 'server', 'app'));

const rows = [];
for (const file of manifests) {
  const ctx = { self: {}, globalThis: {} };
  ctx.globalThis = ctx;
  vm.runInNewContext(readFileSync(file, 'utf8'), ctx);
  const all = ctx.__RSC_MANIFEST ?? ctx.self.__RSC_MANIFEST;
  const route = Object.keys(all)[0];
  const m = all[route];
  const path = '/' + relative(join(next, 'server', 'app'), file).split(sep).slice(0, -1).join('/');
  // the entries of this route: the root and every layout on its path, and its own page
  const segs = path === '/' ? [] : path.slice(1).split('/');
  const wanted = new Set(['layout', ...segs.map((_, i) => `${segs.slice(0, i + 1).join('/')}/layout`), `${segs.length ? segs.join('/') + '/' : ''}page`]);
  const files = new Set(build.rootMainFiles);
  for (const [entry, list] of Object.entries(m.entryJSFiles)) {
    const tail = entry.replace(/^.*\/src\/app\//, '');
    if (wanted.has(tail)) for (const f of list) files.add(f);
  }
  const total = [...files].reduce((a, f) => a + gz(f), 0);
  rows.push({ route: path, kb: Math.round(total / 1024), files: files.size });
}
rows.sort((a, b) => a.route.localeCompare(b.route));
const pick = only.length ? rows.filter((r) => only.includes(r.route)) : rows;
const shared = build.rootMainFiles.reduce((a, f) => a + gz(f), 0);
console.log(`shared on every page: ${Math.round(shared / 1024)} KB gzip in ${build.rootMainFiles.length} files`);
for (const r of pick) console.log(`${r.route}\t${r.kb} KB\t${r.files} files`);
