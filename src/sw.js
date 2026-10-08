import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { CacheFirst, NetworkFirst, StaleWhileRevalidate } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';

// Cleanup old caches
cleanupOutdatedCaches();

// Precache resources from manifest
precacheAndRoute(self.__WB_MANIFEST);

// Routes strictly excluded from Cache Storage to prevent PII and sensitive customer/financial leaks
const EXCLUDED_CACHE_ROUTES = [
  '/api/',
  '/shipments',
  '/payments',
  '/notes',
  '/upload',
];

const isExcludedRoute = (pathname) => {
  const normalized = (pathname || '').toLowerCase();
  return EXCLUDED_CACHE_ROUTES.some((prefix) => {
    const clean = prefix.toLowerCase().replace(/\/+$/, '');
    return normalized === clean || normalized.startsWith(`${clean}/`);
  });
};

// Safe endpoints that may be cached offline
const SAFE_API_PREFIXES = [
  '/statuses',
  '/notifications',
  '/health',
];

const isSafeApiPath = (pathname) => {
  const normalized = (pathname || '').toLowerCase();
  return SAFE_API_PREFIXES.some((prefix) => {
    const clean = prefix.toLowerCase().replace(/\/+$/, '');
    return normalized === clean || normalized.startsWith(`${clean}/`);
  });
};

// API Caching - NetworkFirst for safe, non-sensitive endpoints only
// /api/, /shipments, /payments, and /notes are explicitly excluded to prevent PII and financial data leaks
registerRoute(
  ({ url }) =>
    url.origin === self.location.origin &&
    isSafeApiPath(url.pathname) &&
    !isExcludedRoute(url.pathname),
  new NetworkFirst({
    cacheName: 'api-cache',
    plugins: [
      new CacheableResponsePlugin({
        statuses: [200],
      }),
      new ExpirationPlugin({
        maxEntries: 100,
        maxAgeSeconds: 24 * 60 * 60, // 24 Hours
      }),
    ],
  })
);

// Purge any legacy api-cache that may contain previously stored PII on activate
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.delete('api-cache')
  );
});

// Image Caching - CacheFirst
// Serve from cache, update in background? No, CacheFirst means cache wins unless missing.
registerRoute(
  ({ request }) => request.destination === 'image',
  new CacheFirst({
    cacheName: 'image-cache',
    plugins: [
      new ExpirationPlugin({
        maxEntries: 50,
        maxAgeSeconds: 30 * 24 * 60 * 60, // 30 Days
      }),
    ],
  })
);

// Font Caching - CacheFirst
registerRoute(
  ({ request }) => request.destination === 'font',
  new CacheFirst({
    cacheName: 'font-cache',
    plugins: [
      new ExpirationPlugin({
        maxEntries: 20,
        maxAgeSeconds: 365 * 24 * 60 * 60, // 1 Year
      }),
    ],
  })
);

// Scripts and Styles - StaleWhileRevalidate
registerRoute(
  ({ request }) => request.destination === 'script' || request.destination === 'style',
  new StaleWhileRevalidate({
    cacheName: 'static-resources',
  })
);

// Fallback for SPA navigation (handled by precache of index.html mostly, but good to be explicit if needed)
// workbox-precaching handles the navigation fallback to index.html if configured in VitePWA injection.

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
