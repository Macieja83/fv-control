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
  }, [totalPurchase, totalSale, profit])

  const maxScale = Math.max(totalPurchase, totalSale, 1)
  const saleComparePct = (totalSale / maxScale) * 100
  const purchaseComparePct = (totalPurchase / maxScale) * 100

  /** Udział kosztów i zysku w przychodzie — suma = 100% przy zysku dodatnim */
  const costOfRevPct = totalSale > 0 ? Math.min(100, (totalPurchase / totalSale) * 100) : 0
  const profitOfRevPct = totalSale > 0 ? Math.max(0, (profit / totalSale) * 100) : 0
  const hasLoss = profit < 0 && totalSale > 0

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

      <div className="reports-pl-compare">
        <p className="reports-pl-compare__title">Skala (max = wyższa kwota)</p>
        <div className="reports-pl-compare__row">
          <span className="reports-pl-compare__name">Przychody</span>
          <div className="reports-pl-compare__track">
            <div
              className="reports-pl-compare__fill reports-pl-compare__fill--sale"
              style={{ width: ready ? `${saleComparePct}%` : '0%' }}
            />
          </div>
          <span className="reports-pl-compare__pct mono">{formatPct(saleComparePct, 0)}%</span>
        </div>
        <div className="reports-pl-compare__row">
          <span className="reports-pl-compare__name">Wydatki</span>
          <div className="reports-pl-compare__track">
            <div
              className="reports-pl-compare__fill reports-pl-compare__fill--purchase"
              style={{ width: ready ? `${purchaseComparePct}%` : '0%' }}
            />
          </div>
          <span className="reports-pl-compare__pct mono">{formatPct(purchaseComparePct, 0)}%</span>
        </div>
      </div>

      {totalSale > 0 ? (
        hasLoss ? (
          <div className="reports-pl-stack reports-pl-stack--warn">
            <p className="reports-pl-stack__title">Koszty &gt; przychód</p>
            <div className="reports-pl-stack__track" role="img" aria-label="Udział kosztów w przychodzie">
              <div
                className="reports-pl-stack__seg reports-pl-stack__seg--cost"
                style={{ width: ready ? `${Math.min(100, costOfRevPct)}%` : '0%' }}
              />
            </div>
            <ul className="reports-pl-legend">
              <li>
                <span className="reports-pl-legend__swatch reports-pl-legend__swatch--cost" /> Koszty{' '}
                {formatPct(Math.min(100, costOfRevPct))}%
              </li>
            </ul>
          </div>
        ) : (
          <div className="reports-pl-stack">
            <p className="reports-pl-stack__title">Skład przychodu</p>
            <div className="reports-pl-stack__track" role="img" aria-label="Podział przychodu na koszty i zysk">
              <div
                className="reports-pl-stack__seg reports-pl-stack__seg--cost"
                style={{ width: ready ? `${costOfRevPct}%` : '0%' }}
                title={`Koszty: ${formatPct(costOfRevPct)}% przychodu`}
              />
              <div
                className="reports-pl-stack__seg reports-pl-stack__seg--profit"
                style={{ width: ready ? `${profitOfRevPct}%` : '0%' }}
                title={`Zysk: ${formatPct(profitOfRevPct)}% przychodu`}
              />
            </div>
            <ul className="reports-pl-legend">
              <li>
                <span className="reports-pl-legend__swatch reports-pl-legend__swatch--cost" /> Koszty ({formatPct(costOfRevPct)}%)
              </li>
              <li>
                <span className="reports-pl-legend__swatch reports-pl-legend__swatch--profit" /> Zysk ({formatPct(profitOfRevPct)}%)
              </li>
            </ul>
          </div>
        )
      ) : null}

    </section>
  )
}
