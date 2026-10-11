/**
 * Replay for the offline mutation queue, and the state the offline indicator shows.
 *
 * `src/api.js` queues a mutation while the device is offline and tells the user it will
 * sync when they are back online. That promise is kept here: the 'online' event drives
 * `flushSyncQueue()` through the real `api` instance, so the queued request goes out on
 * the same interceptors, credentials and base URL it was queued with. Only the entry's
 * bookkeeping is new - attempts, backoff, and a terminal state - because an entry that
 * can never succeed must stop being retried forever and be shown to the user instead.
 *
 * `addToSyncQueue()` still runs before a request is sent, and `clearOfflineStorage()`
 * still wipes the queue on logout: the queue is a device-local copy of a mutation,
 * and a replay runs under the session that is current when it goes out. Each entry is
 * stamped with the session that queued it (`src/utils/sessionIdentity.js`), and a
 * replay that would carry a different session's cookie is refused here rather than
 * sent - so a logout is not the only thing standing between one user's queued body
 * and another user's session.
 */
import api from '../api';
import { isQueuedUnderCurrentSession } from './sessionIdentity';
import {
  MAX_SYNC_ATTEMPTS,
  RETRY_BACKOFF_BASE_MS,
  RETRY_BACKOFF_MAX_MS,
  fromQueueablePayload,
  getFailedSyncQueueItems,
  getPendingSyncQueueCount,
  getSyncQueue,
  removeSyncQueueItem,
  updateSyncQueueItem,
} from './offlineStorage';

const isOnline = () => Boolean(navigator.onLine);

/** How long to leave an entry alone after its latest attempt. */
export const syncRetryDelay = (attempts) =>
  Math.min(RETRY_BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1), RETRY_BACKOFF_MAX_MS);

/** "POST /upload", the way the queue is shown back to the user. */
export const describeQueuedRequest = (entry) => `${String(entry.method ?? 'GET').toUpperCase()} ${entry.url}`;

/**
 * What the user reads when an entry has spent its attempts. A silent entry in the queue
 * is the other half of the original defect: it looked pending forever while nothing was
 * going to send it.
 */
export const syncFailureNotice = (failures) => {
  if (failures.length === 0) {
    return '';
  }

  const detail = failures
    .map((entry) => `${describeQueuedRequest(entry)} after ${entry.attempts} attempts`)
    .join('; ');
  const saved = 'It is still saved on this device and has not reached the server.';

  return failures.length === 1
    ? `1 change could not be sent (${detail}). ${saved}`
    : `${failures.length} changes could not be sent (${detail}). ${saved}`;
};

/** What a queue entry is waiting on: ready to send, out of time, or spent for good. */
export const retryDecision = (entry, now) => {
  const attempts = entry.attempts ?? 0;

  if (entry.failed === true || attempts >= MAX_SYNC_ATTEMPTS) {
    return 'exhausted';
  }
  const lastAttemptAt = entry.lastAttemptAt;
  if (Number.isFinite(lastAttemptAt) && now - lastAttemptAt < syncRetryDelay(attempts)) {
    return 'waiting';
  }
  return 'ready';
};

const describeRequestError = (error) => {
  if (typeof error === 'string') {
    return error;
  }
  if (typeof error?.detail === 'string' && error.detail) {
    return error.detail;
  }
  if (typeof error?.message === 'string' && error.message) {
    return error.message;
  }
  return 'the server could not be reached';
};

/** The request an entry replays as, with its FormData body rebuilt from what was stored. */
const sendQueuedRequest = (entry) =>
  api.request({
    method: entry.method,
    url: entry.url,
    data: fromQueueablePayload(entry.data),
    params: entry.params,
    headers: entry.headers,
    // Bypasses the offline interceptor: a queue entry is replayed on purpose.
    _isSyncRequest: true,
  });

/**
 * Walks the queue once and sends whatever is due.
 *
 * An entry that succeeds is removed; one that fails is left in place with a later retry
 * time; one that has now had MAX_SYNC_ATTEMPTS is marked spent and reported back rather
 * than attempted again. A device that is offline is not an attempt: nothing was sent, so
 * burning an attempt on it would exhaust a queue entry the moment it is created.
 *
 * An entry stamped with another session's identity is dropped rather than sent: a
 * replay carries the current session's cookie, so it would deliver that user's
 * writes as whoever is signed in now.
 */
export const flushSyncQueue = (options = {}) => exclusively(() => flushOnce(options));

async function flushOnce({ online = isOnline, now = Date.now, send = sendQueuedRequest } = {}) {
  if (!online()) {
    return { sent: 0, deferred: 0, dropped: 0, failures: [], skipped: 'offline' };
  }

  publish({ isSyncing: true });

  const queue = await getSyncQueue();
  const sent = [];
  const failures = [];
  const dropped = [];
  let deferred = 0;

  try {
    for (const entry of queue) {
      // Before anything else: an entry stamped with another session's identity is
      // not this session's to send. The replay would carry the current cookie, so
      // it would post the previous user's body as whoever is signed in now - the
      // cross-user replay the queue exists to prevent. Dropped, not left looking
      // pending: nothing on this device will ever send it again, and the indicator
      // must not advertise a sync that cannot happen.
      if (!isQueuedUnderCurrentSession(entry)) {
        await removeSyncQueueItem(entry.id);
        dropped.push(entry);
        continue;
      }

      const decision = retryDecision(entry, now());

      if (decision === 'exhausted') {
        if (entry.failed !== true) {
          await updateSyncQueueItem({ ...entry, failed: true });
        }
        failures.push({ ...entry, failed: true });
        continue;
      }

      if (decision === 'waiting') {
        deferred += 1;
        continue;
      }

      const attempt = { ...entry, attempts: (entry.attempts ?? 0) + 1, lastAttemptAt: now() };
      await updateSyncQueueItem(attempt);

      try {
        await send(attempt);
        sent.push(entry.id);
        await removeSyncQueueItem(entry.id);
      } catch (error) {
        await updateSyncQueueItem({
          ...attempt,
          lastError: describeRequestError(error),
          // Spent the moment its last attempt fails, so the user is told in the same
          // flush rather than in whatever happens to run next.
          failed: attempt.attempts >= MAX_SYNC_ATTEMPTS,
        });
      }
    }
  } finally {
    publish({ isSyncing: false });
  }

  await refreshSyncState();
  return { sent: sent.length, deferred, dropped: dropped.length, failures, skipped: null };
};

/**
 * One pass at a time.
 *
 * `isSyncing` is published but the queue is reached from two places that can both
 * fire: the reconnect handler, and the indicator's Sync button. Two passes read the
 * same queue, so without this guard both send the same entry, each `removeSyncQueueItem`
 * lands on a row the other pass is holding, and a financial or shipment mutation goes
 * out twice. The first caller's promise is handed to anybody who arrives while it is
 * still running, so a second caller observes the same pass instead of starting its own.
 */
let passInFlight = null;

const exclusively = async (start) => {
  if (passInFlight) {
    return passInFlight;
  }

  const pass = (async () => start())();
  passInFlight = pass;

  try {
    return await pass;
  } finally {
    passInFlight = null;
  }
};

/** Puts every spent entry back into play, for the indicator's "retry" button. */
export const retryFailedSyncQueue = (options = {}) =>
  exclusively(async () => {
    for (const entry of await getFailedSyncQueueItems()) {
      await updateSyncQueueItem({ ...entry, failed: false, attempts: 0, lastAttemptAt: null, lastError: null });
    }
    return flushOnce(options);
  });

// ---------------------------------------------------------------------------
// What the indicator shows
//
// The counts and the failure list live here rather than in the component so that a
// reconnect, a queued mutation and a completed flush all reach the user through one
// published state, and so a test can read that state without a DOM.
// ---------------------------------------------------------------------------

let syncState = { online: isOnline(), pending: 0, failures: [], isSyncing: false };
const listeners = new Set();

const publish = (patch) => {
  syncState = { ...syncState, ...patch };
  for (const listener of [...listeners]) {
    listener();
  }
};

export const getSyncState = () => syncState;

export const subscribeSyncState = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const refreshSyncState = async () => {
  const pending = await getPendingSyncQueueCount();
  const failures = await getFailedSyncQueueItems();
  publish({ pending, failures });
  return syncState;
};

/**
 * Wires the queue to the browser: reconnect flushes it, the queue-updated event keeps
 * the counts honest, and a periodic read catches a queue another tab wrote. Returns the
 * teardown the component's effect hands back to React.
 */
export const attachSyncEngine = ({ flush = flushSyncQueue, refresh = refreshSyncState, intervalMs = 5000 } = {}) => {
  const swallow = (promise) => promise.catch((error) => console.error('Offline sync error:', error));

  const handleOnline = async () => {
    publish({ online: true });
    // The reason the "will sync when you are back online" message can be made true.
    await swallow(flush());
  };
  const handleOffline = () => publish({ online: false });
  const handleQueueUpdated = () => swallow(refresh());

  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);
  window.addEventListener('sync-queue-updated', handleQueueUpdated);

  swallow(refresh());
  const interval = setInterval(() => swallow(refresh()), intervalMs);

  return () => {
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
    window.removeEventListener('sync-queue-updated', handleQueueUpdated);
    clearInterval(interval);
  };
};
