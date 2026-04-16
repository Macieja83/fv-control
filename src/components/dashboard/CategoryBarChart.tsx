import { useMemo, useState } from 'react'

export type CategoryBarDatum = {
  label: string
  value: number
  count: number
  currency: string
}

type Props = {
  data: CategoryBarDatum[]
  variant: 'purchase' | 'sale'
  formatMoney: (n: number, currency: string) => string
  emptyHint?: string
}

export function CategoryBarChart({ data, variant, formatMoney, emptyHint }: Props) {
  const [hover, setHover] = useState<number | null>(null)
  const max = useMemo(() => Math.max(0, ...data.map((d) => d.value)), [data])

  if (data.length === 0) {
    return (
      <p className="report-chart__empty workspace-panel__muted" role="status">
        {emptyHint ?? 'Brak danych dla wybranych filtrów.'}
      </p>
    )
  }

  return (
    <div
      className={`report-chart report-chart--${variant}`}
      role="group"
      aria-label={variant === 'purchase' ? 'Wykres wydatków wg kategorii' : 'Wykres przychodów wg kategorii'}
    >
      {data.map((d, i) => {
        const pct = max > 0 ? Math.round((d.value / max) * 1000) / 10 : 0
        const w = Math.max(pct, d.value > 0 ? 2 : 0)
        const active = hover === i
        return (
          <div
            key={`${d.label}-${i}`}
            className={`report-chart__row${active ? ' report-chart__row--active' : ''}`}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <div className="report-chart__label" title={d.label}>
              <span className="report-chart__label-text">{d.label}</span>
              <span className="report-chart__meta">
                {d.count} {d.count === 1 ? 'faktura' : d.count < 5 ? 'faktury' : 'faktur'}
              </span>
            </div>
            <div className="report-chart__track" aria-hidden>
              <div className="report-chart__fill" style={{ width: `${w}%` }} />
            </div>
            <div className="report-chart__value mono">{formatMoney(d.value, d.currency)}</div>
          </div>
        )
      })}
    </div>
  )
}
