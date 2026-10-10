import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { CacheFirst, NetworkFirst, StaleWhileRevalidate } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';

// Cleanup old precaches
cleanupOutdatedCaches();

// Precache resources from manifest
precacheAndRoute(self.__WB_MANIFEST);

// ---------------------------------------------------------------------------
// What this worker is allowed to cache
//
// It is an allowlist, not a blocklist: a route matches only the requests
// described below, and every other request is left to the network untouched.
// There is deliberately no exclusion list to keep in sync, so there is no
// "protection" here that can silently stop protecting anything - the endpoints
// that carry PII (/api/, /shipments, /payments, /notes, /upload, and any POST or
// other non-GET) are excluded by not being on this list, by construction.
// ---------------------------------------------------------------------------

// API paths that may be served from Cache Storage when the device is offline.
// Anything not listed here is never written to a cache by this worker.
const CACHEABLE_API_PREFIXES = [
  '/statuses',
  '/notifications',
  '/health',
];

const isCacheableApiPath = (pathname) => {
  const normalized = (pathname || '').toLowerCase();
  return CACHEABLE_API_PREFIXES.some((prefix) => {
    const clean = prefix.toLowerCase().replace(/\/+$/, '');
    return normalized === clean || normalized.startsWith(`${clean}/`);
  });
};

// `sameOrigin` is workbox-routing's own `url.origin === self.location.origin`
// comparison, handed to every match callback. Keeping the runtime routes
// same-origin is not only about not storing somebody else's responses: the CSP
// this app ships has `connect-src 'self'`, and that directive governs the
// worker's own fetch() calls too - a route that matched a cross-origin request
// could never satisfy it, so the request would fail instead of being served.

// API Caching - NetworkFirst, for the allowlisted paths only
registerRoute(
  ({ url, sameOrigin }) =>
    sameOrigin &&
    isCacheableApiPath(url.pathname),
  new NetworkFirst({
    cacheName: 'api-cache',
    plugins: [
      // statuses [200] keeps opaque and error responses out of the cache
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

// ---------------------------------------------------------------------------
// Cache Storage migrations
// ---------------------------------------------------------------------------

/**
 * Version of the cache layout this worker writes.
 *
 * `runPendingMigrations` below is keyed on it: introducing a version marks it as
 * done, and a later activation that finds the marker for the current version does
 * nothing. Bump the constant and the next activation re-runs the migration
 * exactly once. A normal re-activation must never wipe the runtime caches -
 * deleting 'api-cache' on every activate (as this worker used to) threw away
 * exactly the offline data the allowlist above exists to keep.
 */
const CACHE_SCHEMA_VERSION = 1;

/**
 * Holds one synthetic marker string per schema version. No responses.
 *
 * Cache Storage is best-effort storage, so the marker can be evicted while
 * `api-cache` survives; the next activation then re-runs the purge. The cost is
 * one bounded refill, because the allowlist above means `api-cache` can never
 * hold PII in the first place. A marker that survives that needs IndexedDB
 * rather than Cache Storage, so the re-run is accepted here and left to the
 * logout-purge work to replace.
 */
const MIGRATION_CACHE_NAME = 'sw-migrations';

/** The runtime cache an earlier build may have filled with PII. */
const LEGACY_API_CACHE = 'api-cache';

const migrationKey = `/schema-v${CACHE_SCHEMA_VERSION}`;

const runPendingMigrations = async () => {
  const markers = await self.caches.open(MIGRATION_CACHE_NAME);
  if (await markers.match(migrationKey)) {
    return false;
  }

  // The marker is written before the purge, not after it, and the reason is
  // idempotence: once the marker is on disk the guard above short-circuits, so
  // the wholesale delete can run at most once per schema version even if the
  // worker is killed between the two awaits. The price is the mirror image - a
  // delete that fails, or is interrupted before it lands, is never retried.
  // That is the safe direction for a purge whose replay would throw away data
  // the runtime cache has since refilled.
  await markers.put(migrationKey, new Response('done'));
  return self.caches.delete(LEGACY_API_CACHE);
};

self.addEventListener('activate', (event) => {
  event.waitUntil(runPendingMigrations());
});

// Image Caching - CacheFirst, same-origin and never opaque.
// An opaque response has status 0 (a cross-origin no-cors reply), so
// statuses [200] is standing defence in depth: the layer that actually
// refuses it is workbox-strategies' StrategyHandler._ensureResponseSafeToCache,
// which drops every non-200 response when no plugin supplies a
// cacheWillUpdate - CacheFirst has no default one - so the origin check is
// what keeps this route from ever being handed an opaque response at all.
registerRoute(
  ({ request, sameOrigin }) =>
    sameOrigin &&
    request.destination === 'image',
  new CacheFirst({
    cacheName: 'image-cache',
    plugins: [
      new CacheableResponsePlugin({
        statuses: [200],
      }),
      new ExpirationPlugin({
        maxEntries: 50,
        maxAgeSeconds: 30 * 24 * 60 * 60, // 30 Days
      }),
    ],
  })
);

// Font Caching - CacheFirst, same-origin. The stylesheet App.css imports serves
// its @font-face files from fonts.gstatic.com, which `font-src` admits; letting
// those through to the network is the only way they can load, because the
// worker's own fetch would be governed by `connect-src 'self'` instead.
registerRoute(
  ({ request, sameOrigin }) =>
    sameOrigin &&
    request.destination === 'font',
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

// Scripts and Styles - StaleWhileRevalidate, same-origin and bounded
registerRoute(
  ({ request, sameOrigin }) =>
    sameOrigin &&
    (request.destination === 'script' || request.destination === 'style'),
  new StaleWhileRevalidate({
    cacheName: 'static-resources',
    plugins: [
      new CacheableResponsePlugin({
        statuses: [200],
      }),
      new ExpirationPlugin({
        maxEntries: 50,
        maxAgeSeconds: 30 * 24 * 60 * 60, // 30 Days
      }),
    ],
  })
);

// Fallback for SPA navigation (handled by precache of index.html mostly, but good to be explicit if needed)
// workbox-precaching handles the navigation fallback to index.html if configured in VitePWA injection.

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
