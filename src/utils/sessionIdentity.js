/**
 * Which session an offline mutation belongs to.
 *
 * The offline queue is a device-local copy of a request body, and a replay runs
 * under whatever session is current when the device reconnects. That is the right
 * outcome for the user who queued it and the wrong one for everybody else: on a
 * shared device, or after a session expires without an explicit logout, user A's
 * queued `POST /api/shipments` would go out with user B's cookie.
 *
 * So the identity that queued an entry is stamped onto the entry
 * (`src/utils/offlineStorage.js`), and the replay compares it against the session
 * that is about to send it (`src/utils/syncQueue.js`). A mismatch is not sent.
 * `AuthContext.jsx` re-runs the same comparison at login, the moment the identity
 * on the device changes, so foreign entries are discarded at the boundary instead
 * of waiting for a reconnect.
 *
 * The identity is read from `user_data` - the same copy of `/api/auth/me` that
 * `AuthContext.jsx` writes on every successful validation and removes when the
 * session ends - so a stamp and a comparison can never disagree about who the
 * current user is. `login()` deliberately does not clear the queue: entries the
 * returning user queued themselves still replay, which is what "will sync when
 * you are back online" promised them.
 */

const USER_DATA_KEY = 'user_data';

/** The fields that identify a session, most specific first. */
const IDENTITY_FIELDS = ['id', 'user_id', 'username', 'email'];

const storage = () => (typeof localStorage === 'undefined' ? null : localStorage);

const readUserData = () => {
  const store = storage();
  if (!store) {
    return null;
  }

  try {
    const raw = store.getItem(USER_DATA_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

/**
 * `user:7`: a stable name for the session a user object describes, or null when
 * the object says nothing that identifies anyone. The field is part of the value
 * so an account whose id is 7 can never collide with a username of "7".
 */
export const identityOfUser = (user) => {
  if (!user || typeof user !== 'object') {
    return null;
  }

  for (const field of IDENTITY_FIELDS) {
    const value = user[field];
    if (value === undefined || value === null) {
      continue;
    }

    const text = String(value).trim();
    if (text) {
      return `${field}:${text}`;
    }
  }

  return null;
};

/** The session this device is currently signed in as, or null when it cannot tell. */
export const currentSessionIdentity = () => identityOfUser(readUserData());

/**
 * True when the entry was queued by the session that is current right now.
 *
 * An entry with no stamp is treated as unknown rather than as somebody else's:
 * it is a queue written by a build of this app that predates stamping, and
 * throwing those away on the spot would destroy a user's saved work for a defect
 * they never had. They are still discarded at the next login, because a login
 * establishes a session that is provably not the one they were queued under.
 */
export const isQueuedUnderCurrentSession = (entry) =>
  (entry?.sessionIdentity ?? null) === currentSessionIdentity();
