import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { clearStoredToken, getStoredToken, setStoredToken } from './session'
import {
  loginRequest,
  logoutRequest,
  resetPasswordRequest,
  sessionRequest,
  verifyEmailRequest,
} from './authApi'

export type AuthUser = {
  email: string
  tenantId: string
  emailVerified: boolean
  /** false — konto tylko Google; ustaw hasło w Ustawieniach, by móc logować się e-mailem. */
  hasPassword: boolean
  /** Konto operatora platformy — zakładka Admin, API /platform-admin/*. */
  isPlatformAdmin: boolean
  tenantName?: string | null
  impersonation?: {
    active: true
    effectiveTenantId: string
    effectiveTenantName: string | null
    effectiveTenantNip?: string | null
  } | null
}

type AuthStatus = 'checking' | 'guest' | 'authed'

type AuthContextValue = {
  status: AuthStatus
  user: AuthUser | null
  login: (email: string, password: string) => Promise<void>
  loginWithVerificationToken: (token: string) => Promise<void>
  /** Po ustawieniu hasła z linku e-mail (reset). */
  loginAfterPasswordReset: (token: string, password: string) => Promise<void>
  logout: () => Promise<void>
  /** Odświeża /auth/me (np. po ustawieniu hasła). */
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('checking')
  const [user, setUser] = useState<AuthUser | null>(null)

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      if (typeof window !== 'undefined' && window.location.hash.startsWith('#fv_oauth=')) {
        try {
          const raw = decodeURIComponent(window.location.hash.slice('#fv_oauth='.length))
          const parsed = JSON.parse(raw) as { accessToken?: string }
          if (parsed.accessToken) {
            setStoredToken(parsed.accessToken)
            const url = new URL(window.location.href)
            url.hash = ''
            window.history.replaceState(null, '', url.pathname + url.search)
          }
        } catch {
          /* ignore malformed oauth hash */
        }
      }

      const token = getStoredToken()
      if (!token) {
        if (!cancelled) setStatus('guest')
        return
      }
      try {
        const s = await sessionRequest(token)
        if (cancelled) return
        if (s.valid && s.user) {
          setUser(s.user)
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
    setUser(data.user)
    setStatus('authed')
  }, [])

  const loginWithVerificationToken = useCallback(async (token: string) => {
    const data = await verifyEmailRequest(token)
    setStoredToken(data.accessToken)
    setUser(data.user)
    setStatus('authed')
  }, [])

  const loginAfterPasswordReset = useCallback(async (token: string, password: string) => {
    const data = await resetPasswordRequest(token, password)
    setStoredToken(data.accessToken)
    setUser(data.user)
    setStatus('authed')
  }, [])

  const logout = useCallback(async () => {
    const token = getStoredToken()
    if (token) await logoutRequest(token)
    clearStoredToken()
    setUser(null)
    setStatus('guest')
  }, [])

  const refreshUser = useCallback(async () => {
    const token = getStoredToken()
    if (!token) return
    try {
      const s = await sessionRequest(token)
      if (s.valid && s.user) setUser(s.user)
    } catch {
      /* ignore */
    }
  }, [])

  const value = useMemo(
    () => ({
      status,
      user,
      login,
      loginWithVerificationToken,
      loginAfterPasswordReset,
      logout,
      refreshUser,
    }),
    [status, user, login, loginWithVerificationToken, loginAfterPasswordReset, logout, refreshUser],
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
