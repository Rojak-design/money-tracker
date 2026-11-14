// Service worker: lets Rojak (home screen, money tracker, fitness and habits) open with no internet connection.
// When you change any app file, bump this version number AND the ?v= numbers in index.html, money/index.html,
// fitness/index.html and habits/index.html
// so phones get the update with all files matching.
const VERSION = 63;
const CACHE = 'rojak-v' + VERSION;
const FILES = [
  './',
  './index.html',
  './core/home.css?v=' + VERSION,
  './core/store.js?v=' + VERSION,
  './core/avatar.js?v=' + VERSION,
  './core/cat.js?v=' + VERSION,
  './core/home.js?v=' + VERSION,
  './money/',
  './money/index.html',
  './money/style.css?v=' + VERSION,
  './money/app.js?v=' + VERSION,
  './money/plan.js?v=' + VERSION,
  './fitness/',
  './fitness/index.html',
  './fitness/style.css?v=' + VERSION,
  './fitness/app.js?v=' + VERSION,
  './fitness/import.js?v=' + VERSION,
  './habits/',
  './habits/index.html',
  './habits/style.css?v=' + VERSION,
  './habits/rules.js?v=' + VERSION,
  './habits/engine.js?v=' + VERSION,
  './habits/app.js?v=' + VERSION,
  './manifest.json',
  './rojak-icon.svg',
  './rojak-icon-192.png',
  './rojak-icon-512.png',
  './rojak-apple-touch-icon.png',
  './icon-v2.svg',
  './apple-touch-icon-v2.png'
];

self.addEventListener('install', (e) => {
  // cache: 'reload' skips the browser's HTTP cache so the newest files are stored.
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network first (so updates show up), fall back to the cache when offline.
// GitHub Pages lets browsers keep files for 10 minutes; 'no-cache' asks the server each time whether a file has
// changed (a quick check), so an update shows up as soon as it's published.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const sameOrigin = new URL(e.request.url).origin === location.origin;
  e.respondWith(
    fetch(sameOrigin ? new Request(e.request.url, { cache: 'no-cache', credentials: 'same-origin' }) : e.request)
      .then((res) => {
        if (res.ok && new URL(e.request.url).origin === location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
