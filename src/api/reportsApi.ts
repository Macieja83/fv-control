import { readApiErrorMessage } from './http'
const API = '/api/v1'

export type CategoryBreakdownRow = {
  ledgerKind: 'PURCHASE' | 'SALE'
  category: string
  currency: string
  grossTotal: string
  invoiceCount: number
}

export type CategoryBreakdownResponse = {
  rows: CategoryBreakdownRow[]
}

export async function fetchCategoryBreakdown(
  token: string,
  opts?: { dateFrom?: string; dateTo?: string; currency?: string },
): Promise<CategoryBreakdownResponse> {
  const q = new URLSearchParams()
  if (opts?.dateFrom) q.set('dateFrom', opts.dateFrom)
  if (opts?.dateTo) q.set('dateTo', opts.dateTo)
  if (opts?.currency?.trim()) q.set('currency', opts.currency.trim().toUpperCase())
  const qs = q.toString()
  const res = await fetch(`${API}/reports/category-breakdown${qs ? `?${qs}` : ''}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(await readApiErrorMessage(res))
  return (await res.json()) as CategoryBreakdownResponse
}
