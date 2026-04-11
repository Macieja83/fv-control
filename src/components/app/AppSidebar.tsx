export type AppNavKey = 'inbox' | 'documents' | 'payments' | 'contractors' | 'settings'

const items: { key: AppNavKey; label: string; hint: string }[] = [
  { key: 'inbox', label: 'Inbox', hint: 'Faktury i OCR' },
  { key: 'documents', label: 'Dokumenty', hint: 'Przegląd wg typu' },
  { key: 'payments', label: 'Płatności', hint: 'Bank i zgody' },
  { key: 'contractors', label: 'Kontrahenci', hint: 'Baza dostawców' },
  { key: 'settings', label: 'Firma', hint: 'Dane i integracje' },
]

export function AppSidebar({
  active,
  onSelect,
}: {
  active: AppNavKey
  onSelect: (k: AppNavKey) => void
}) {
  return (
    <aside className="app-sidebar" aria-label="Nawigacja główna">
      <div className="app-sidebar__header">
        <span className="app-sidebar__eyebrow">Pracujesz w</span>
        <p className="app-sidebar__context">FV Control</p>
      </div>
      <nav className="app-sidebar__grid">
        {items.map((it) => (
          <button
            key={it.key}
            type="button"
            className={`app-sidebar__tile${active === it.key ? ' app-sidebar__tile--active' : ''}`}
            onClick={() => onSelect(it.key)}
            title={it.hint}
          >
            <span className="app-sidebar__tile-label">{it.label}</span>
            <span className="app-sidebar__tile-hint">{it.hint}</span>
          </button>
        ))}
      </nav>
    </aside>
  )
}
