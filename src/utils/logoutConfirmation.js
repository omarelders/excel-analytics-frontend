/**
 * Asks before a logout destroys work the user cannot get back.
 *
 * `AuthContext.logout()` ends the session and then calls `clearOfflineStorage()`,
 * which wipes the pending sync queue. Those entries are whole request bodies -
 * recipient addresses, phone numbers, the payload of a POST/PUT that never
 * reached the server - and they cannot be replayed later, because a replay runs
 * under the session that queued them and this logout is ending it. Clearing them
 * is the right call: leaving them on disk past the session is the cleartext PII
 * `clearOfflineStorage()` exists to remove, and a queue that outlived its
 * session would deliver one user's writes as the next user's. But the loss is
 * something only the user can weigh, so the count is read first and they are
 * asked.
 *
 * Cancelling changes nothing. The session, the queue, Web Storage and every
 * cache stay exactly as they were - the same inertness `logout()` itself now has
 * when the server refuses to end the session.
 */
import { getSyncQueueCount } from './offlineStorage'

/**
 * What the user is told is about to be destroyed. `count` comes from
 * `getSyncQueueCount()`, so it is the number of mutations that really are
 * queued, not an estimate.
 */
export const unsyncedWorkWarning = (count) =>
  `${count} change${count === 1 ? '' : 's'} saved on this device ${count === 1 ? 'has' : 'have'} not reached the server yet.\n\n` +
  'Signing out deletes them permanently; they cannot be sent later. Sign out anyway?'

/**
 * Reads the pending count, asks when there is anything to lose, and only then
 * logs out.
 *
 * `ask` and `pendingCount` are parameters so a test can drive this against the
 * real `getSyncQueueCount` and the real `logout()`; the defaults are what the
 * page uses - `window.confirm`, the same affordance the delete-file button in
 * PaymentProcessing.jsx already confirms with.
 *
 * Returns `'cancelled'` when the user declined, in which case nothing was
 * erased and no request was sent, or `'logged-out'` once the purge has run. A
 * queue that cannot be read is an error rather than a silent pass: proceeding
 * would destroy work this call could not account for.
 */
export const confirmLogout = async ({
  logout,
  pendingCount = getSyncQueueCount,
  ask = (message) => window.confirm(message),
}) => {
  const pending = await pendingCount()

  if (pending > 0 && !ask(unsyncedWorkWarning(pending))) {
    return 'cancelled'
  }

  await logout()
  return 'logged-out'
}
