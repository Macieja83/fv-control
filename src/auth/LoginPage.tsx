import { useState } from 'react'
import { useAuth } from './AuthContext'
import './login.css'

export default function LoginPage() {
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await login(email.trim(), password)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się zalogować.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-card" role="main" aria-labelledby="login-title">
        <div className="login-card__brand">
          <span className="login-card__logo" aria-hidden />
          <div>
            <h1 id="login-title" className="login-card__title">
              FV Resta
            </h1>
            <p className="login-card__subtitle">Bezpieczne logowanie · Invoice Inbox</p>
          </div>
        </div>

        <form className="login-form" onSubmit={onSubmit} noValidate>
          <label className="login-field">
            <span className="login-field__label">E-mail</span>
            <input
              className="login-input"
              name="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
            />
          </label>
          <label className="login-field">
            <span className="login-field__label">Hasło</span>
            <input
              className="login-input"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
            />
          </label>

          {error && (
            <p className="login-error" role="alert">
              {error}
            </p>
          )}

          <button type="submit" className="login-submit" disabled={loading}>
            {loading ? 'Logowanie…' : 'Zaloguj się'}
          </button>
        </form>
      </div>
    </div>
  )
}
