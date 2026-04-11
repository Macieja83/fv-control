/** Klucz stawki / oznaczenia VAT stosowany w UI (wartość zapisana w modelu pozycji jako `vatKind`). */
export type PlVatKind = '23' | '8' | '5' | '0' | 'zw' | 'np' | 'oo'

export const PL_VAT_OPTIONS: { value: PlVatKind; label: string }[] = [
  { value: '23', label: '23 %' },
  { value: '8', label: '8 %' },
  { value: '5', label: '5 %' },
  { value: '0', label: '0 %' },
  { value: 'zw', label: 'zw. (zwolniony)' },
  { value: 'np', label: 'np. (nie podlega)' },
  { value: 'oo', label: 'oo (odwrotne obciążenie)' },
]

/** Stawka zapisywana w API (`vatRate` — Decimal): dla zw/np/oo = 0. */
export function vatRateDecimalForApi(kind: PlVatKind): string {
  if (kind === '23' || kind === '8' || kind === '5' || kind === '0') return `${kind}.00`
  return '0.00'
}

/** Współczynnik VAT do naliczenia brutto z netto (np. 0.23). Dla zw/np/oo = 0. */
export function vatFractionForTotals(kind: PlVatKind): number {
  if (kind === '23') return 0.23
  if (kind === '8') return 0.08
  if (kind === '5') return 0.05
  return 0
}

export function roundMoney2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

export function calcLineTotals(input: {
  quantity: number
  netPrice: number
  discountPct: number
  vatKind: PlVatKind
}): { netValue: number; grossValue: number } {
  const disc = Number.isFinite(input.discountPct) ? Math.min(Math.max(input.discountPct, 0), 100) : 0
  const unitNet = input.netPrice * (1 - disc / 100)
  const netValue = roundMoney2(input.quantity * unitNet)
  const frac = vatFractionForTotals(input.vatKind)
  const grossValue = roundMoney2(netValue * (1 + frac))
  return { netValue, grossValue }
}
