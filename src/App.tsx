import { useCallback, useEffect, useState } from 'react'
import { AuthProvider, useAuth } from './auth/AuthContext'
import LoginPage from './auth/LoginPage'
import DashboardApp from './DashboardApp'
import { AppErrorBoundary } from './components/app/AppErrorBoundary'
import LandingPage from './landing/LandingPage'
import './index.css'

type GuestRoute = 'landing' | 'login' | 'register'

function resolveGuestRoute(pathname: string): GuestRoute {
  if (pathname === '/login') return 'login'
  if (pathname === '/register') return 'register'
  return 'landing'
}

function AuthGate() {
  const { status } = useAuth()
  const [guestRoute, setGuestRoute] = useState<GuestRoute>(() => resolveGuestRoute(window.location.pathname))

  useEffect(() => {
    const onPopState = () => setGuestRoute(resolveGuestRoute(window.location.pathname))
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const navigateGuestRoute = useCallback((target: 'login' | 'register') => {
    const path = target === 'login' ? '/login' : '/register'
    if (window.location.pathname !== path) {
      window.history.pushState(null, '', path)
    }
    setGuestRoute(target)
  }, [])

  if (status === 'checking') {
    return (
      <div className="auth-splash" role="status" aria-live="polite">
        <div className="auth-splash__spinner" aria-hidden />
        <p className="auth-splash__text">Sprawdzanie sesji…</p>
      </div>
    )
  }

  if (status === 'guest') {
    if (guestRoute === 'landing') {
      return <LandingPage onNavigateAuth={navigateGuestRoute} />
    }
    return <LoginPage initialMode={guestRoute} />
  }

  return <DashboardApp />
}

export default function App() {
  return (
    <AppErrorBoundary>
      <AuthProvider>
        <AuthGate />
      </AuthProvider>
    </AppErrorBoundary>
  )
}
