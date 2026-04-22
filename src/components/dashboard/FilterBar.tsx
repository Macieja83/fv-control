import { useState } from 'react'
import { defaultInvoiceFilters, type InvoiceFilters } from '../../types/invoice'

type Props = {
  filters: InvoiceFilters
  onChange: (f: InvoiceFilters) => void
  suppliers: string[]
  restaurants: string[]
  categories: readonly string[]
  /** Po „Wyczyść” — domyślny stan; brak = bieżący miesiąc + puste pola (jak panel faktur). */
  getDefaultFilters?: () => InvoiceFilters
}

function activeFilterCount(f: InvoiceFilters): number {
  let n = 0
  if (f.search) n++
  if (f.restaurant) n++
  if (f.supplier) n++
  if (f.source) n++
  if (f.reviewStatus) n++
  if (f.category) n++
  if (f.payment) n++
  if (f.scope) n++
  return n
}

export function FilterBar({
  filters,
  onChange,
  suppliers,
  restaurants,
  categories,
  getDefaultFilters,
}: Props) {
  const [open, setOpen] = useState(false)
  const count = activeFilterCount(filters)

  const patch = (partial: Partial<InvoiceFilters>) =>
    onChange({ ...filters, ...partial })

  const dateRangeHint =
    'Zakres Od–Do filtruje po dacie wystawienia (jak w KSeF): zapytanie do API używa tych dat, więc widzisz wszystkie faktury z okresu, nie tylko pierwszą stronę wyników. To nie jest „data zapisania w KSeF” z portalu MF.'

  return (
    <div className={`filter-bar ${open ? 'filter-bar--open' : ''}`}>
      <div className="filter-bar__main">
        <label className="field filter-bar__search">
          <input
            className="input"
            placeholder="Szukaj: dostawca, numer, NIP…"
            value={filters.search}
            onChange={(e) => patch({ search: e.target.value })}
          />
        </label>
        <div className="filter-bar__date-inputs" role="group" aria-label="Zakres dat wystawienia">
          <label className="field field--compact-date">
            <span className="field__label">Od</span>
            <input
              type="date"
              className="input"
              value={filters.dateFrom}
              onChange={(e) => patch({ dateFrom: e.target.value })}
            />
          </label>
          <label className="field field--compact-date">
            <span className="field__label">Do</span>
            <input
              type="date"
              className="input"
              value={filters.dateTo}
              onChange={(e) => patch({ dateTo: e.target.value })}
            />
          </label>
        </div>
        <button
          type="button"
          className={`filter-bar__toggle ${count > 0 ? 'filter-bar__toggle--active' : ''}`}
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
          <span className="filter-bar__toggle-label">Filtry{count > 0 ? ` (${count})` : ''}</span>
          <svg className={`filter-bar__chevron ${open ? 'filter-bar__chevron--open' : ''}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <button
          type="button"
          className="filter-bar__reset"
          title="Przywróć domyślne filtry: bieżący miesiąc, puste wyszukiwanie, wszystkie kategorie (jak po odświeżeniu strony — z aktualną datą od–do)."
          aria-label="Wyczyść filtry i przywróć domyślne ustawienia"
          onClick={() => {
            onChange((getDefaultFilters ?? defaultInvoiceFilters)())
            setOpen(false)
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
          </svg>
          <span className="filter-bar__reset-label">Wyczyść</span>
        </button>
        <button
          type="button"
          className="filter-bar__hint-btn"
          title={dateRangeHint}
          aria-label={dateRangeHint}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4M12 8h.01" />
          </svg>
        </button>
      </div>

      {open && (
        <div className="filter-bar__body">
          <div className="filter-bar__row">
            <label className="field">
              <span className="field__label">Restauracja</span>
              <select
                className="input"
                value={filters.restaurant}
                onChange={(e) => patch({ restaurant: e.target.value })}
              >
                <option value="">Wszystkie</option>
                {restaurants.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field__label">Dostawca</span>
              <select
                className="input"
                value={filters.supplier}
                onChange={(e) => patch({ supplier: e.target.value })}
              >
                <option value="">Wszyscy</option>
                {suppliers.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field__label">Źródło</span>
              <select
                className="input"
                value={filters.source}
                onChange={(e) => patch({ source: e.target.value as InvoiceFilters['source'] })}
              >
                <option value="">Wszystkie</option>
                <option value="email">E-mail</option>
                <option value="ksef">KSeF</option>
                <option value="discord_ready">Discord-ready</option>
              </select>
            </label>
          </div>
          <div className="filter-bar__row">
            <label className="field">
              <span className="field__label">Status</span>
              <select
                className="input"
                value={filters.reviewStatus}
                onChange={(e) => patch({ reviewStatus: e.target.value as InvoiceFilters['reviewStatus'] })}
              >
                <option value="">Dowolny</option>
                <option value="cleared">OK</option>
                <option value="needs_review">Do sprawdzenia</option>
              </select>
            </label>
            <label className="field">
              <span className="field__label">Kategoria</span>
              <select
                className="input"
                value={filters.category}
                onChange={(e) => patch({ category: e.target.value })}
              >
                <option value="">Wszystkie</option>
                <option value="__none__">Bez kategorii</option>
                {categories.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field__label">Płatność</span>
              <select
                className="input"
                value={filters.payment}
                onChange={(e) => patch({ payment: e.target.value as InvoiceFilters['payment'] })}
              >
                <option value="">Dowolna</option>
                <option value="paid">Zapłacona</option>
                <option value="unpaid">Niezapłacona</option>
              </select>
            </label>
            <label className="field">
              <span className="field__label">Typ</span>
              <select
                className="input"
                value={filters.scope}
                onChange={(e) => patch({ scope: e.target.value as InvoiceFilters['scope'] })}
              >
                <option value="">Wszystkie</option>
                <option value="business">Firmowa</option>
                <option value="private">Prywatna</option>
              </select>
            </label>
          </div>
        </div>
      )}
    </div>
  )
}
