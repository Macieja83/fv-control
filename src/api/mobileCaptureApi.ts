import { readApiErrorMessage } from './http'
import type { UploadResult } from './uploadApi'

const API = '/api/v1'

export type MobileCaptureSessionResponse = {
  token: string
  expiresAt: string
}

export async function postMobileCaptureSession(token: string): Promise<MobileCaptureSessionResponse> {
  const res = await fetch(`${API}/ingestion/mobile-capture-session`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(await readApiErrorMessage(res))
  return (await res.json()) as MobileCaptureSessionResponse
}

export type MobileCaptureStatusResponse = {
  valid: boolean
  expiresAt: string
  uploadCount: number
  maxUploads: number
}

export async function getMobileCaptureStatusByToken(handoffToken: string): Promise<MobileCaptureStatusResponse> {
  const res = await fetch(
    `${API}/ingestion/mobile-capture/${encodeURIComponent(handoffToken)}/status`,
  )
  if (!res.ok) throw new Error(await readApiErrorMessage(res))
  return (await res.json()) as MobileCaptureStatusResponse
}

function isUploadResult(x: unknown): x is UploadResult {
  if (!x || typeof x !== 'object') return false
  const k = (x as { kind?: unknown }).kind
  return k === 'created' || k === 'idempotent_document'
}

export async function postMobileCaptureUpload(handoffToken: string, file: File): Promise<UploadResult> {
  const form = new FormData()
  form.append('file', file, file.name)
  const res = await fetch(
    `${API}/ingestion/mobile-capture/${encodeURIComponent(handoffToken)}/upload`,
    { method: 'POST', body: form },
  )
  if (!res.ok) throw new Error(await readApiErrorMessage(res))
  const body: unknown = await res.json()
  if (!isUploadResult(body)) {
    throw new Error('Nieprawidłowa odpowiedź serwera po przesłaniu pliku.')
  }
  return body
}
