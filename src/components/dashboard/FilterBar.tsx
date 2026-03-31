import type { InvoiceFilters } from '../../types/invoice'

type Props = {
  filters: InvoiceFilters
  onChange: (f: InvoiceFilters) => void
  suppliers: string[]
  restaurants: string[]
  categories: readonly string[]
}

export function FilterBar({ filters, onChange, suppliers, restaurants, categories }: Props) {
  const patch = (partial: Partial<InvoiceFilters>) =>
    onChange({ ...filters, ...partial })

  return (
    <div className="filter-bar">
      <div className="filter-bar__row">
        <label className="field">
          <span className="field__label">Szukaj</span>
          <input
            className="input"
            placeholder="Dostawca, numer, NIP, KSeF, notatki…"
            value={filters.search}
            onChange={(e) => patch({ search: e.target.value })}
          />
        </label>
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
              <option key={r} value={r}>
                {r}
              </option>
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
              <option key={s} value={s}>
                {s}
              </option>
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
            onChange={(e) =>
              patch({
                source: e.target.value as InvoiceFilters['source'],
              })
            }
          >
            <option value="">Wszystkie</option>
            <option value="email">E-mail</option>
            <option value="ksef">KSeF</option>
            <option value="discord_ready">Discord-ready</option>
          </select>
        </label>
        <label className="field">
          <span className="field__label">Status przeglądu</span>
          <select
            className="input"
            value={filters.reviewStatus}
            onChange={(e) =>
              patch({ reviewStatus: e.target.value as InvoiceFilters['reviewStatus'] })
            }
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
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field__label">Płatność</span>
          <select
            className="input"
            value={filters.payment}
            onChange={(e) =>
              patch({ payment: e.target.value as InvoiceFilters['payment'] })
            }
          >
            <option value="">Dowolna</option>
            <option value="paid">Zapłacona</option>
            <option value="unpaid">Niezapłacona</option>
          </select>
        </label>
        <label className="field">
          <span className="field__label">Typ dokumentu</span>
          <select
            className="input"
            value={filters.scope}
            onChange={(e) =>
              patch({ scope: e.target.value as InvoiceFilters['scope'] })
            }
          >
            <option value="">Wszystkie</option>
            <option value="business">Firmowa</option>
            <option value="private">Prywatna</option>
          </select>
        </label>
      </div>
    </div>
  )
}
