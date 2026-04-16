import { useEffect, useMemo, useState } from 'react'

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
  /** Wejście wierszy i pasków (domyślnie włączone) */
  motion?: boolean
}

function formatPctShare(n: number): string {
  if (!Number.isFinite(n)) return '—'
  return new Intl.NumberFormat('pl-PL', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(n)
}

export function CategoryBarChart({ data, variant, formatMoney, emptyHint, motion = true }: Props) {
  const [hover, setHover] = useState<number | null>(null)
  const [barsReady, setBarsReady] = useState(false)
  const total = useMemo(() => data.reduce((s, d) => s + d.value, 0), [data])

  useEffect(() => {
    if (!motion) {
      setBarsReady(true)
      return
    }
    setBarsReady(false)
    const id = requestAnimationFrame(() => setBarsReady(true))
    return () => cancelAnimationFrame(id)
  }, [motion, data])

  if (data.length === 0) {
    return (
      <p className="report-chart__empty workspace-panel__muted" role="status">
        {emptyHint ?? 'Brak danych dla wybranych filtrów.'}
      </p>
    )
  }

  return (
    <div
      className={`report-chart report-chart--${variant}${motion ? ' report-chart--motion' : ''}`}
      role="group"
      aria-label={variant === 'purchase' ? 'Wykres wydatków wg kategorii' : 'Wykres przychodów wg kategorii'}
    >
      {data.map((d, i) => {
        const sharePct = total > 0 ? (d.value / total) * 100 : 0
        const fillW = barsReady ? sharePct : 0
        const active = hover === i
        return (
          <div
            key={`${d.label}-${i}`}
            className={`report-chart__row${active ? ' report-chart__row--active' : ''}`}
            style={motion ? { animationDelay: `${0.04 + i * 0.045}s` } : undefined}
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
              <div className="report-chart__fill" style={{ width: `${Math.min(fillW, 100)}%` }} />
            </div>
            <div className="report-chart__value">
              <div className="report-chart__amount mono">{formatMoney(d.value, d.currency)}</div>
              <div className="report-chart__pct workspace-panel__muted" title="% w sumie">
                {formatPctShare(sharePct)}%
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
