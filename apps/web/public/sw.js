// the custock service worker. scope is the app's base path (/ locally, /custock/ on the server),
// read from the registration so the same file works under any path.
//
// what it does:
//  - keeps the built assets (/_next/static, fonts, icons, the barcode reader) in a cache, they never
//    change under the same name
//  - pages: network first, the last good copy when the network is gone, else a small offline page
//  - never touches the api (<base>/api/), uploads or anything that is not a GET
//  - shows web push notifications and opens the right page when one is tapped

const VERSION = 'v1';
const STATIC = `custock-static-${VERSION}`;
const PAGES = `custock-pages-${VERSION}`;
const BASE = new URL(self.registration.scope).pathname; // ends with a slash
const OFFLINE = `${BASE}offline`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(PAGES)
      .then((c) => c.add(new Request(OFFLINE, { cache: 'reload' })))
      .catch(() => {})
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('custock-') && k !== STATIC && k !== PAGES).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function isStatic(path) {
  return path.startsWith(`${BASE}_next/static/`) || path.startsWith(`${BASE}icons/`) || path.startsWith(`${BASE}wasm/`)
    || /\.(woff2?|ttf)$/.test(path);
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok && res.type === 'basic') cache.put(request, res.clone());
  return res;
}

async function networkFirst(request) {
  const cache = await caches.open(PAGES);
  try {
    const res = await fetch(request);
    // only plain successful pages, never redirects or errors
    if (res.ok && res.type === 'basic' && !res.redirected) cache.put(request, res.clone());
    return res;
  } catch {
    const hit = await cache.match(request, { ignoreVary: true });
    if (hit) return hit;
    const offline = await cache.match(OFFLINE);
    return offline ?? new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(BASE)) return;
  // the api, its files and the dev server's own endpoints stay untouched
  if (url.pathname.startsWith(`${BASE}api/`) || url.pathname.startsWith(`${BASE}files/`) || url.pathname.includes('/__nextjs')) return;
  // the manifests and the worker itself are always fresh
  if (url.pathname.endsWith('.webmanifest') || url.pathname.endsWith('/sw.js')) return;
  if (isStatic(url.pathname)) {
    event.respondWith(cacheFirst(req));
    return;
  }
  // next's client navigations (rsc payloads) go to the network, a full page load can fall back
  if (req.mode === 'navigate') event.respondWith(networkFirst(req));
});

// ---------------------------------------------------------------- push

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'Custock';
  const options = {
    body: data.body || '',
    icon: data.icon || `${BASE}icons/icon-192.png`,
    badge: data.badge || `${BASE}icons/badge-96.png`,
    tag: data.tag || undefined,
    renotify: !!data.tag,
    data: { url: data.url || BASE },
  };
  if (data.image) options.image = data.image;
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || BASE, self.location.origin);
  // only our own pages
  const url = target.origin === self.location.origin && target.pathname.startsWith(BASE) ? target.href : new URL(BASE, self.location.origin).href;
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const same = all.find((c) => c.url === url);
    if (same) return same.focus();
    const ours = all.find((c) => new URL(c.url).pathname.startsWith(BASE));
    if (ours) {
      await ours.focus();
      return ours.navigate(url).catch(() => self.clients.openWindow(url));
    }
    return self.clients.openWindow(url);
  })());
});

// the browser rotated the subscription. subscribe again with the same key, the page sends the new
// one to the api the next time it opens (the session lives in the page, not here).
self.addEventListener('pushsubscriptionchange', (event) => {
  const key = event.oldSubscription && event.oldSubscription.options && event.oldSubscription.options.applicationServerKey;
  if (!key) return;
  event.waitUntil(self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }).catch(() => {}));
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
  if (event.data === 'clear-pages') event.waitUntil(caches.delete(PAGES));
});
