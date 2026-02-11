import { createContext, useState, useContext, useEffect } from 'react'
import { API_BASE_URL } from '../config/apiBaseUrl'

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
        // Session expired or invalid
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

    return data
  }

  const logout = async () => {
    try {
      await fetch(`${API_BASE_URL}/api/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      })
    } catch (error) {
      console.error('Logout error:', error)
    } finally {
      setUser(null)
      localStorage.removeItem('user_data')
    }
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, validateSession }}>
      {children}
    </AuthContext.Provider>
  )
}
