import { useState } from 'react'
import type { InvoiceFilters } from '../../types/invoice'

type Props = {
  filters: InvoiceFilters
  onChange: (f: InvoiceFilters) => void
  suppliers: string[]
  restaurants: string[]
  categories: readonly string[]
}

function activeFilterCount(f: InvoiceFilters): number {
  let n = 0
  if (f.search) n++
  if (f.dateFrom) n++
  if (f.dateTo) n++
  if (f.restaurant) n++
  if (f.supplier) n++
  if (f.source) n++
  if (f.reviewStatus) n++
  if (f.category) n++
  if (f.payment) n++
  if (f.scope) n++
  return n
}

export function FilterBar({ filters, onChange, suppliers, restaurants, categories }: Props) {
  const [open, setOpen] = useState(false)
  const count = activeFilterCount(filters)

  const patch = (partial: Partial<InvoiceFilters>) =>
    onChange({ ...filters, ...partial })

  return (
    <div className={`filter-bar ${open ? 'filter-bar--open' : ''}`}>
      <div className="filter-bar__top">
        <label className="field filter-bar__search">
          <input
            className="input"
            placeholder="Szukaj: dostawca, numer, NIP…"
            value={filters.search}
            onChange={(e) => patch({ search: e.target.value })}
          />
        </label>
        <button
          type="button"
          className={`filter-bar__toggle ${count > 0 ? 'filter-bar__toggle--active' : ''}`}
          onClick={() => setOpen((o) => !o)}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
          <span className="filter-bar__toggle-label">Filtry{count > 0 ? ` (${count})` : ''}</span>
          <svg className={`filter-bar__chevron ${open ? 'filter-bar__chevron--open' : ''}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
      </div>
      {open && (
        <div className="filter-bar__body">
          <div className="filter-bar__row">
            <label className="field field--narrow">
              <span className="field__label">Od</span>
              <input
                type="date"
                className="input"
                value={filters.dateFrom}
                onChange={(e) => patch({ dateFrom: e.target.value })}
              />
            </label>
            <label className="field field--narrow">
              <span className="field__label">Do</span>
              <input
                type="date"
                className="input"
                value={filters.dateTo}
                onChange={(e) => patch({ dateTo: e.target.value })}
              />
            </label>
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
          </div>
          <div className="filter-bar__row">
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
