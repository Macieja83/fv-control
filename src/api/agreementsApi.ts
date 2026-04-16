import { getStoredToken } from '../auth/session'
import { readApiErrorMessage } from './http'

const API = '/api/v1'

export type AgreementStatus = 'PROCESSING' | 'READY' | 'FAILED'

export type AgreementListRow = {
  id: string
  tenantId: string
  contractorId: string | null
  primaryDocId: string
  title: string
  subject: string | null
  counterpartyName: string | null
  counterpartyNip: string | null
  signedAt: string | null
  validUntil: string | null
  status: AgreementStatus
  notes: string | null
  createdAt: string
  updatedAt: string
  primaryDoc: { id: string; mimeType: string; metadata: unknown }
  contractor: { id: string; name: string; nip: string } | null
}

export type AgreementDetail = AgreementListRow & {
  normalizedPayload: unknown
}

function tokenOrThrow(): string {
  const token = getStoredToken()
  if (!token) throw new Error('Brak sesji — zaloguj się ponownie.')
  return token
}

export async function fetchAgreements(): Promise<AgreementListRow[]> {
  const token = tokenOrThrow()
  const res = await fetch(`${API}/agreements`, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(await readApiErrorMessage(res))
  return (await res.json()) as AgreementListRow[]
}

export async function fetchAgreement(id: string): Promise<AgreementDetail> {
  const token = tokenOrThrow()
  const res = await fetch(`${API}/agreements/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(await readApiErrorMessage(res))
  return (await res.json()) as AgreementDetail
}

export async function patchAgreement(
  id: string,
  body: {
    title?: string
    subject?: string | null
    counterpartyName?: string | null
    counterpartyNip?: string | null
    signedAt?: string | null
    validUntil?: string | null
    notes?: string | null
    contractorId?: string | null
  },
): Promise<AgreementDetail> {
  const token = tokenOrThrow()
  const res = await fetch(`${API}/agreements/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await readApiErrorMessage(res))
  return (await res.json()) as AgreementDetail
}

export async function uploadAgreementFile(file: File): Promise<AgreementDetail> {
  const token = tokenOrThrow()
  const form = new FormData()
  form.append('file', file, file.name)
  const res = await fetch(`${API}/agreements/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })
  if (!res.ok) throw new Error(await readApiErrorMessage(res))
  return (await res.json()) as AgreementDetail
}

/** Pobiera plik z API i zwraca URL obiektu do podglądu (wywołaj revokeObjectURL po zamknięciu). */
export async function openAgreementDocumentBlobUrl(id: string): Promise<string> {
  const token = tokenOrThrow()
  const res = await fetch(`${API}/agreements/${encodeURIComponent(id)}/download`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(await readApiErrorMessage(res))
  const blob = await res.blob()
  return URL.createObjectURL(blob)
}
