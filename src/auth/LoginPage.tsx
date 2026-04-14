import { useState } from 'react'
import { useAuth } from './AuthContext'
import { getGoogleStartUrl, registerRequest, resendVerificationRequest } from './authApi'
import './login.css'

export default function LoginPage() {
  const { login, loginWithVerificationToken } = useAuth()
  const [mode, setMode] = useState<'login' | 'register' | 'verify'>('login')
  const [planCode, setPlanCode] = useState<'free' | 'pro'>('free')
  const [tenantName, setTenantName] = useState('')
  const [tenantNip, setTenantNip] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [verificationToken, setVerificationToken] = useState('')
  const [devTokenHint, setDevTokenHint] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setOk(null)
    setLoading(true)
    try {
      if (mode === 'login') {
        await login(email.trim(), password)
      } else if (mode === 'register') {
        const reg = await registerRequest({
          tenantName: tenantName.trim(),
          tenantNip: tenantNip.trim() || null,
          email: email.trim(),
          password,
          planCode,
        })
        setMode('verify')
        setOk('Konto utworzone. Potwierdź e-mail, aby aktywować dostęp.')
        setDevTokenHint(reg.verificationToken ?? null)
      } else {
        await loginWithVerificationToken(verificationToken.trim())
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się zalogować.')
    } finally {
      setLoading(false)
    }
  }

  const onGoogle = async () => {
    setError(null)
    try {
      const url = await getGoogleStartUrl(mode === 'register' ? 'register' : 'login')
      window.location.href = url
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google OAuth niedostępny.')
    }
  }

  const onResend = async () => {
    setError(null)
    setOk(null)
    setLoading(true)
    try {
      const data = await resendVerificationRequest(email.trim())
      setOk('Wysłano ponownie link weryfikacyjny.')
      setDevTokenHint(data.verificationToken ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się wysłać ponownie.')
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

        <div className="login-tabs" role="tablist" aria-label="Tryb logowania">
          <button type="button" className={`login-tab ${mode === 'login' ? 'is-active' : ''}`} onClick={() => setMode('login')}>
            Logowanie
          </button>
          <button type="button" className={`login-tab ${mode === 'register' ? 'is-active' : ''}`} onClick={() => setMode('register')}>
            Rejestracja
          </button>
          <button type="button" className={`login-tab ${mode === 'verify' ? 'is-active' : ''}`} onClick={() => setMode('verify')}>
            Weryfikacja
          </button>
        </div>

        <form className="login-form" onSubmit={onSubmit} noValidate>
          {mode === 'register' && (
            <>
              <label className="login-field">
                <span className="login-field__label">Nazwa firmy</span>
                <input className="login-input" required value={tenantName} onChange={(e) => setTenantName(e.target.value)} disabled={loading} />
              </label>
              <label className="login-field">
                <span className="login-field__label">NIP (opcjonalnie)</span>
                <input className="login-input" value={tenantNip} onChange={(e) => setTenantNip(e.target.value)} disabled={loading} />
              </label>
              <label className="login-field">
                <span className="login-field__label">Plan</span>
                <select className="login-input" value={planCode} onChange={(e) => setPlanCode(e.target.value as 'free' | 'pro')} disabled={loading}>
                  <option value="free">Free - do 15 faktur / miesiąc</option>
                  <option value="pro">Pro - bez limitu, 99 zł / miesiąc</option>
                </select>
              </label>
            </>
          )}
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
          {mode !== 'verify' ? (
            <label className="login-field">
              <span className="login-field__label">Hasło</span>
              <input
                className="login-input"
                name="password"
                type="password"
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
              />
            </label>
          ) : (
            <label className="login-field">
              <span className="login-field__label">Token weryfikacyjny</span>
              <input
                className="login-input"
                name="verificationToken"
                required
                value={verificationToken}
                onChange={(e) => setVerificationToken(e.target.value)}
                disabled={loading}
              />
            </label>
          )}

          {error && (
            <p className="login-error" role="alert">
              {error}
            </p>
          )}
          {ok && <p className="login-ok">{ok}</p>}
          {devTokenHint && mode === 'verify' && (
            <p className="login-dev-token">
              DEV token: <code>{devTokenHint}</code>
            </p>
          )}

          <button type="submit" className="login-submit" disabled={loading}>
            {loading ? 'Przetwarzanie…' : mode === 'login' ? 'Zaloguj się' : mode === 'register' ? 'Utwórz konto' : 'Zweryfikuj i zaloguj'}
          </button>
          {mode === 'verify' && (
            <button type="button" className="login-secondary" onClick={onResend} disabled={loading || !email.trim()}>
              Wyślij ponownie e-mail weryfikacyjny
            </button>
          )}
          <button type="button" className="login-google" onClick={onGoogle} disabled={loading}>
            Kontynuuj przez Google
          </button>
        </form>
      </div>
    </div>
  )
}
