/** Źródło wpływu — Discord w MVP jako typ + filtr (integracja później). */
export type SourceType = 'email' | 'ksef' | 'discord'

/** Status operacyjny na liście faktur (nie mylić z płatnością). */
export type InvoiceReviewStatus = 'cleared' | 'needs_review'

/** Potwierdzenie duplikatu przez operatora. */
export type DuplicateResolution = 'none' | 'confirmed' | 'rejected'

export type PaymentStatus = 'paid' | 'unpaid'

export type DocumentScope = 'business' | 'private'

export type CurrencyCode = 'PLN' | 'EUR' | 'USD'

/** Koszt (zakup) vs sprzedaż wystawiana przez firmę — zgodnie z API `ledgerKind`. */
export type InvoiceLedgerKind = 'purchase' | 'sale'

export interface AuditEntry {
  id: string
  at: string
  actor: string
  action: string
  detail?: string
}

export interface InvoiceRecord {
  id: string
  /** UUID dokumentu głównego w API (różny od `id` faktury). */
  primary_document_id?: string | null
  /** Status z API (`Invoice.status`), np. INGESTING podczas OCR. */
  invoice_status?: string
  source_type: SourceType
  /** Konto skrzynki / integracji KSeF / serwera Discord. */
  source_account: string
  restaurant_name: string
  supplier_name: string
  supplier_nip: string
  invoice_number: string
  issue_date: string
  due_date: string
  net_amount: number
  gross_amount: number
  currency: CurrencyCode
  category: string | null
  payment_status: PaymentStatus
  document_scope: DocumentScope
  review_status: InvoiceReviewStatus
  duplicate_score: number
  duplicate_of_id: string | null
  /** Numer faktury oryginału, gdy `duplicate_of_id` wskazuje canonical. */
  duplicate_canonical_number?: string | null
  duplicate_reason: string | null
  duplicate_resolution: DuplicateResolution
  ksef_number: string | null
  message_id: string | null
  attachment_hash: string | null
  notes: string
  history: AuditEntry[]
  created_at: string
  updated_at: string
  /** Brak dopasowanego kontrahenta — sprawdź, czy to faktycznie koszt firmy. */
  needs_contractor_verification?: boolean
  extracted_vendor_nip?: string | null
  document_kind?: string
  legal_channel?: string
  ledger_kind?: InvoiceLedgerKind
  /** Z API: TO_ISSUE, PENDING, SENT, RECEIVED, … */
  ksef_status?: string
  ksef_required?: boolean
}

export interface InvoiceFilters {
  search: string
  dateFrom: string
  dateTo: string
  supplier: string
  source: '' | SourceType | 'discord_ready'
  reviewStatus: '' | InvoiceReviewStatus
  category: string
  payment: '' | PaymentStatus
  scope: '' | DocumentScope
  restaurant: string
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`
}

function localYmd(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function currentMonthRange(): { dateFrom: string; dateTo: string } {
  const now = new Date()
  return monthRange(now.getFullYear(), now.getMonth())
}

function monthRange(year: number, month: number): { dateFrom: string; dateTo: string } {
  const first = new Date(year, month, 1)
  const last = new Date(year, month + 1, 0)
  return {
    dateFrom: localYmd(first),
    dateTo: localYmd(last),
  }
}

export const EMPTY_FILTERS: InvoiceFilters = {
  search: '',
  ...currentMonthRange(),
  supplier: '',
  source: '',
  reviewStatus: '',
  category: '',
  payment: '',
  scope: '',
  restaurant: '',
}
