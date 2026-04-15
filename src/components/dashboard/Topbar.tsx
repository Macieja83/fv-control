import type { AppNavItem, AppNavKey } from '../app/appNav'

type Theme = 'light' | 'dark'

export function Topbar({
  theme,
  onThemeChange,
  userEmail,
  onLogout,
  onOpenActivity,
  activityUnread,
  nav,
  onNavChange,
  navTabs,
}: {
  theme: Theme
  onThemeChange: (t: Theme) => void
  userEmail?: string
  onLogout?: () => void
  onOpenActivity?: () => void
  activityUnread?: number
  nav: AppNavKey
  onNavChange: (k: AppNavKey) => void
  /** Dynamiczna lista (np. doklejana zakładka Admin). */
  navTabs: AppNavItem[]
}) {
  return (
    <header className="topbar">
      <div className="topbar__inner">
        <div className="topbar__brand">
          <span className="topbar__logo" aria-hidden>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
          </span>
          <div>
            <h1 className="topbar__title">FV Control</h1>
            <p className="topbar__subtitle">Faktury i umowy</p>
          </div>
        </div>

        <nav className="topbar__nav" aria-label="Moduły aplikacji">
          <div className="topbar__nav-track">
            {navTabs.map((it) => (
              <button
                key={it.key}
                type="button"
                className={`topbar-nav-tab${nav === it.key ? ' topbar-nav-tab--active' : ''}`}
                onClick={() => onNavChange(it.key)}
                title={it.label}
              >
                <span className="topbar-nav-tab__full">{it.label}</span>
                <span className="topbar-nav-tab__short" aria-hidden>
                  {it.short}
                </span>
              </button>
            ))}
          </div>
        </nav>

        <div className="topbar__actions">
          {onOpenActivity && (
            <button
              type="button"
              className="topbar__icon-btn topbar__icon-btn--bell"
              onClick={onOpenActivity}
              aria-label="Powiadomienia i dziennik zdarzeń"
              title="Powiadomienia"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
              {(activityUnread ?? 0) > 0 && (
                <span className="topbar__bell-badge">{activityUnread! > 9 ? '9+' : activityUnread}</span>
              )}
            </button>
          )}
          {userEmail && (
            <span className="topbar__user" title={userEmail}>
              {userEmail}
            </span>
          )}
          <button
            type="button"
            className="topbar__icon-btn"
            onClick={() => onThemeChange(theme === 'light' ? 'dark' : 'light')}
            aria-label="Przełącz motyw"
            title={theme === 'light' ? 'Ciemny motyw' : 'Jasny motyw'}
          >
            {theme === 'light' ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
            )}
          </button>
          {onLogout && (
            <button
              type="button"
              className="topbar__icon-btn topbar__icon-btn--logout"
              onClick={onLogout}
              aria-label="Wyloguj"
              title="Wyloguj"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            </button>
          )}
        </div>
      </div>
    </header>
  )
}
