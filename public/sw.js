// ─────────────────────────────────────────────────────────────────
// public/sw.js
//
// Minimal service worker for The Artyst membership pass PWA.
//
// Strategy:
//   - HTML (the /me page) — network-first, fall back to cache.
//     So when the page is updated server-side, members see the new
//     version; if they're offline, they see the last successful load.
//   - API responses (/api/membership/me) — network-first, fall back
//     to cache. Pass data is freshest from the network, but if offline
//     they still see their last-loaded pass.
//   - Static assets (icons, manifest, etc.) — cache-first.
//     These rarely change; serving from cache is fast and offline-safe.
//
// Cache version: bump CACHE_VERSION to force all clients to re-fetch
// on next service-worker activation.
// ─────────────────────────────────────────────────────────────────

const CACHE_VERSION = 'artyst-pass-v1';
const STATIC_ASSETS = [
  '/icon-192.png',
  '/icon-512.png',
  '/manifest.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(STATIC_ASSETS)),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Delete old caches
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Same-origin only — don't try to cache Stripe, fonts, etc.
  if (url.origin !== self.location.origin) return;

  // Static assets: cache-first
  if (STATIC_ASSETS.includes(url.pathname)) {
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req)),
    );
    return;
  }

  // Page and API: network-first with cache fallback
  if (url.pathname === '/me' || url.pathname.startsWith('/api/membership/me')) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // Clone and cache the fresh response if successful
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then((cached) => cached || Response.error())),
    );
    return;
  }
});
