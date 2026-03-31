type Theme = 'light' | 'dark'

export function Topbar({
  theme,
  onThemeChange,
  userEmail,
  onLogout,
}: {
  theme: Theme
  onThemeChange: (t: Theme) => void
  userEmail?: string
  onLogout?: () => void
}) {
  return (
    <header className="topbar">
      <div className="topbar__brand">
        <span className="topbar__logo" aria-hidden />
        <div>
          <h1 className="topbar__title">FV Resta</h1>
          <p className="topbar__subtitle">Invoice Inbox · fv.resta.biz</p>
        </div>
      </div>
      <div className="topbar__actions">
        {userEmail && (
          <span className="topbar__user" title={userEmail}>
            {userEmail}
          </span>
        )}
        <span className="topbar__env">Resta.app · panel operacyjny</span>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => onThemeChange(theme === 'light' ? 'dark' : 'light')}
          aria-label="Przełącz motyw"
        >
          {theme === 'light' ? 'Ciemny' : 'Jasny'}
        </button>
        {onLogout && (
          <button type="button" className="btn btn--ghost" onClick={onLogout}>
            Wyloguj
          </button>
        )}
      </div>
    </header>
  )
}
