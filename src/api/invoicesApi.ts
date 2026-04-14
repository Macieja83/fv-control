const API = '/api/v1'

export type ApiInvoiceListRow = {
  id: string
  number: string
  issueDate: string
  dueDate: string | null
  saleDate: string | null
  currency: string
  netTotal: string
  vatTotal: string
  grossTotal: string
  status: string
  notes: string | null
  sourceAccount: string | null
  sourceExternalId: string | null
  intakeSourceType: string
  legalChannel: string
  reviewStatus: string
  ksefNumber: string | null
  duplicateScore: string | null
  /** Faktura „oryginał”, jeśli ten wpis jest kandydatem na duplikat (z tabeli invoice_duplicates). */
  duplicateCanonicalId: string | null
  /** Numer faktury oryginału (canonical), gdy ten wiersz jest duplikatem. */
  duplicateCanonicalNumber?: string | null
  createdAt: string
  updatedAt: string
  contractor: { id: string; name: string; nip: string | null } | null
  tenant: { name: string }
  primaryDoc: { id: string; sha256: string } | null
  _count: { items: number; files: number }
  documentKind?: string
  ledgerKind?: string
  ksefStatus?: string
  ksefRequired?: boolean
  needsContractorVerification?: boolean
  extractedVendorNip?: string | null
  transfer?: {
    transferRecipient: string | null
    transferBankAccount: string | null
    transferBankName: string | null
    transferTitle: string | null
    transferAmount: string
    transferCurrency: string
  }
}

export type InvoicesListResponse = {
  data: ApiInvoiceListRow[]
  meta: { total: number; page: number; limit: number; totalPages: number }
}

async function readErrorMessage(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { error?: { message?: string } }
    if (typeof j.error?.message === 'string') return j.error.message
  } catch {
    /* ignore */
  }
  return `HTTP ${res.status}`
}

export type FetchInvoicesListOpts = {
  limit?: number
  page?: number
  /** YYYY-MM-DD — pole `issueDate` w bazie (jak „data wystawienia” w KSeF). */
  dateFrom?: string
  dateTo?: string
  q?: string
  documentKind?: string
  legalChannel?: string
  ledgerKind?: 'PURCHASE' | 'SALE'
}

export async function fetchInvoicesList(
  token: string,
  opts?: FetchInvoicesListOpts,
): Promise<InvoicesListResponse> {
  const limit = opts?.limit ?? 100
  const page = opts?.page ?? 1
  const q = new URLSearchParams({ limit: String(limit), page: String(page) })
  if (opts?.documentKind) q.set('documentKind', opts.documentKind)
  if (opts?.legalChannel) q.set('legalChannel', opts.legalChannel)
  if (opts?.ledgerKind) q.set('ledgerKind', opts.ledgerKind)
  if (opts?.dateFrom) q.set('dateFrom', opts.dateFrom)
  if (opts?.dateTo) q.set('dateTo', opts.dateTo)
  if (opts?.q) q.set('q', opts.q)
  const res = await fetch(`${API}/invoices?${q}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(await readErrorMessage(res))
  return (await res.json()) as InvoicesListResponse
}

/** Pobiera wszystkie strony listy (limit max. 100/strona wg API), żeby widok miesiąca nie ucinał rekordów. */
export async function fetchInvoicesListAllPages(
  token: string,
  opts: FetchInvoicesListOpts & { maxPages?: number },
): Promise<InvoicesListResponse> {
  const maxPages = opts.maxPages ?? 50
  const limit = Math.min(opts.limit ?? 100, 100)
  const slice: FetchInvoicesListOpts = {
    limit,
    documentKind: opts.documentKind,
    legalChannel: opts.legalChannel,
    ledgerKind: opts.ledgerKind,
    dateFrom: opts.dateFrom,
    dateTo: opts.dateTo,
    q: opts.q,
  }
  const first = await fetchInvoicesList(token, { ...slice, page: 1 })
  const acc = [...first.data]
  let page = 1
  while (page < first.meta.totalPages && page < maxPages) {
    page++
    const next = await fetchInvoicesList(token, { ...slice, page })
    acc.push(...next.data)
  }
  return {
    data: acc,
    meta: {
      ...first.meta,
      page: 1,
      limit: acc.length,
      totalPages: 1,
      total: first.meta.total,
    },
  }
}

export async function patchInvoice(
  token: string,
  invoiceId: string,
  body: Record<string, unknown>,
): Promise<void> {
  const res = await fetch(`${API}/invoices/${encodeURIComponent(invoiceId)}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await readErrorMessage(res))
}

export async function patchInvoiceStatus(
  token: string,
  invoiceId: string,
  status: string,
): Promise<void> {
  const res = await fetch(`${API}/invoices/${encodeURIComponent(invoiceId)}/status`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ status }),
  })
  if (!res.ok) throw new Error(await readErrorMessage(res))
}

export async function deleteInvoiceRequest(token: string, invoiceId: string): Promise<void> {
  const res = await fetch(`${API}/invoices/${encodeURIComponent(invoiceId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(await readErrorMessage(res))
}

export type RetryExtractionResponse = {
  invoiceId: string
  documentId: string
  processingJobId: string
}

export type InvoiceEventRow = {
  id: string
  invoiceId: string
  actorUserId: string | null
  type: string
  payload: unknown
  createdAt: string
}

export async function postSendInvoiceToKsef(token: string, invoiceId: string): Promise<unknown> {
  const res = await fetch(`${API}/invoices/${encodeURIComponent(invoiceId)}/send-to-ksef`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (res.status === 401) throw new Error('Sesja wygasła — zaloguj się ponownie.')
  if (!res.ok) throw new Error(await readErrorMessage(res))
  return (await res.json()) as unknown
}

export type ApiInvoiceCreateResponse = { id: string } & Record<string, unknown>

export async function postCreateInvoice(
  token: string,
  body: Record<string, unknown>,
): Promise<ApiInvoiceCreateResponse> {
  const res = await fetch(`${API}/invoices`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (res.status === 401) throw new Error('Sesja wygasła — zaloguj się ponownie.')
  if (!res.ok) throw new Error(await readErrorMessage(res))
  const data = (await res.json()) as ApiInvoiceCreateResponse
  if (typeof data.id !== 'string') throw new Error('API: brak id utworzonej faktury.')
  return data
}

export type RehydrateFromKsefResponse = {
  invoiceId: string
  xmlDocumentId: string
  ksefNumber: string
  storageKey: string
  storageBucket: string | null
  processingJobId: string | null
}

/** Ponownie pobiera XML z MF, zapisuje w storage i kolejkuje pipeline (naprawa 404 podglądu). */
export async function postRehydrateKsefInvoice(
  token: string,
  invoiceId: string,
): Promise<RehydrateFromKsefResponse> {
  const res = await fetch(`${API}/invoices/${encodeURIComponent(invoiceId)}/rehydrate-from-ksef`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (res.status === 401) throw new Error('Sesja wygasła — zaloguj się ponownie.')
  if (!res.ok) throw new Error(await readErrorMessage(res))
  return (await res.json()) as RehydrateFromKsefResponse
}

export async function postRetryInvoiceExtraction(
  token: string,
  invoiceOrDocumentId: string,
): Promise<RetryExtractionResponse> {
  const res = await fetch(
    `${API}/invoices/${encodeURIComponent(invoiceOrDocumentId)}/retry-extraction`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    },
  )
  if (res.status === 401) throw new Error('Sesja wygasła — zaloguj się ponownie.')
  if (!res.ok) throw new Error(await readErrorMessage(res))
  return (await res.json()) as RetryExtractionResponse
}

export async function fetchInvoiceEvents(token: string, invoiceId: string): Promise<InvoiceEventRow[]> {
  const res = await fetch(`${API}/invoices/${encodeURIComponent(invoiceId)}/events`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (res.status === 401) throw new Error('Sesja wygasła — zaloguj się ponownie.')
  if (!res.ok) throw new Error(await readErrorMessage(res))
  return (await res.json()) as InvoiceEventRow[]
}

export type InvoicePispPaymentState = {
  enabled: boolean
  reason: 'not_configured' | 'integration_pending' | 'already_paid'
  message: string
  transfer: ApiInvoiceListRow['transfer'] | null
}

export async function fetchInvoicePispPaymentState(
  token: string,
  invoiceId: string,
): Promise<InvoicePispPaymentState> {
  const res = await fetch(`${API}/invoices/${encodeURIComponent(invoiceId)}/payment/pisp`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (res.status === 401) throw new Error('Sesja wygasła — zaloguj się ponownie.')
  if (!res.ok) throw new Error(await readErrorMessage(res))
  return (await res.json()) as InvoicePispPaymentState
}

export type AdoptVendorResponse = { contractorId: string; created: boolean }

export async function postAdoptInvoiceVendor(
  token: string,
  invoiceId: string,
  body?: { nip?: string; name?: string },
): Promise<AdoptVendorResponse> {
  const res = await fetch(`${API}/invoices/${encodeURIComponent(invoiceId)}/adopt-vendor`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body ?? {}),
  })
  if (res.status === 401) throw new Error('Sesja wygasła — zaloguj się ponownie.')
  if (!res.ok) throw new Error(await readErrorMessage(res))
  return (await res.json()) as AdoptVendorResponse
}
