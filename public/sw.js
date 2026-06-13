// Vantage service worker — intentionally conservative.
// Strategy: NETWORK-FIRST for everything. The app's value is fresh market data
// and inventory, so we never want to serve stale API responses or a stale app
// shell. The cache is only a fallback for when the network is unavailable, so
// the app still opens offline and shows the last-loaded shell.

const CACHE = 'vantage-v1';
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png'];

self.addEventListener('install', (event) => {
  // Activate this worker immediately on first install.
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
});

self.addEventListener('activate', (event) => {
  // Clean up any old cache versions and take control of open pages.
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Only handle GET navigations/assets; never cache API calls or POSTs.
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Don't touch cross-origin API calls (Railway backend, VinAudit, NHTSA, etc.)
  // or the Tesseract CDN — always go straight to network for those.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        // Cache a copy of same-origin GETs so they're available offline.
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() =>
        // Offline fallback: serve from cache, or the cached shell for navigations.
        caches.match(req).then((hit) => hit || caches.match('/index.html'))
      )
  );
});
