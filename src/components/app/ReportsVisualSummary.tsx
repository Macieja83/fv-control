import { useEffect, useId, useMemo, useState } from 'react'

type TrendPoint = { label: string; sale: number; purchase: number }

type Props = {
  currency: string
  totalPurchase: number
  totalSale: number
  profit: number
  /** Marża: profit / sale * 100, gdy sale > 0 */
  profitMarginPct: number | null
  trendPoints: TrendPoint[]
  formatMoney: (n: number, currency: string) => string
  /** Zakres dat z filtra (ISO yyyy-mm-dd). */
  dateFrom?: string
  dateTo?: string
}

function formatPct(n: number, digits = 1): string {
  return new Intl.NumberFormat('pl-PL', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(n)
}

function formatDatePl(iso: string, opts?: Intl.DateTimeFormatOptions): string {
  if (!iso) return ''
  const d = new Date(`${iso.length === 10 ? iso + 'T00:00:00' : iso}`)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat('pl-PL', opts ?? { day: 'numeric', month: 'short', year: 'numeric' }).format(d)
}

function formatCompactMoney(n: number, currency: string): string {
  if (!Number.isFinite(n)) return '—'
  const abs = Math.abs(n)
  let value = n
  let suffix = ''
  if (abs >= 1_000_000) {
    value = n / 1_000_000
    suffix = ' mln'
  } else if (abs >= 10_000) {
    value = n / 1_000
    suffix = ' tys.'
  }
  try {
    return `${new Intl.NumberFormat('pl-PL', { maximumFractionDigits: abs >= 1_000_000 ? 2 : abs >= 10_000 ? 1 : 0 }).format(value)}${suffix} ${currency}`
  } catch {
    return `${value.toFixed(0)}${suffix} ${currency}`
  }
}

export function ReportsVisualSummary({
  currency,
  totalPurchase,
  totalSale,
  profit,
  profitMarginPct,
  trendPoints,
  formatMoney,
  dateFrom,
  dateTo,
}: Props) {
  const rawId = useId()
  const safeId = rawId.replace(/:/g, '')
  const [ready, setReady] = useState(false)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)

  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true))
    return () => cancelAnimationFrame(id)
  }, [])

  const series = useMemo<TrendPoint[]>(() => {
    if (trendPoints.length > 1) return trendPoints
    if (trendPoints.length === 1) {
      const p = trendPoints[0]
      return [p, p]
    }
    return [
      { label: '0', sale: totalSale, purchase: totalPurchase },
      { label: '1', sale: totalSale, purchase: totalPurchase },
    ]
  }, [trendPoints, totalSale, totalPurchase])

  const chartMinX = 12
  const chartMaxX = 308
  const chartMinY = 14
  const chartMaxY = 116
  const chartBottom = 124

  const trendMax = Math.max(
    1,
    ...series.map((p) => p.sale),
    ...series.map((p) => p.purchase),
  )

  const toX = (idx: number) =>
    chartMinX + (idx / Math.max(1, series.length - 1)) * (chartMaxX - chartMinX)
  const toY = (value: number) => chartMaxY - (value / trendMax) * (chartMaxY - chartMinY)

  const toLinePath = (pick: (p: TrendPoint) => number) =>
    series
      .map((p, idx) => {
        const x = toX(idx)
        const y = toY(pick(p))
        return `${idx === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`
      })
      .join(' ')

  const toAreaPath = (pick: (p: TrendPoint) => number) => {
    if (series.length === 0) return ''
    const line = toLinePath(pick)
    const last = toX(series.length - 1)
    const first = toX(0)
    return `${line} L ${last.toFixed(2)} ${chartBottom} L ${first.toFixed(2)} ${chartBottom} Z`
  }

  const salePath = toLinePath((p) => p.sale)
  const purchasePath = toLinePath((p) => p.purchase)
  const saleArea = toAreaPath((p) => p.sale)
  const purchaseArea = toAreaPath((p) => p.purchase)

  const gridLines = [0.25, 0.5, 0.75]
  const hasRealData = trendPoints.length > 0

  const axisLabels = useMemo(() => {
    if (trendPoints.length === 0) return [] as string[]
    if (trendPoints.length === 1) return [formatDatePl(trendPoints[0].label)]
    if (trendPoints.length === 2) {
      return [formatDatePl(trendPoints[0].label), formatDatePl(trendPoints[trendPoints.length - 1].label)]
    }
    const midIdx = Math.floor(trendPoints.length / 2)
    return [
      formatDatePl(trendPoints[0].label),
      formatDatePl(trendPoints[midIdx].label),
      formatDatePl(trendPoints[trendPoints.length - 1].label),
    ]
  }, [trendPoints])

  const rangeLabel = useMemo(() => {
    if (!dateFrom && !dateTo) return null
    const a = dateFrom ? formatDatePl(dateFrom, { day: 'numeric', month: 'short' }) : null
    const b = dateTo ? formatDatePl(dateTo, { day: 'numeric', month: 'short', year: 'numeric' }) : null
    if (a && b) return `${a} – ${b}`
    return a ?? b
  }, [dateFrom, dateTo])

  const active = hoverIdx != null && hoverIdx >= 0 && hoverIdx < series.length ? series[hoverIdx] : null
  const activeIsReal = active != null && hasRealData && hoverIdx! < trendPoints.length

  const r = 54
  const c = 2 * Math.PI * r
  const marginNorm =
    profitMarginPct != null && Number.isFinite(profitMarginPct)
      ? Math.max(0, Math.min(100, profitMarginPct))
      : 0
  const dashOffset = c - (c * marginNorm) / 100
  const marginNegative = profitMarginPct != null && profitMarginPct < 0

  return (
    <section className={`reports-pl-hero${ready ? ' reports-pl-hero--ready' : ''}`} aria-label="Wizualne podsumowanie P i L">
      <div className="reports-pl-hero__glow" aria-hidden />
      <div className="reports-pl-hero__head">
        <div>
          <h3 className="reports-pl-hero__title">Podsumowanie ({currency})</h3>
        </div>
        <div className={`reports-pl-hero__kpi reports-pl-hero__kpi--result${profit >= 0 ? ' is-profit' : ' is-loss'}`}>
          <span className="reports-pl-hero__kpi-label">Wynik</span>
          <span className="reports-pl-hero__kpi-value mono">{formatMoney(profit, currency)}</span>
        </div>
      </div>

      <div className="reports-pl-hero__grid">
        <div className="reports-pl-tile reports-pl-tile--sale">
          <span className="reports-pl-tile__label">Przychody</span>
          <span className="reports-pl-tile__value mono">{formatMoney(totalSale, currency)}</span>
          <div className="reports-pl-tile__spark" aria-hidden>
            <span className="reports-pl-tile__spark-bar" />
          </div>
        </div>
        <div className="reports-pl-tile reports-pl-tile--purchase">
          <span className="reports-pl-tile__label">Wydatki</span>
          <span className="reports-pl-tile__value mono">{formatMoney(totalPurchase, currency)}</span>
          <div className="reports-pl-tile__spark reports-pl-tile__spark--cost" aria-hidden>
            <span className="reports-pl-tile__spark-bar" />
          </div>
        </div>
        <div className="reports-pl-donut-wrap">
          <div className="reports-pl-donut" role="img" aria-label="Marża od przychodu">
            <svg className="reports-pl-donut__svg" viewBox="0 0 120 120" aria-hidden>
              <defs>
                <linearGradient id={`${safeId}-grad`} x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="var(--success)" />
                  <stop offset="100%" stopColor="color-mix(in srgb, var(--success) 65%, #14b8a6)" />
                </linearGradient>
              </defs>
              <circle className="reports-pl-donut__track" cx="60" cy="60" r={r} />
              <circle
                className={`reports-pl-donut__arc${marginNegative ? ' reports-pl-donut__arc--muted' : ''}`}
                cx="60"
                cy="60"
                r={r}
                stroke={marginNegative ? 'var(--danger)' : `url(#${safeId}-grad)`}
                strokeDasharray={c}
                strokeDashoffset={ready ? (marginNegative ? c : dashOffset) : c}
                transform="rotate(-90 60 60)"
                opacity={marginNegative ? 0.35 : 1}
              />
            </svg>
            <div className="reports-pl-donut__center">
              {profitMarginPct != null && Number.isFinite(profitMarginPct) ? (
                marginNegative ? (
                  <>
                    <span className="reports-pl-donut__pct reports-pl-donut__pct--neg mono">{formatPct(profitMarginPct)}%</span>
                    <span className="reports-pl-donut__sub">strata</span>
                  </>
                ) : (
                  <>
                    <span className="reports-pl-donut__pct mono">{formatPct(profitMarginPct)}%</span>
                    <span className="reports-pl-donut__sub">marża</span>
                  </>
                )
              ) : (
                <span className="reports-pl-donut__na">—</span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="reports-pl-trend" role="img" aria-label="Liniowy trend wydatków i przychodów">
        <div className="reports-pl-trend__head">
          <p className="reports-pl-trend__title">
            Trend liniowy
            {rangeLabel ? (
              <>
                <span className="reports-pl-trend__title-sep" aria-hidden>·</span>
                <span className="reports-pl-trend__range">{rangeLabel}</span>
              </>
            ) : null}
          </p>
          <div className="reports-pl-trend__legend">
            <span className="reports-pl-trend__legend-item reports-pl-trend__legend-item--sale">
              <span className="reports-pl-trend__legend-name">Przychody</span>
              <span className="reports-pl-trend__legend-amount mono">{formatMoney(totalSale, currency)}</span>
            </span>
            <span className="reports-pl-trend__legend-item reports-pl-trend__legend-item--purchase">
              <span className="reports-pl-trend__legend-name">Wydatki</span>
              <span className="reports-pl-trend__legend-amount mono">{formatMoney(totalPurchase, currency)}</span>
            </span>
          </div>
        </div>

        <div className="reports-pl-trend__body">
          <span className="reports-pl-trend__peak mono" aria-hidden>
            {formatCompactMoney(trendMax, currency)}
          </span>
          <svg
            className="reports-pl-trend__svg"
            viewBox="0 0 320 140"
            preserveAspectRatio="xMidYMid meet"
            aria-hidden
            onMouseLeave={() => setHoverIdx(null)}
          >
            <defs>
              <linearGradient id={`${safeId}-fill-sale`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="currentColor" stopOpacity="0.32" />
                <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
              </linearGradient>
              <linearGradient id={`${safeId}-fill-purchase`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
                <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
              </linearGradient>
            </defs>

            {gridLines.map((fr) => {
              const y = chartMinY + fr * (chartMaxY - chartMinY)
              return (
                <line
                  key={fr}
                  className="reports-pl-trend__grid"
                  x1={chartMinX}
                  x2={chartMaxX}
                  y1={y}
                  y2={y}
                />
              )
            })}
            <line
              className="reports-pl-trend__axis-line"
              x1={chartMinX}
              x2={chartMaxX}
              y1={chartMaxY}
              y2={chartMaxY}
            />

            <g className="reports-pl-trend__area-g reports-pl-trend__area-g--sale">
              <path
                className="reports-pl-trend__area"
                d={saleArea}
                fill={`url(#${safeId}-fill-sale)`}
                style={{ opacity: ready ? 1 : 0 }}
              />
            </g>
            <g className="reports-pl-trend__area-g reports-pl-trend__area-g--purchase">
              <path
                className="reports-pl-trend__area"
                d={purchaseArea}
                fill={`url(#${safeId}-fill-purchase)`}
                style={{ opacity: ready ? 1 : 0 }}
              />
            </g>

            <path className="reports-pl-trend__line reports-pl-trend__line--sale" d={salePath} />
            <path className="reports-pl-trend__line reports-pl-trend__line--purchase" d={purchasePath} />

            {series.map((p, idx) => {
              const x = toX(idx)
              const ySale = toY(p.sale)
              const yPurchase = toY(p.purchase)
              const isHover = hoverIdx === idx
              return (
                <g key={`pt-${idx}`}>
                  <rect
                    x={x - 14}
                    y={chartMinY}
                    width={28}
                    height={chartMaxY - chartMinY}
                    fill="transparent"
                    style={{ cursor: 'pointer' }}
                    onMouseEnter={() => setHoverIdx(idx)}
                  />
                  {isHover ? (
                    <line
                      className="reports-pl-trend__hover-line"
                      x1={x}
                      x2={x}
                      y1={chartMinY}
                      y2={chartMaxY}
                    />
                  ) : null}
                  <circle
                    className={`reports-pl-trend__dot reports-pl-trend__dot--sale${isHover ? ' is-hover' : ''}`}
                    cx={x}
                    cy={ySale}
                    r={isHover ? 4 : 3}
                  />
                  <circle
                    className={`reports-pl-trend__dot reports-pl-trend__dot--purchase${isHover ? ' is-hover' : ''}`}
                    cx={x}
                    cy={yPurchase}
                    r={isHover ? 4 : 3}
                  />
                </g>
              )
            })}
          </svg>

          {active && activeIsReal ? (
            <div
              className="reports-pl-trend__tooltip"
              style={{
                left: `${((toX(hoverIdx!) - chartMinX) / (chartMaxX - chartMinX)) * 100}%`,
              }}
            >
              <span className="reports-pl-trend__tooltip-date">{formatDatePl(active.label)}</span>
              <span className="reports-pl-trend__tooltip-row reports-pl-trend__tooltip-row--sale mono">
                <span className="reports-pl-trend__tooltip-dot" />
                {formatMoney(active.sale, currency)}
              </span>
              <span className="reports-pl-trend__tooltip-row reports-pl-trend__tooltip-row--purchase mono">
                <span className="reports-pl-trend__tooltip-dot" />
                {formatMoney(active.purchase, currency)}
              </span>
            </div>
          ) : null}
        </div>

        {axisLabels.length > 0 ? (
          <div className={`reports-pl-trend__axis axis-count-${axisLabels.length}`}>
            {axisLabels.map((label, idx) => (
              <span key={`${label}-${idx}`}>{label}</span>
            ))}
          </div>
        ) : null}
      </div>

    </section>
  )
}
