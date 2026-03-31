import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { clearStoredToken, getStoredToken, setStoredToken } from './session'
import { loginRequest, logoutRequest, sessionRequest } from './authApi'

export type AuthUser = { email: string }

type AuthStatus = 'checking' | 'guest' | 'authed'

type AuthContextValue = {
  status: AuthStatus
  user: AuthUser | null
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('checking')
  const [user, setUser] = useState<AuthUser | null>(null)

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      const token = getStoredToken()
      if (!token) {
        if (!cancelled) setStatus('guest')
        return
      }
      try {
        const s = await sessionRequest(token)
        if (cancelled) return
        if (s.valid && s.email) {
          setUser({ email: s.email })
          setStatus('authed')
        } else {
          clearStoredToken()
          setStatus('guest')
        }
      } catch {
        if (!cancelled) {
          clearStoredToken()
          setStatus('guest')
        }
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const trimmed = email.trim()
    const data = await loginRequest(trimmed, password)
    setStoredToken(data.accessToken)
    setUser({ email: data.email })
    setStatus('authed')
  }, [])

  const logout = useCallback(async () => {
    const token = getStoredToken()
    if (token) await logoutRequest(token)
    clearStoredToken()
    setUser(null)
    setStatus('guest')
  }, [])

  const value = useMemo(
    () => ({
      status,
      user,
      login,
      logout,
    }),
    [status, user, login, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// useAuth musi być w tym samym pliku co provider (Fast Refresh).
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth musi być użyte wewnątrz AuthProvider')
  return ctx
}
