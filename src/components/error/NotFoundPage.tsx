import './error.css'

type NotFoundPageProps = {
  onNavigateHome: () => void
}

const supportEmail =
  typeof import.meta.env.VITE_PUBLIC_SUPPORT_EMAIL === 'string' && import.meta.env.VITE_PUBLIC_SUPPORT_EMAIL.trim()
    ? import.meta.env.VITE_PUBLIC_SUPPORT_EMAIL.trim()
    : 'kontakt@tuttopizza.pl'

export function NotFoundPage({ onNavigateHome }: NotFoundPageProps) {
  const requestedPath = typeof window !== 'undefined' ? window.location.pathname : ''

  return (
    <div className="error-page" role="main">
      <div className="error-page__inner">
        <a
          className="error-page__brand"
          href="/"
          onClick={(e) => {
            e.preventDefault()
            onNavigateHome()
          }}
        >
          FV<span>Control</span>
        </a>
        <div className="error-page__code">404</div>
        <h1 className="error-page__title">Tej strony tu nie ma</h1>
        <p className="error-page__lead">
          Adres <code>{requestedPath || '/'}</code> nie istnieje albo został przeniesiony.
          Wróć do strony głównej lub zajrzyj do dokumentacji API.
        </p>
        <div className="error-page__actions">
          <button
            type="button"
            className="error-page__btn error-page__btn--primary"
            onClick={onNavigateHome}
          >
            Strona główna
          </button>
          <a className="error-page__btn error-page__btn--ghost" href="/docs">
            Dokumentacja API
          </a>
          <a className="error-page__btn error-page__btn--ghost" href={`mailto:${supportEmail}`}>
            Pomoc
          </a>
        </div>
      </div>
    </div>
  )
}
