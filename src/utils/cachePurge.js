/**
 * The Cache Storage caches this application owns, and the purge that clears them.
 *
 * `src/sw.js` is the authority for the names: they are the `cacheName:` values
 * its workbox strategies write through, plus the migration cache it opens by
 * hand. The logout purge this replaces matched names by substring
 * (`key.includes('api') || key.includes('data')`), which matched only
 * `api-cache` - the cache it had just deleted on the line above - and so left
 * `image-cache`, `font-cache`, `static-resources` and `sw-migrations` holding
 * whatever an authenticated session had put in them. Enumerating is the fix: a
 * substring cannot silently miss a cache somebody names after this list was
 * written, but a missing name is caught by
 * `test/security/logout_purge.test.mjs`, which fails when the worker names a
 * cache this module does not clear.
 */

/** Every cache the service worker writes. Keep it in step with `src/sw.js`. */
export const APP_CACHE_NAMES = Object.freeze([
  'api-cache',
  'image-cache',
  'font-cache',
  'static-resources',
  'sw-migrations',
]);

/**
 * The one cache family a logout must leave alone: workbox-precaching writes the
 * revisioned assets that let the PWA boot with no network, under names it
 * generates itself from the registration scope (`workbox-precache-v2-<scope>`).
 * No cache in `APP_CACHE_NAMES` is named that way, so the enumeration below
 * preserves the precache by not reaching for it.
 */
export const WORKBOX_PRECACHE_PREFIX = 'workbox-precache-';

const cacheStorage = () => globalThis.caches ?? null;

/**
 * Deletes every application cache. Deliberately not "delete whatever is left,
 * except the precache": other libraries write caches under this origin too, and
 * a purge that could not tell them apart would break them to clear caches that
 * were never ours.
 *
 * A cache that refuses to be deleted is reported and does not stop the others:
 * the server session is already gone by the time this runs, so aborting would
 * trade a half-clean device for a user still holding a dead session.
 */
export const purgeAppCaches = async () => {
  const storage = cacheStorage()
  if (!storage) {
    return
  }

  for (const name of APP_CACHE_NAMES) {
    try {
      await storage.delete(name)
    } catch (error) {
      console.error(`Failed to clear the ${name} cache:`, error)
    }
  }
}
