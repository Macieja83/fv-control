import { Component, type ErrorInfo, type ReactNode } from 'react'
import '../error/error.css'

type Props = {
  children: ReactNode
}

type State = {
  hasError: boolean
  error: Error | null
}

const AUTO_REFRESH_KEY = 'fv-control:error130:auto-refreshed'
const SUPPORT_EMAIL =
  typeof import.meta.env.VITE_PUBLIC_SUPPORT_EMAIL === 'string' && import.meta.env.VITE_PUBLIC_SUPPORT_EMAIL.trim()
    ? import.meta.env.VITE_PUBLIC_SUPPORT_EMAIL.trim()
    : 'kontakt@tuttopizza.pl'

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: unknown): State {
    return {
      hasError: true,
      error: error instanceof Error ? error : new Error(String(error)),
    }
  }

  componentDidCatch(error: unknown, _info: ErrorInfo) {
    const message = error instanceof Error ? error.message : String(error)
    const isReact130 = message.includes('Minified React error #130')
    if (!isReact130) return
    if (typeof window === 'undefined') return
    if (window.sessionStorage.getItem(AUTO_REFRESH_KEY) === '1') return
    window.sessionStorage.setItem(AUTO_REFRESH_KEY, '1')
    window.location.reload()
  }

  handleReload = () => {
    if (typeof window === 'undefined') return
    window.sessionStorage.removeItem(AUTO_REFRESH_KEY)
    window.location.reload()
  }

  handleHome = () => {
    if (typeof window === 'undefined') return
    window.location.href = '/'
  }

  render() {
    if (!this.state.hasError) return this.props.children

    const isDev = import.meta.env.MODE !== 'production'
    const err = this.state.error
    const subject = encodeURIComponent('FV Control — problem techniczny')
    const body = encodeURIComponent(
      [
        'Cześć,',
        '',
        'Napotkałem błąd techniczny w aplikacji FV Control.',
        '',
        `URL: ${typeof window !== 'undefined' ? window.location.href : '-'}`,
        `Time: ${new Date().toISOString()}`,
        err ? `Error: ${err.message}` : '',
        '',
        'Co robiłem przed błędem:',
        '(opisz krótko)',
      ].join('\n'),
    )
    const mailtoUrl = `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`

    return (
      <div className="error-page" role="alert" aria-live="assertive">
        <div className="error-page__inner">
          <a className="error-page__brand" href="/" onClick={(e) => { e.preventDefault(); this.handleHome() }}>
            FV<span>Control</span>
          </a>
          <div className="error-page__code">500</div>
          <h1 className="error-page__title">Coś poszło nie tak</h1>
          <p className="error-page__lead">
            Wystąpił nieoczekiwany błąd interfejsu. Spróbuj odświeżyć aplikację albo wróć na stronę główną.
            Jeśli problem się powtórzy — daj nam znać, naprawimy.
          </p>
          <div className="error-page__actions">
            <button type="button" className="error-page__btn error-page__btn--primary" onClick={this.handleReload}>
              Odśwież aplikację
            </button>
            <button type="button" className="error-page__btn error-page__btn--ghost" onClick={this.handleHome}>
              Strona główna
            </button>
            <a className="error-page__btn error-page__btn--ghost" href={mailtoUrl}>
              Zgłoś problem
            </a>
          </div>
          {isDev && err ? (
            <details className="error-page__details">
              <summary>Szczegóły techniczne (tylko dev)</summary>
              <pre>{err.stack || err.message}</pre>
            </details>
          ) : null}
        </div>
      </div>
    )
  }
}
