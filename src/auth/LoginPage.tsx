import { useEffect, useRef, useState } from 'react'
import { useAuth } from './AuthContext'
import {
  forgotPasswordRequest,
  getGoogleStartUrl,
  registerRequest,
  resendVerificationRequest,
} from './authApi'
import './login.css'

type PageMode = 'login' | 'register' | 'verify' | 'forgot' | 'reset'

type LoginPageProps = {
  initialMode?: 'login' | 'register' | 'verify' | 'forgot'
  onNavigateForgot?: () => void
  onNavigateLogin?: () => void
  /** Powrót na landing (/) — logowanie, rejestracja, weryfikacja, reset hasła. */
  onNavigateHome?: () => void
}

function readInitialModeFromUrl(prop: LoginPageProps['initialMode']): PageMode {
  const q = new URLSearchParams(window.location.search)
  if (q.get('pwd_reset')?.trim()) return 'reset'
  return prop ?? 'login'
}

export default function LoginPage({
  initialMode = 'login',
  onNavigateForgot,
  onNavigateLogin,
  onNavigateHome,
}: LoginPageProps) {
  const { login, loginWithVerificationToken, loginAfterPasswordReset } = useAuth()
  const [mode, setMode] = useState<PageMode>(() => readInitialModeFromUrl(initialMode))
  const [resetFlowToken] = useState(() => new URLSearchParams(window.location.search).get('pwd_reset')?.trim() ?? '')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const skipInitialModeSync = useRef(!!new URLSearchParams(window.location.search).get('pwd_reset')?.trim())

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

  useEffect(() => {
    const url = new URL(window.location.href)
    if (url.searchParams.has('pwd_reset')) {
      url.searchParams.delete('pwd_reset')
      const s = url.searchParams.toString()
      window.history.replaceState(null, '', `${url.pathname}${s ? `?${s}` : ''}`)
    }
  }, [])

  useEffect(() => {
    if (skipInitialModeSync.current) {
      skipInitialModeSync.current = false
      return
    }
    setMode(initialMode ?? 'login')
  }, [initialMode])

  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    if (q.get('verify_pending') === '1') {
      setMode('verify')
      setOk('Konto utworzone. Otwórz skrzynkę e-mail i kliknij link aktywacyjny (także po rejestracji przez Google).')
      const url = new URL(window.location.href)
      url.searchParams.delete('verify_pending')
      const search = url.searchParams.toString()
      window.history.replaceState(null, '', `${url.pathname}${search ? `?${search}` : ''}`)
    }
    const oauthErr = q.get('oauth_error')
    if (oauthErr) {
      setError(oauthErr)
      const url = new URL(window.location.href)
      url.searchParams.delete('oauth_error')
      const search = url.searchParams.toString()
      window.history.replaceState(null, '', `${url.pathname}${search ? `?${search}` : ''}`)
    }
  }, [])

  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const tokenFromUrl = q.get('token')?.trim() ?? ''
    if (!tokenFromUrl) return
    setMode('verify')
    setVerificationToken(tokenFromUrl)
    setError(null)
    setOk('Wykryto token z linku weryfikacyjnego. Potwierdzanie konta…')
    setLoading(true)
    void loginWithVerificationToken(tokenFromUrl)
      .then(() => {
        setOk('E-mail został potwierdzony. Logowanie…')
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Nie udało się zweryfikować tokenu z linku.')
      })
      .finally(() => {
        setLoading(false)
      })
  }, [loginWithVerificationToken])

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setOk(null)
    setLoading(true)
    try {
      if (mode === 'forgot') {
        const fp = await forgotPasswordRequest(email.trim())
        setOk(
          'Jeśli konto z tym adresem istnieje i ma ustawione hasło, wyślemy wiadomość z linkiem do resetu (sprawdź także folder Spam).',
        )
        setDevTokenHint(import.meta.env.DEV ? (fp.resetToken ?? null) : null)
      } else if (mode === 'reset') {
        if (!resetFlowToken) {
          setError('Brak tokenu resetu. Otwórz link z e-maila ponownie.')
          return
        }
        if (newPassword !== confirmPassword) {
          setError('Hasła muszą być takie same.')
          return
        }
        await loginAfterPasswordReset(resetFlowToken, newPassword)
      } else if (mode === 'login') {
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
        setDevTokenHint(import.meta.env.DEV ? (reg.verificationToken ?? null) : null)
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
      setDevTokenHint(import.meta.env.DEV ? (data.verificationToken ?? null) : null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się wysłać ponownie.')
    } finally {
      setLoading(false)
    }
  }

  const showTabs = mode !== 'forgot' && mode !== 'reset'
  const title =
    mode === 'forgot' ? 'Reset hasła' : mode === 'reset' ? 'Nowe hasło' : 'FV Resta'

  return (
    <div className="login-page">
      <div className="login-card" role="main" aria-labelledby="login-title">
        {onNavigateHome && (
          <button type="button" className="login-back-home" onClick={onNavigateHome} aria-label="Powrót na stronę główną">
            ← Strona główna
          </button>
        )}
        <div className="login-card__brand">
          <span className="login-card__logo" aria-hidden />
          <div>
            <h1 id="login-title" className="login-card__title">
              {title}
            </h1>
            <p className="login-card__subtitle">Bezpieczne logowanie · Invoice Inbox</p>
          </div>
        </div>

        {showTabs && (
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
        )}

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
                  <option value="pro">Pro - bez limitu, 59 zł / miesiąc</option>
                </select>
              </label>
            </>
          )}

          {mode === 'forgot' && (
            <p className="login-google-hint" style={{ marginBottom: '0.75rem' }}>
              Podaj adres e-mail konta. Wyślemy link ważny ok. 1 godziny (tylko jeśli konto ma ustawione hasło — logowanie e-mailem).
            </p>
          )}

          {(mode === 'login' || mode === 'register' || mode === 'verify' || mode === 'forgot') && (
            <label className="login-field">
              <span className="login-field__label">E-mail</span>
              <input
                className="login-input"
                name="email"
                type="email"
                autoComplete="username"
                required={mode !== 'verify'}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
              />
            </label>
          )}

          {mode === 'reset' && (
            <>
              <label className="login-field">
                <span className="login-field__label">Nowe hasło</span>
                <input
                  className="login-input"
                  name="newPassword"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  disabled={loading}
                />
              </label>
              <label className="login-field">
                <span className="login-field__label">Powtórz hasło</span>
                <input
                  className="login-input"
                  name="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={loading}
                />
              </label>
            </>
          )}

          {(mode === 'login' || mode === 'register') && (
            <label className="login-field">
              <span className="login-field__label">Hasło{mode === 'register' ? ' (min. 8 znaków)' : ''}</span>
              <input
                className="login-input"
                name="password"
                type="password"
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                required
                minLength={mode === 'register' ? 8 : undefined}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
              />
            </label>
          )}

          {mode === 'verify' && (
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
          {import.meta.env.DEV && devTokenHint && (mode === 'verify' || mode === 'forgot') && (
            <p className="login-dev-token">
              DEV token (tylko lokalnie): <code>{devTokenHint}</code>
            </p>
          )}

          <button type="submit" className="login-submit" disabled={loading}>
            {loading
              ? 'Przetwarzanie…'
              : mode === 'login'
                ? 'Zaloguj się'
                : mode === 'register'
                  ? 'Utwórz konto'
                  : mode === 'verify'
                    ? 'Zweryfikuj i zaloguj'
                    : mode === 'forgot'
                      ? 'Wyślij link resetujący'
                      : 'Ustaw hasło i zaloguj'}
          </button>

          {mode === 'login' && onNavigateForgot && (
            <button type="button" className="login-secondary" onClick={onNavigateForgot} disabled={loading}>
              Zapomniałeś hasła?
            </button>
          )}

          {mode === 'forgot' && onNavigateLogin && (
            <button type="button" className="login-secondary" onClick={onNavigateLogin} disabled={loading}>
              Powrót do logowania
            </button>
          )}

          {mode === 'reset' && onNavigateLogin && (
            <button type="button" className="login-secondary" onClick={onNavigateLogin} disabled={loading}>
              Anuluj — wróć do logowania
            </button>
          )}

          {mode === 'verify' && (
            <button type="button" className="login-secondary" onClick={onResend} disabled={loading || !email.trim()}>
              Wyślij ponownie e-mail weryfikacyjny
            </button>
          )}

          {(mode === 'login' || mode === 'register') && (
            <button type="button" className="login-google" onClick={onGoogle} disabled={loading}>
              Kontynuuj przez Google
            </button>
          )}
          {(mode === 'login' || mode === 'register') && (
            <p className="login-google-hint">
              Po pierwszym logowaniu przez Google możesz ustawić hasło w <strong>Ustawieniach</strong>, żeby logować się także e-mailem.
            </p>
          )}
        </form>
      </div>
    </div>
  )
}
