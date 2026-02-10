import { createContext, useState, useContext, useEffect } from 'react'

const AuthContext = createContext(null)

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
      const response = await fetch('http://localhost:8000/api/auth/me', {
        credentials: 'include',
      })
      
      if (response.ok) {
        const data = await response.json()
        setUser(data)
        localStorage.setItem('user_data', JSON.stringify(data))
      } else {
        // Session expired or invalid
        setUser(null)
        localStorage.removeItem('user_data')
      }
    } catch (error) {
      console.error('Auth check failed:', error)
      // On network error, keep cached user (don't kick them out)
    } finally {
      setLoading(false)
    }
  }

  const login = async (username, password, rememberMe = false) => {
    const formData = new FormData()
    formData.append('username', username)
    formData.append('password', password)
    formData.append('remember_me', rememberMe)

    const response = await fetch('http://localhost:8000/api/auth/login', {
      method: 'POST',
      credentials: 'include', // Accept cookies
      body: formData,
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.detail || 'Login failed')
    }

    const data = await response.json()
    // Save to storage and state immediately
    localStorage.setItem('user_data', JSON.stringify(data))
    
    // Validate session in background
    await validateSession()
    return data
  }

  const logout = async () => {
    try {
      await fetch('http://localhost:8000/api/auth/logout', {
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
