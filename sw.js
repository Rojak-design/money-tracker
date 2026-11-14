// Service worker: lets Rojak (home screen, money tracker, fitness and habits) open with no internet connection.
// When you change any app file, bump this version number AND the ?v= numbers in index.html, money/index.html,
// fitness/index.html and habits/index.html
// so phones get the update with all files matching.
const VERSION = 71;
const CACHE = 'rojak-v' + VERSION;
const FILES = [
  './',
  './index.html',
  './core/home.css?v=' + VERSION,
  './core/store.js?v=' + VERSION,
  './core/avatar.js?v=' + VERSION,
  './core/weather.js?v=' + VERSION,
  './core/water.js?v=' + VERSION,
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
  // Only the app's own files: requests to other sites (e.g. the weather forecasts) go straight to the network.
  if (new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(new Request(e.request.url, { cache: 'no-cache', credentials: 'same-origin' }))
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});

/* ---------- Reminders: recurring payments due but not logged ----------
   The money tracker saves a list of upcoming recurring payments that aren't logged yet (state.reminders, updated
   whenever it's opened or something is logged). A few times a day the phone wakes this helper (periodic
   background sync, Chrome on Android with Rojak installed), and it notifies you of any that are now due —
   each one once, and not at night. */
function idbGet(key) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('money-tracker', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('kv');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction('kv', 'readonly');
      const req = tx.objectStore('kv').get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    };
  });
}
function idbSet(key, val) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('money-tracker', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('kv');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(val, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    };
  });
}
const pad2 = (n) => String(n).padStart(2, '0');
async function notifyDue() {
  const now = new Date();
  if (now.getHours() < 8 || now.getHours() >= 22) return; // not at night
  const state = await idbGet('state');
  if (!state || !state.settings || !state.settings.notify) return;
  const t = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  const due = (state.reminders || []).filter((x) => x.d <= t);
  const told = (await idbGet('rojak:notified')) || [];
  const fresh = due.filter((x) => !told.includes(x.key));
  if (!fresh.length) return;
  const cur = state.settings.currency || 'S$';
  const amt = (x) => (x.type === 'income' ? '+' : x.type === 'transfer' ? '⇄ ' : '−') + cur + (x.amount / 100).toFixed(2);
  await self.registration.showNotification(
    due.length === 1 ? `Time to log: ${due[0].name}` : `${due.length} recurring payments to log`,
    { body: due.slice(0, 5).map((x) => `${x.name} ${amt(x)}`).join('\n') + (due.length > 5 ? `\n+${due.length - 5} more` : '') + '\nTap to log them.',
      icon: './rojak-icon-192.png', badge: './rojak-icon-192.png', tag: 'rojak-due', data: { url: './money/#due' } });
  await idbSet('rojak:notified', [...told, ...fresh.map((x) => x.key)].slice(-500));
}
self.addEventListener('periodicsync', (e) => {
  if (e.tag === 'recurring-due') e.waitUntil(notifyDue().catch(() => {}));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './money/', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
    const w = wins.find((c) => c.url.includes('/money/'));
    if (w) return w.focus().then(() => w.navigate(url)).catch(() => self.clients.openWindow(url));
    return self.clients.openWindow(url);
  }));
});
