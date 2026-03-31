import { AuthProvider, useAuth } from './auth/AuthContext'
import LoginPage from './auth/LoginPage'
import DashboardApp from './DashboardApp'
import './index.css'

function AuthGate() {
  const { status } = useAuth()

  if (status === 'checking') {
    return (
      <div className="auth-splash" role="status" aria-live="polite">
        <div className="auth-splash__spinner" aria-hidden />
        <p className="auth-splash__text">Sprawdzanie sesji…</p>
      </div>
    )
  }

  if (status === 'guest') {
    return <LoginPage />
  }

  return <DashboardApp />
}

export default function App() {
  return (
    <AuthProvider>
      <AuthGate />
    </AuthProvider>
  )
}
