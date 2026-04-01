import type { ApiInvoiceListRow } from '../api/invoicesApi'
import type { CurrencyCode, InvoiceRecord, SourceType } from '../types/invoice'

function toYmd(iso: string): string {
  if (iso.length >= 10 && iso[4] === '-' && iso[7] === '-') return iso.slice(0, 10)
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10)
  return d.toISOString().slice(0, 10)
}

function mapIntakeToSource(t: string): SourceType {
  if (t === 'KSEF_API') return 'ksef'
  return 'email'
}

function mapCurrency(c: string): CurrencyCode {
  if (c === 'EUR' || c === 'USD') return c
  return 'PLN'
}

export function mapApiInvoiceRowToRecord(row: ApiInvoiceListRow): InvoiceRecord {
  const contractor = row.contractor
  const gross = Number.parseFloat(row.grossTotal)
  const dup = row.duplicateScore != null ? Number.parseFloat(row.duplicateScore) : 0

  return {
    id: row.id,
    source_type: mapIntakeToSource(row.intakeSourceType),
    source_account: row.sourceAccount?.trim() || '—',
    restaurant_name: row.tenant?.name?.trim() || '—',
    supplier_name: contractor?.name?.trim() || '—',
    supplier_nip: (contractor?.nip ?? '').replace(/\s/g, ''),
    invoice_number: row.number,
    issue_date: toYmd(row.issueDate),
    due_date: row.dueDate ? toYmd(row.dueDate) : '',
    gross_amount: Number.isFinite(gross) ? gross : 0,
    currency: mapCurrency(row.currency),
    category: null,
    payment_status: row.status === 'PAID' ? 'paid' : 'unpaid',
    document_scope: row.legalChannel === 'EXCLUDED' ? 'private' : 'business',
    review_status: row.reviewStatus === 'NEEDS_REVIEW' ? 'needs_review' : 'cleared',
    duplicate_score: Number.isFinite(dup) ? dup : 0,
    duplicate_of_id: null,
    duplicate_reason: null,
    duplicate_resolution: 'none',
    ksef_number: row.ksefNumber?.trim() || null,
    message_id: row.sourceExternalId?.trim() || null,
    attachment_hash: row.primaryDoc?.sha256 ?? null,
    notes: row.notes ?? '',
    history: [],
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  }
}
