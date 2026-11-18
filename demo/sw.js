// keeps the demo working without a connection once it has been opened. photos come from
// wikimedia and are cached as they load.
const CACHE = 'custock-demo-v1';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest',
  'assets/css/tokens.css', 'assets/css/app.css',
  'assets/js/images.js', 'assets/js/text.js', 'assets/js/data.js', 'assets/js/i18n.js',
  'assets/js/i18n2.js', 'assets/js/i18n3.js', 'assets/js/app.js',
  'assets/fonts/commissioner-latin.woff2', 'assets/fonts/commissioner-greek.woff2', 'assets/fonts/commissioner-cyrillic.woff2',
  'assets/icons/icon-192.png', 'assets/icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

// the demo's own files: network first so updates show up, the cache when offline.
// photos: cache first, they never change.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const own = url.origin === self.location.origin;
  if (own) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
          return res;
        })
        .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match('index.html'))),
    );
  } else if (req.destination === 'image') {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })),
    );
  }
});
