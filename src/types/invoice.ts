/** Źródło wpływu — Discord w MVP jako typ + filtr (integracja później). */
export type SourceType = 'email' | 'ksef' | 'discord'

/** Status operacyjny w inboxie (nie mylić z płatnością). */
export type InvoiceReviewStatus = 'cleared' | 'needs_review'

/** Potwierdzenie duplikatu przez operatora. */
export type DuplicateResolution = 'none' | 'confirmed' | 'rejected'

export type PaymentStatus = 'paid' | 'unpaid'

export type DocumentScope = 'business' | 'private'

export type CurrencyCode = 'PLN' | 'EUR' | 'USD'

export interface AuditEntry {
  id: string
  at: string
  actor: string
  action: string
  detail?: string
}

export interface InvoiceRecord {
  id: string
  source_type: SourceType
  /** Konto skrzynki / integracji KSeF / serwera Discord. */
  source_account: string
  restaurant_name: string
  supplier_name: string
  supplier_nip: string
  invoice_number: string
  issue_date: string
  due_date: string
  gross_amount: number
  currency: CurrencyCode
  category: string | null
  payment_status: PaymentStatus
  document_scope: DocumentScope
  review_status: InvoiceReviewStatus
  duplicate_score: number
  duplicate_of_id: string | null
  duplicate_reason: string | null
  duplicate_resolution: DuplicateResolution
  ksef_number: string | null
  message_id: string | null
  attachment_hash: string | null
  notes: string
  history: AuditEntry[]
  created_at: string
  updated_at: string
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

export const EMPTY_FILTERS: InvoiceFilters = {
  search: '',
  dateFrom: '',
  dateTo: '',
  supplier: '',
  source: '',
  reviewStatus: '',
  category: '',
  payment: '',
  scope: '',
  restaurant: '',
}
