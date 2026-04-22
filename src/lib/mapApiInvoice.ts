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
  const net = Number.parseFloat(row.netTotal)
  const vat = Number.parseFloat(row.vatTotal)
  const gross = Number.parseFloat(row.grossTotal)
  const dup = row.duplicateScore != null ? Number.parseFloat(row.duplicateScore) : 0
  const dupOf = row.duplicateCanonicalId?.trim() || null
  const dupNo = row.duplicateCanonicalNumber?.trim() || null

  const needsReviewByWorkflow =
    row.status === 'INGESTING' ||
    row.status === 'PENDING_REVIEW' ||
    row.status === 'FAILED_NEEDS_REVIEW' ||
    row.reviewStatus === 'NEEDS_REVIEW'

  const primaryDocMeta =
    row.primaryDoc?.metadata && typeof row.primaryDoc.metadata === 'object'
      ? (row.primaryDoc.metadata as Record<string, unknown>)
      : null
  const primaryDocKind =
    primaryDocMeta && typeof primaryDocMeta.kind === 'string' ? primaryDocMeta.kind : null

  return {
    id: row.id,
    primary_document_id: row.primaryDoc?.id ?? null,
    primary_document_mime: row.primaryDoc?.mimeType ?? null,
    primary_document_kind: primaryDocKind,
    invoice_status: row.status,
    source_type: mapIntakeToSource(row.intakeSourceType),
    source_account: row.sourceAccount?.trim() || '—',
    restaurant_name: row.tenant?.name?.trim() || '—',
    supplier_name: contractor?.name?.trim() || '—',
    supplier_nip: (contractor?.nip ?? '').replace(/\s/g, ''),
    invoice_number: row.number,
    issue_date: toYmd(row.issueDate),
    due_date: row.dueDate ? toYmd(row.dueDate) : '',
    net_amount: Number.isFinite(net) ? net : 0,
    vat_amount: Number.isFinite(vat) ? vat : 0,
    gross_amount: Number.isFinite(gross) ? gross : 0,
    intake_source_type: row.intakeSourceType,
    currency: mapCurrency(row.currency),
    category: row.reportCategory?.trim() || null,
    payment_status: row.status === 'PAID' ? 'paid' : 'unpaid',
    document_scope: row.legalChannel === 'EXCLUDED' ? 'private' : 'business',
    review_status: needsReviewByWorkflow ? 'needs_review' : 'cleared',
    duplicate_score: Number.isFinite(dup) ? dup : 0,
    duplicate_of_id: dupOf,
    duplicate_canonical_number: dupNo,
    duplicate_reason: dupOf
      ? dupNo
        ? `Duplikat faktury nr „${dupNo}” (oryginał w systemie — zwykle KSeF lub pierwszy import).`
        : 'Powiązany duplikat wykryty przy imporcie (NIP / kwota / data lub plik).'
      : null,
    duplicate_resolution: 'none',
    ksef_number:
      row.ksefNumber?.trim() ||
      (row.intakeSourceType === 'KSEF_API' ? row.sourceExternalId?.trim() || null : null) ||
      null,
    message_id: row.sourceExternalId?.trim() || null,
    attachment_hash: row.primaryDoc?.sha256 ?? null,
    notes: row.notes ?? '',
    history: [],
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    needs_contractor_verification: row.needsContractorVerification ?? false,
    extracted_vendor_nip: row.extractedVendorNip ?? null,
    document_kind: row.documentKind ?? 'OTHER',
    legal_channel: row.legalChannel ?? 'UNKNOWN',
    ledger_kind: row.ledgerKind === 'SALE' ? 'sale' : 'purchase',
    ksef_status: row.ksefStatus ?? undefined,
    ksef_required: row.ksefRequired === true,
    transfer: row.transfer,
  }
}
