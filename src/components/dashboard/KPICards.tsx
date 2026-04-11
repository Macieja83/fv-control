export function KPICards({
  all,
  unpaidBiz,
  paid,
  dups,
  review,
  noCat,
  unknownVendor,
  onPickFilter,
}: {
  all: number
  unpaidBiz: number
  paid: number
  dups: number
  review: number
  noCat: number
  unknownVendor: number
  onPickFilter: (key: 'all' | 'unpaid' | 'paid' | 'dups' | 'review' | 'noCat' | 'unknownVendor') => void
}) {
  const cards = [
    { key: 'all' as const, label: 'Wszystkie faktury', value: all, hint: 'Pełna lista' },
    { key: 'unpaid' as const, label: 'Do opłacenia', value: unpaidBiz, hint: 'Firmowe, niezapłacone' },
    { key: 'paid' as const, label: 'Zapłacone', value: paid, hint: 'Potwierdzona płatność' },
    { key: 'dups' as const, label: 'Duplikaty', value: dups, hint: 'Score ≥ 85% lub potwierdzone' },
    { key: 'review' as const, label: 'Do sprawdzenia', value: review, hint: 'Status przeglądu' },
    { key: 'noCat' as const, label: 'Bez kategorii', value: noCat, hint: 'Wymaga kategorii kosztu' },
    {
      key: 'unknownVendor' as const,
      label: 'Nowy dostawca',
      value: unknownVendor,
      hint: 'Brak kontrahenta w bazie',
    },
  ]
  return (
    <section
      className="kpi-grid"
      aria-label="Wskaźniki według filtrów (m.in. zakres dat Od–Do)"
    >
      {cards.map((c) => (
        <button
          key={c.key}
          type="button"
          className="kpi-card"
          onClick={() => onPickFilter(c.key)}
        >
          <span className="kpi-card__label">{c.label}</span>
          <span className="kpi-card__value">{c.value}</span>
          <span className="kpi-card__hint">{c.hint}</span>
        </button>
      ))}
    </section>
  )
}
