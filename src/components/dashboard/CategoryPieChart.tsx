import { useEffect, useMemo, useState } from 'react'

export type CategoryPieDatum = {
  label: string
  value: number
  count: number
  currency: string
}

type Props = {
  data: CategoryPieDatum[]
  variant: 'purchase' | 'sale'
  formatMoney: (n: number, currency: string) => string
  emptyHint?: string
}

const PURCHASE_PALETTE = [
  '#4f6ef7',
  '#8b5cf6',
  '#a855f7',
  '#7c9cff',
  '#6366f1',
  '#c084fc',
  '#5b7cfa',
  '#818cf8',
]

const SALE_PALETTE = [
  '#4ade80',
  '#14b8a6',
  '#22c55e',
  '#34d399',
  '#10b981',
  '#0d9488',
  '#6ee7b7',
  '#22d3ee',
]

function formatPctShare(n: number): string {
  if (!Number.isFinite(n)) return '—'
  return new Intl.NumberFormat('pl-PL', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(n)
}

export function CategoryPieChart({ data, variant, formatMoney, emptyHint }: Props) {
  const [hover, setHover] = useState<number | null>(null)
  const [ready, setReady] = useState(false)

  const total = useMemo(() => data.reduce((s, d) => s + d.value, 0), [data])

  useEffect(() => {
    setReady(false)
    const id = requestAnimationFrame(() => setReady(true))
    return () => cancelAnimationFrame(id)
  }, [data])

  if (data.length === 0) {
    return (
      <p className="report-chart__empty workspace-panel__muted" role="status">
        {emptyHint ?? 'Brak danych dla wybranych filtrów.'}
      </p>
    )
  }

  const palette = variant === 'purchase' ? PURCHASE_PALETTE : SALE_PALETTE
  const cx = 120
  const cy = 120
  const r = 78
  const ringWidth = 28
  const circumference = 2 * Math.PI * r

  let cumulativePct = 0
  const segments = data.map((d, i) => {
    const share = total > 0 ? d.value / total : 0
    const sharePct = share * 100
    const dashArray = share * circumference
    const offset = -cumulativePct * circumference
    cumulativePct += share
    return {
      ...d,
      idx: i,
      sharePct,
      dashArray,
      offset,
      color: palette[i % palette.length],
    }
  })

  const active = hover != null ? segments[hover] : null
  const currency = data[0]?.currency || 'PLN'

  return (
    <div
      className={`report-pie report-pie--${variant}`}
      role="group"
      aria-label={variant === 'purchase' ? 'Wykres kołowy wydatków wg kategorii' : 'Wykres kołowy przychodów wg kategorii'}
    >
      <div className="report-pie__visual">
        <svg className="report-pie__svg" viewBox="0 0 240 240" aria-hidden>
          <circle className="report-pie__track" cx={cx} cy={cy} r={r} strokeWidth={ringWidth} />
          {segments.map((s) => {
            const isActive = hover === s.idx
            const isDim = hover != null && hover !== s.idx
            return (
              <circle
                key={`${s.label}-${s.idx}`}
                className={`report-pie__seg${isActive ? ' report-pie__seg--active' : ''}${isDim ? ' report-pie__seg--dim' : ''}`}
                cx={cx}
                cy={cy}
                r={r}
                stroke={s.color}
                strokeWidth={ringWidth}
                strokeDasharray={`${ready ? s.dashArray : 0} ${circumference}`}
                strokeDashoffset={s.offset}
                transform={`rotate(-90 ${cx} ${cy})`}
                onMouseEnter={() => setHover(s.idx)}
                onMouseLeave={() => setHover(null)}
              />
            )
          })}
        </svg>
        <div className="report-pie__center">
          {active ? (
            <>
              <span className="report-pie__center-pct mono">{formatPctShare(active.sharePct)}%</span>
              <span className="report-pie__center-label" title={active.label}>
                {active.label}
              </span>
              <span className="report-pie__center-amount mono">{formatMoney(active.value, active.currency)}</span>
            </>
          ) : (
            <>
              <span className="report-pie__center-label">Suma</span>
              <span className="report-pie__center-amount mono">{formatMoney(total, currency)}</span>
              <span className="report-pie__center-sub">
                {data.length} {data.length === 1 ? 'kat.' : 'kat.'}
              </span>
            </>
          )}
        </div>
      </div>
      <ul className="report-pie__legend">
        {segments.map((s) => (
          <li
            key={`${s.label}-${s.idx}-l`}
            className={`report-pie__legend-item${hover === s.idx ? ' report-pie__legend-item--active' : ''}`}
            onMouseEnter={() => setHover(s.idx)}
            onMouseLeave={() => setHover(null)}
          >
            <span
              className="report-pie__legend-swatch"
              style={{ background: s.color, boxShadow: `0 0 10px ${s.color}88` }}
              aria-hidden
            />
            <span className="report-pie__legend-label" title={s.label}>
              {s.label}
            </span>
            <span className="report-pie__legend-amount mono">{formatMoney(s.value, s.currency)}</span>
            <span className="report-pie__legend-pct mono">{formatPctShare(s.sharePct)}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
