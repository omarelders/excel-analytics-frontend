import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { CacheFirst, NetworkFirst, StaleWhileRevalidate } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';

// Cleanup old caches
cleanupOutdatedCaches();

// Precache resources from manifest
precacheAndRoute(self.__WB_MANIFEST);

const API_PATH_PREFIXES = [
  '/api/',
  '/shipments',
  '/payments',
  '/upload',
  '/statuses',
  '/notifications',
  '/health',
]

const isApiPath = (pathname) =>
  API_PATH_PREFIXES.some((prefix) => {
    if (prefix.endsWith('/')) {
      return pathname.startsWith(prefix)
    }
    return pathname === prefix || pathname.startsWith(`${prefix}/`)
  })

// API Caching - NetworkFirst
// Try network first, fall back to cache if offline
registerRoute(
  ({ url }) => url.origin === self.location.origin && isApiPath(url.pathname),
  new NetworkFirst({
    cacheName: 'api-cache',
    plugins: [
      new CacheableResponsePlugin({
        statuses: [0, 200],
      }),
      new ExpirationPlugin({
        maxEntries: 100,
        maxAgeSeconds: 24 * 60 * 60, // 24 Hours
      }),
    ],
  })
);

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
