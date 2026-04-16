import type { InvoiceFilters, InvoiceRecord } from '../types/invoice'

export type MatchInvoiceFiltersOpts = {
  /**
   * true = nie porównuj issue_date z dateFrom/dateTo (np. Raporty: zakres już zastosowało API,
   * ponowne porównanie po stronie klienta potrafi odrzucić wszystkie wiersze przez różnicę dat ISO / strefy).
   */
  omitDateRange?: boolean
}

/** Ta sama logika co lista faktur — używana też w Raportach (filtrowanie przed agregacją). */
export function matchesInvoiceFilters(
  row: InvoiceRecord,
  f: InvoiceFilters,
  opts?: MatchInvoiceFiltersOpts,
): boolean {
  if (f.search.trim()) {
    const q = f.search.toLowerCase()
    const blob = [
      row.supplier_name,
      row.invoice_number,
      row.supplier_nip,
      row.extracted_vendor_nip ?? '',
      row.ksef_number ?? '',
      row.primary_document_id ?? '',
      row.notes,
    ]
      .join(' ')
      .toLowerCase()
    if (!blob.includes(q)) return false
  }
  if (!opts?.omitDateRange) {
    if (f.dateFrom && row.issue_date < f.dateFrom) return false
    if (f.dateTo && row.issue_date > f.dateTo) return false
  }
  if (f.supplier && row.supplier_name !== f.supplier) return false
  if (f.restaurant && row.restaurant_name !== f.restaurant) return false
  if (f.reviewStatus && row.review_status !== f.reviewStatus) return false
  if (f.category) {
    if (f.category === '__none__') {
      if (row.category) return false
    } else if (row.category !== f.category) return false
  }
  if (f.payment && row.payment_status !== f.payment) return false
  if (f.scope && row.document_scope !== f.scope) return false
  if (f.source) {
    if (f.source === 'discord_ready') {
      if (row.source_type !== 'discord') return false
    } else if (row.source_type !== f.source) return false
  }
  return true
}
