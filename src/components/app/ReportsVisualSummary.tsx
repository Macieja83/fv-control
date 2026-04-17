import { useEffect, useId, useState } from 'react'

type Props = {
  currency: string
  totalPurchase: number
  totalSale: number
  profit: number
  /** Marża: profit / sale * 100, gdy sale > 0 */
  profitMarginPct: number | null
  formatMoney: (n: number, currency: string) => string
}

function formatPct(n: number, digits = 1): string {
  return new Intl.NumberFormat('pl-PL', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(n)
}

export function ReportsVisualSummary({
  currency,
  totalPurchase,
  totalSale,
  profit,
  profitMarginPct,
  formatMoney,
}: Props) {
  const rawId = useId()
  const safeId = rawId.replace(/:/g, '')
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true))
    return () => cancelAnimationFrame(id)
  }, [])

  const trendMax = Math.max(totalSale, totalPurchase, 1)
  const toY = (value: number) => 78 - (value / trendMax) * 58
  let saleY = toY(totalSale)
  let purchaseY = toY(totalPurchase)
  // Gdy linie się pokrywają, rozsuń je minimalnie żeby obie były widoczne.
  if (Math.abs(saleY - purchaseY) < 1.2) {
    saleY = Math.max(8, saleY - 1.2)
    purchaseY = Math.min(78, purchaseY + 1.2)
  }
  const salePath = `M 8 ${saleY.toFixed(2)} L 152 ${saleY.toFixed(2)}`
  const purchasePath = `M 8 ${purchaseY.toFixed(2)} L 152 ${purchaseY.toFixed(2)}`

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
                    <span className="reports-pl-donut__sub">ujemna</span>
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
          <p className="reports-pl-trend__title">Trend liniowy</p>
          <div className="reports-pl-trend__legend">
            <span className="reports-pl-trend__legend-item reports-pl-trend__legend-item--sale">Przychody</span>
            <span className="reports-pl-trend__legend-item reports-pl-trend__legend-item--purchase">Wydatki</span>
          </div>
        </div>
        <svg className="reports-pl-trend__svg" viewBox="0 0 160 86" preserveAspectRatio="none" aria-hidden>
          <path className="reports-pl-trend__line reports-pl-trend__line--sale" d={salePath} />
          <path className="reports-pl-trend__line reports-pl-trend__line--purchase" d={purchasePath} />
        </svg>
      </div>

    </section>
  )
}
