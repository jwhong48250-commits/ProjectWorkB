import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { logout as requestLogout } from '../api/auth'
import {
  clearAuthTokens,
  ensureAuthSession,
  getRefreshToken,
  getStoredUser,
  hasStoredSession,
  setStoredUser,
  syncStoredUserFromToken,
  type StoredUser,
} from '../api/client'

interface AuthContextValue {
  user: StoredUser | null
  loading: boolean
  isAuthenticated: boolean
  isAdmin: boolean
  refreshSession: () => Promise<StoredUser | null>
  saveUser: (user: StoredUser) => void
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<StoredUser | null>(() => getStoredUser())
  const [loading, setLoading] = useState(true)

  async function refreshSession(): Promise<StoredUser | null> {
    setLoading(true)

    if (!hasStoredSession()) {
      clearAuthTokens()
      setUser(null)
      setLoading(false)
      return null
    }

    try {
      await ensureAuthSession()
      const syncedUser = syncStoredUserFromToken()
      setUser(syncedUser)
      return syncedUser
    } catch {
      clearAuthTokens()
      setUser(null)
      return null
    } finally {
      setLoading(false)
    }
  }

  function saveUser(nextUser: StoredUser) {
    setStoredUser(nextUser)
    setUser(nextUser)
  }

  async function signOut() {
    const refreshToken = getRefreshToken()

    if (refreshToken) {
      await requestLogout(refreshToken).catch(() => undefined)
    }

    clearAuthTokens()
    setUser(null)
  }

  useEffect(() => {
    void refreshSession()
  }, [])

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        isAuthenticated: Boolean(user && hasStoredSession()),
        isAdmin: user?.role === 'admin',
        refreshSession,
        saveUser,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return context
}
