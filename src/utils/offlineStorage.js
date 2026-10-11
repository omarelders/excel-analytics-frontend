import { openDB } from 'idb';

const DB_NAME = 'gold-road-db';
const DB_VERSION = 1;

export const initDB = async () => {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      // Stores for cached data
      if (!db.objectStoreNames.contains('shipments')) {
        db.createObjectStore('shipments', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('orders')) {
        db.createObjectStore('orders', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('analytics')) {
        db.createObjectStore('analytics'); // Key-value store
      }
      
      // Store for pending sync requests
      if (!db.objectStoreNames.contains('syncQueue')) {
        db.createObjectStore('syncQueue', { keyPath: 'id', autoIncrement: true });
      }
    },
  });
};

/**
 * SECURITY NOTE (vuln 13 - Cleartext PII in IndexedDB):
 * Storing offline mutations in IndexedDB can persist unencrypted recipient addresses,
 * customer phone numbers, and other PII locally on disk.
 *
 * Feasibility analysis of stripping/redacting PII:
 * Outbound requests in 'syncQueue' represent pending server mutations (POST/PUT/PATCH).
 * Stripping or redacting recipient addresses, phones, or names in request.data would
 * corrupt database records upon replay (sending redacted placeholders to the API).
 *
 * Mitigations implemented:
 * 1. Authorization/Cookie headers are stripped from syncQueue entries below to avoid
 *    persisting cleartext credentials (active credentials are reattached at replay time).
 * 2. clearOfflineStorage() is invoked on user logout (AuthContext.jsx) to wipe all
 *    IndexedDB stores and prevent post-session forensic data extraction.
 * 3. Future recommendation: encrypt request.data using the Web Crypto API with an
 *    in-memory session key if offline queuing of sensitive PII must be protected at rest.
 */

// Sync Queue Operations
export const addToSyncQueue = async (request) => {
  const db = await initDB();
  
  // Sanitize headers to ensure session tokens/credentials are not persisted to disk
  const safeHeaders = { ...(request.headers || {}) };
  delete safeHeaders.Authorization;
  delete safeHeaders.authorization;
  delete safeHeaders.Cookie;
  delete safeHeaders.cookie;
  delete safeHeaders['x-auth-token'];
  delete safeHeaders['X-Auth-Token'];

  return db.add('syncQueue', {
    url: request.url,
    method: request.method,
    data: request.data,
    params: request.params,
    headers: safeHeaders,
    timestamp: Date.now(),
  });
};

export const getSyncQueue = async () => {
  const db = await initDB();
  return db.getAll('syncQueue');
};

export const removeSyncQueueItem = async (id) => {
  const db = await initDB();
  return db.delete('syncQueue', id);
};

export const getSyncQueueCount = async () => {
  const db = await initDB();
  return db.count('syncQueue');
};

/**
 * Data Caching Operations (for application-level offline read caching).
 * NOTE: 'shipments' and 'orders' would store recipient details locally, and
 * clearOfflineStorage() clears them along with everything else on logout.
 * Nothing calls these two functions today, so those stores are never written -
 * the only store this module populates is 'syncQueue', and that is the one the
 * logout purge actually has to remove.
 */
export const cacheData = async (storeName, data) => {
  const db = await initDB();
  const tx = db.transaction(storeName, 'readwrite');
  if (Array.isArray(data)) {
    await Promise.all(data.map(item => tx.store.put(item)));
  } else {
    await tx.store.put(data);
  }
  await tx.done;
};

export const getCachedData = async (storeName) => {
  const db = await initDB();
  return db.getAll(storeName);
};

// Clear sensitive offline data stores
export const clearOfflineStorage = async () => {
  try {
    const db = await initDB();
    for (const store of Array.from(db.objectStoreNames)) {
      await db.clear(store);
    }
  } catch (e) {
    console.error('Failed to clear offline storage:', e);
  }
};

