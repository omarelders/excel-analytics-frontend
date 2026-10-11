import { openDB } from 'idb';
import { currentSessionIdentity, isQueuedUnderCurrentSession } from './sessionIdentity';

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
 * 3. Every queue entry is stamped with the session that queued it (see
 *    `src/utils/sessionIdentity.js`), and a replay compares the stamp with the
 *    session that is about to send it. A queued mutation therefore cannot outlive
 *    its session on a shared device: the explicit logout wipes the store, and the
 *    implicit paths (an expiry, another user logging in) are closed by the stamp
 *    rather than by a purge that would also destroy the user's own work.
 * 4. Future recommendation: encrypt request.data using the Web Crypto API with an
 *    in-memory session key if offline queuing of sensitive PII must be protected at rest.
 */

// ---------------------------------------------------------------------------
// Payloads IndexedDB can hold
// ---------------------------------------------------------------------------

/**
 * A payload this device cannot write to the queue. `src/api.js` turns this into an
 * error the user sees, because the alternative - log it and send the request while
 * offline - loses the change and lies about having saved it.
 */
export class UnqueueablePayloadError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UnqueueablePayloadError';
  }
}

/** Marks a queued payload that was a FormData before it was stored. */
const FORM_DATA_MARKER = '__offlineFormData';

const isFormData = (value) => typeof FormData !== 'undefined' && value instanceof FormData;

/** Base64 in bounded chunks: a spreadsheet upload is large enough to blow the call stack. */
const toBase64 = async (blob) => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
};

const fromBase64 = (base64) => Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));

/**
 * Converts a request body into something IndexedDB will accept.
 *
 * `FormData` is not structured-cloneable, so a `POST /upload` used to throw
 * DataCloneError out of `db.add` below. It is stored here as its fields instead:
 * strings as strings, files as base64 with their name and type, so the replay can
 * rebuild the same multipart body rather than a redacted placeholder.
 */
export const toQueueablePayload = async (data) => {
  if (!isFormData(data)) {
    return data;
  }

  const fields = [];
  for (const [name, value] of data.entries()) {
    if (typeof value === 'string') {
      fields.push({ name, kind: 'string', value });
      continue;
    }
    if (typeof Blob !== 'undefined' && value instanceof Blob) {
      fields.push({
        name,
        kind: 'file',
        filename: value.name || 'upload',
        type: value.type || '',
        size: value.size,
        data: await toBase64(value),
      });
      continue;
    }
    throw new UnqueueablePayloadError(`the "${name}" field cannot be read back on this device`);
  }

  return { [FORM_DATA_MARKER]: fields };
};

/** The body `toQueueablePayload` was given, rebuilt for the request that replays it. */
export const fromQueueablePayload = (data) => {
  if (!data || typeof data !== 'object' || !Array.isArray(data[FORM_DATA_MARKER])) {
    return data;
  }

  const form = new FormData();
  for (const field of data[FORM_DATA_MARKER]) {
    if (field.kind === 'string') {
      form.append(field.name, field.value);
      continue;
    }
    form.append(field.name, new File([fromBase64(field.data)], field.filename, { type: field.type }));
  }
  return form;
};

/**
 * Refuses up front what IndexedDB would refuse later: the structured clone algorithm
 * is the same one `db.add` runs, so a payload it rejects here is a payload that would
 * have thrown after the queue had already been promised to the user.
 */
const assertStorable = (entry) => {
  try {
    structuredClone(entry);
  } catch (error) {
    throw new UnqueueablePayloadError(`this change cannot be stored for later (${error?.name ?? 'error'})`);
  }
};

// ---------------------------------------------------------------------------
// Retry policy
//
// A queue entry that can never succeed must stop being retried. `src/utils/syncQueue.js`
// reads these to decide when an entry is spent, and `src/components/OfflineIndicator.jsx`
// shows what that leaves behind.
// ---------------------------------------------------------------------------

export const MAX_SYNC_ATTEMPTS = 5;
export const RETRY_BACKOFF_BASE_MS = 2000;
export const RETRY_BACKOFF_MAX_MS = 60000;

// Sync Queue Operations
export const addToSyncQueue = async (request) => {
  const data = await toQueueablePayload(request.data);

  // Sanitize headers to ensure session tokens/credentials are not persisted to disk
  const safeHeaders = { ...(request.headers || {}) };
  delete safeHeaders.Authorization;
  delete safeHeaders.authorization;
  delete safeHeaders.Cookie;
  delete safeHeaders.cookie;
  delete safeHeaders['x-auth-token'];
  delete safeHeaders['X-Auth-Token'];

  const entry = {
    url: request.url,
    method: request.method,
    data,
    params: request.params,
    headers: safeHeaders,
    timestamp: Date.now(),
    attempts: 0,
    lastAttemptAt: null,
    lastError: null,
    failed: false,
    // Who queued it. A replay runs under the cookie the browser sends at the time,
    // which is the current session's and not necessarily this one's - see
    // `src/utils/sessionIdentity.js`.
    sessionIdentity: currentSessionIdentity(),
  };

  assertStorable(entry);

  const db = await initDB();
  return db.add('syncQueue', entry);
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
 * Entries that are still waiting to be sent, spent ones left out. The total on disk
 * stays `getSyncQueueCount()`: a logout destroys a spent entry just as thoroughly as a
 * pending one, so `confirmLogout` warns about both.
 */
export const getPendingSyncQueueCount = async () =>
  (await getSyncQueue()).filter((entry) => entry.failed !== true).length;

/** Entries that burned MAX_SYNC_ATTEMPTS and were never sent. */
export const getFailedSyncQueueItems = async () =>
  (await getSyncQueue()).filter((entry) => entry.failed === true);

/**
 * Discards queued mutations that belong to a session other than the current one.
 *
 * A login is the moment the identity on this device changes, so it is the moment
 * to notice: an entry stamped with a different identity can never be replayed
 * under this session's cookie, and keeping it would leave one user's request
 * bodies on disk through another user's session - the cleartext PII
 * `clearOfflineStorage()` exists to remove.
 *
 * Entries the current user queued themselves are left alone, which is why this is
 * not a purge: "will sync when you are back online" has to survive a user
 * re-logging in as themselves. Returns what was discarded, so the caller can say
 * so instead of guessing.
 */
export const discardSyncQueueEntriesFromOtherSessions = async () => {
  const discarded = [];

  for (const entry of await getSyncQueue()) {
    if (isQueuedUnderCurrentSession(entry)) {
      continue;
    }
    await removeSyncQueueItem(entry.id);
    discarded.push(entry);
  }

  return discarded;
};

/**
 * Writes an entry back: the replay bookkeeping (attempt count, last error) lives on the
 * entry itself, so a browser restart resumes the policy rather than resetting it.
 */
export const updateSyncQueueItem = async (entry) => {
  const db = await initDB();
  return db.put('syncQueue', entry);
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

