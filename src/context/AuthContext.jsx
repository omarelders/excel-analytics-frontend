import { createContext, useState, useContext, useEffect } from 'react'
import { API_BASE_URL } from '../config/apiBaseUrl'
import { clearOfflineStorage, discardSyncQueueEntriesFromOtherSessions } from '../utils/offlineStorage'
import { purgeAppCaches } from '../utils/cachePurge'

const AuthContext = createContext(null)

const parseErrorResponse = async (response, fallbackMessage) => {
  const contentType = response.headers.get('content-type') || ''

  if (contentType.includes('application/json')) {
    const payload = await response.json()
    return payload?.detail || payload?.message || fallbackMessage
  }

  const text = await response.text()
  if (text.includes('No such app')) {
    return 'API target is unavailable. Check frontend API proxy/backend URL.'
  }

  return `${fallbackMessage} (${response.status})`
}

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return context
}

export function AuthProvider({ children }) {
  // Check if we already opened the app this browser session
  const hasOpenedBefore = sessionStorage.getItem('app_opened')
  
  // Read cached user from localStorage
  const cachedUser = (() => {
    try {
      const stored = localStorage.getItem('user_data')
      return stored ? JSON.parse(stored) : null
    } catch {
      return null
    }
  })()

  // Only show loading on the VERY FIRST open (no sessionStorage flag yet)
  // If app was already opened this session, skip loading entirely
  const [user, setUser] = useState(cachedUser)
  const [loading, setLoading] = useState(!hasOpenedBefore && !cachedUser)

  // Mark that the app has been opened this session
  useEffect(() => {
    sessionStorage.setItem('app_opened', 'true')
    validateSession()
  }, [])

  // Background validation - never shows loading screen on reload
  const validateSession = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/me`, {
        credentials: 'include',
      })
      
      if (response.ok) {
        const data = await response.json()
        setUser(data)
        localStorage.setItem('user_data', JSON.stringify(data))
        return data
      } else {
        // Session expired or invalid. Removing `user_data` is also what closes the
        // implicit path into a cross-user replay: the queue stamps each entry with
        // the session that queued it, so an expired session leaves the device with
        // no identity to match and a replay refuses those entries instead of
        // sending them under whoever signs in next (src/utils/sessionIdentity.js).
        setUser(null)
        localStorage.removeItem('user_data')
        return null
      }
    } catch (error) {
      console.error('Auth check failed:', error)
      // On network error, keep cached user (don't kick them out)
      return user
    } finally {
      setLoading(false)
    }
  }

  const login = async (username, password, rememberMe = false) => {
    const formData = new FormData()
    formData.append('username', username)
    formData.append('password', password)
    formData.append('remember_me', rememberMe)

    const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
      method: 'POST',
      credentials: 'include',
      body: formData,
    })

    if (!response.ok) {
      const message = await parseErrorResponse(response, 'Login failed')
      throw new Error(message)
    }

    const data = await response.json()

    // Validate cookie-based session immediately; avoids silent login loops.
    const validatedUser = await validateSession()
    if (!validatedUser) {
      throw new Error(
        'Login succeeded but the session cookie was not persisted. Check API domain/cookie configuration.'
      )
    }

    // The identity on this device just changed, and the offline queue is stamped with
    // the session that queued each entry. An entry stamped with any other identity
    // would replay under the cookie this login just established - user A's queued
    // shipment going out as user B - so those go now, at the boundary.
    //
    // This is not `clearOfflineStorage()`: entries this user queued themselves keep
    // their stamp and still replay, which is what "will sync when you are back
    // online" promised them. Logout still wipes the store outright, because there the
    // session is over rather than replaced.
    //
    // A failure here is logged and not thrown: a device whose IndexedDB just stopped
    // answering cannot be holding queue entries, and refusing the login would leave
    // the user signed out over a session the server has already created. The replay
    // itself is what refuses a foreign entry, so it does not depend on this running.
    try {
      await discardSyncQueueEntriesFromOtherSessions()
    } catch (error) {
      console.error('Error discarding offline changes from a previous session:', error)
    }

    return data
  }

  const logout = async () => {
    let response

    try {
      response = await fetch(`${API_BASE_URL}/api/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      })
    } catch (error) {
      // The server may never have heard the request, so the cookie can still be
      // valid: keep the session and everything on disk, and let the caller say
      // so. Purging here is what used to leave the user looking logged out over
      // a live session, which the next validateSession() then re-authenticated,
      // rewriting user_data over the purge.
      console.error('Logout error:', error)
      throw new Error(
        'Logout failed: the server could not be reached, so your session is still active and nothing was erased. Please try again.'
      )
    }

    // 401 is the server stating there is no session left to destroy, so the local
    // purge can proceed. Every other status leaves the cookie valid, and
    // presenting a logged-out state over it is the failure this prevents.
    if (!response.ok && response.status !== 401) {
      throw new Error(
        `Logout failed (${response.status}): the server did not end your session, so nothing was erased. Please try again.`
      )
    }

    setUser(null)
    // Erase sensitive user and offline data
    localStorage.removeItem('user_data')
    localStorage.removeItem('authToken')
    localStorage.removeItem('contentCalendarData')
    localStorage.removeItem('ideasNotesData')
    try {
      sessionStorage.clear()
    } catch (e) {
      console.error('SessionStorage clear error:', e)
    }

    // Clear Cache Storage so customer and financial data are never retained.
    // Every cache the service worker owns is enumerated by name in
    // cachePurge.js - the workbox precache that lets the PWA boot offline is
    // preserved by not being one of them.
    await purgeAppCaches()

    // Clear offline IndexedDB data. The pending sync queue goes with it: its
    // entries are whole request bodies, and the session that would replay them
    // is the one this logout just ended. A queue that outlived the session
    // would replay this user's writes against the next user's.
    try {
      await clearOfflineStorage()
    } catch (err) {
      console.error('Error clearing offline storage:', err)
    }
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, validateSession }}>
      {children}
    </AuthContext.Provider>
  )
}
