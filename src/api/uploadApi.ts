import { getStoredToken } from '../auth/session'

const API = '/api/v1'

export type UploadResult = {
  kind: 'created' | 'idempotent_document'
  documentId: string
  invoiceId: string
  processingJobId?: string
  message?: string
}

function isUploadResult(x: unknown): x is UploadResult {
  if (!x || typeof x !== 'object') return false
  const k = (x as { kind?: unknown }).kind
  return k === 'created' || k === 'idempotent_document'
}

export async function uploadInvoiceFile(file: File): Promise<UploadResult> {
  const token = getStoredToken()
  if (!token) throw new Error('Brak sesji — zaloguj się ponownie.')

  const form = new FormData()
  form.append('file', file, file.name)

  const res = await fetch(`${API}/ingestion/manual-upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })

  if (res.status === 401) throw new Error('Sesja wygasła — zaloguj się ponownie.')
  if (!res.ok) {
    let msg = `Błąd serwera (${res.status})`
    try {
      const j = (await res.json()) as { error?: { message?: string } }
      if (typeof j.error?.message === 'string') msg = j.error.message
    } catch { /* ignore */ }
    throw new Error(msg)
  }

  const body: unknown = await res.json()
  if (!isUploadResult(body)) {
    throw new Error('Nieprawidłowa odpowiedź serwera po przesłaniu pliku.')
  }
  return body
}
