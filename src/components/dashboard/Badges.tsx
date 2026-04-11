import type { DocumentScope, InvoiceRecord, PaymentStatus, SourceType } from '../../types/invoice'

const payClass: Record<PaymentStatus, string> = {
  paid: 'badge badge--pay-paid',
  unpaid: 'badge badge--pay-unpaid',
}

const scopeClass: Record<DocumentScope, string> = {
  business: 'badge badge--scope-biz',
  private: 'badge badge--scope-private',
}

const sourceLabel: Record<SourceType, string> = {
  email: 'E-mail',
  ksef: 'KSeF',
  discord: 'Discord',
}

export function PaymentBadge({ status }: { status: PaymentStatus }) {
  return (
    <span className={payClass[status]}>
      {status === 'paid' ? 'Zapłacona' : 'Niezapłacona'}
    </span>
  )
}

export function ScopeBadge({ scope }: { scope: DocumentScope }) {
  return (
    <span className={scopeClass[scope]}>{scope === 'business' ? 'Firmowa' : 'Prywatna'}</span>
  )
}

export function SourceBadge({ type }: { type: SourceType }) {
  return <span className="badge badge--source">{sourceLabel[type]}</span>
}

export function UnknownVendorBadge({ row }: { row: InvoiceRecord }) {
  if (!row.needs_contractor_verification) return null
  const nip = row.extracted_vendor_nip || row.supplier_nip
  const label = nip?.trim() ? nip.trim() : 'brak NIP w danych'
  return (
    <span className="badge badge--vendor-unknown" title="Kontrahent nie jest na liście — dodaj go w szczegółach faktury lub w module Kontrahenci.">
      Nowy kontrahent · {label}
    </span>
  )
}

export function ReviewBadge({ row }: { row: InvoiceRecord }) {
  if (row.invoice_status === 'INGESTING') {
    return <span className="badge badge--review">OCR / kolejka…</span>
  }
  if (row.review_status === 'needs_review') {
    return <span className="badge badge--review">Do sprawdzenia</span>
  }
  return <span className="badge badge--muted">OK</span>
}

export function DuplicateBadge({ row }: { row: InvoiceRecord }) {
  const dupHint =
    row.duplicate_canonical_number?.trim() != null && row.duplicate_canonical_number.trim().length > 0
      ? `Duplikat względem faktury nr ${row.duplicate_canonical_number.trim()}`
      : row.duplicate_of_id
        ? 'Duplikat — otwórz szczegóły, by zobaczyć powiązanie z oryginałem'
        : undefined
  if (row.duplicate_resolution === 'confirmed') {
    return (
      <span className="badge badge--dup-confirmed" title={dupHint}>
        Duplikat ✓
      </span>
    )
  }
  if (row.duplicate_resolution === 'rejected') {
    return <span className="badge badge--muted">Odrzucono</span>
  }
  if (row.duplicate_score >= 1) {
    return (
      <span className="badge badge--dup-hard" title={dupHint}>
        {Math.round(row.duplicate_score * 100)}%
      </span>
    )
  }
  if (row.duplicate_score >= 0.85) {
    return (
      <span className="badge badge--dup-soft" title={dupHint}>
        {Math.round(row.duplicate_score * 100)}%
      </span>
    )
  }
  if (row.duplicate_score >= 0.72) {
    return (
      <span className="badge badge--dup-soft" title={dupHint}>
        {Math.round(row.duplicate_score * 100)}%
      </span>
    )
  }
  return <span className="badge badge--muted">—</span>
}
