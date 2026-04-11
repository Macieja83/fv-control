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

export async function fetchInvoicesList(
  token: string,
  opts?: {
    limit?: number
    page?: number
    documentKind?: string
    legalChannel?: string
    ledgerKind?: 'PURCHASE' | 'SALE'
  },
): Promise<InvoicesListResponse> {
  const limit = opts?.limit ?? 100
  const page = opts?.page ?? 1
  const q = new URLSearchParams({ limit: String(limit), page: String(page) })
  if (opts?.documentKind) q.set('documentKind', opts.documentKind)
  if (opts?.legalChannel) q.set('legalChannel', opts.legalChannel)
  if (opts?.ledgerKind) q.set('ledgerKind', opts.ledgerKind)
  const res = await fetch(`${API}/invoices?${q}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(await readErrorMessage(res))
  return (await res.json()) as InvoicesListResponse
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

export async function postSendInvoiceToKsef(token: string, invoiceId: string): Promise<unknown> {
  const res = await fetch(`${API}/invoices/${encodeURIComponent(invoiceId)}/send-to-ksef`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (res.status === 401) throw new Error('Sesja wygasła — zaloguj się ponownie.')
  if (!res.ok) throw new Error(await readErrorMessage(res))
  return (await res.json()) as unknown
}

export async function postCreateInvoice(
  token: string,
  body: Record<string, unknown>,
): Promise<unknown> {
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
  return (await res.json()) as unknown
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
