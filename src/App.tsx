import { useCallback, useEffect, useState } from 'react'
import { AuthProvider, useAuth } from './auth/AuthContext'
import LoginPage from './auth/LoginPage'
import DashboardApp from './DashboardApp'
import { AppErrorBoundary } from './components/app/AppErrorBoundary'
import LandingPage from './landing/LandingPage'
import { PlaceholderLegalPage } from './legal/PlaceholderLegalPage'
import './index.css'

type GuestRoute = 'landing' | 'login' | 'register' | 'verify' | 'legal_terms' | 'legal_privacy'

function resolveGuestRoute(pathname: string): GuestRoute {
  if (pathname === '/login') return 'login'
  if (pathname === '/register') return 'register'
  if (pathname === '/verify') return 'verify'
  if (pathname === '/legal/regulamin') return 'legal_terms'
  if (pathname === '/legal/polityka-prywatnosci') return 'legal_privacy'
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

  const navigateLegal = useCallback((target: 'terms' | 'privacy') => {
    const path = target === 'terms' ? '/legal/regulamin' : '/legal/polityka-prywatnosci'
    if (window.location.pathname !== path) {
      window.history.pushState(null, '', path)
    }
    setGuestRoute(target === 'terms' ? 'legal_terms' : 'legal_privacy')
  }, [])

  const navigateLanding = useCallback(() => {
    if (window.location.pathname !== '/') {
      window.history.pushState(null, '', '/')
    }
    setGuestRoute('landing')
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
      return <LandingPage onNavigateAuth={navigateGuestRoute} onNavigateLegal={navigateLegal} />
    }
    if (guestRoute === 'legal_terms') {
      return <PlaceholderLegalPage kind="terms" onBack={navigateLanding} />
    }
    if (guestRoute === 'legal_privacy') {
      return <PlaceholderLegalPage kind="privacy" onBack={navigateLanding} />
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
