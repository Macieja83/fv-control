import { readApiErrorMessage } from './http'
const API = '/api/v1'

export type TenantProfileResponse = {
  id: string
  name: string
  nip: string | null
  createdAt: string
  updatedAt: string
  portalIntegrations: {
    bankConnected: boolean
    bankLabel: string | null
    ksefConfigured: boolean
    ksefClientNote: string | null
    updatedAt: string | null
  }
}

export async function fetchTenantProfile(token: string): Promise<TenantProfileResponse> {
  const res = await fetch(`${API}/tenant`, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(await readApiErrorMessage(res))
  return (await res.json()) as TenantProfileResponse
}

export async function patchTenantProfile(
  token: string,
  body: { name?: string; nip?: string | null },
): Promise<void> {
  const res = await fetch(`${API}/tenant`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await readApiErrorMessage(res))
}

export async function patchTenantIntegrations(
  token: string,
  body: Partial<{
    bankConnected: boolean
    bankLabel: string | null
    ksefConfigured: boolean
    ksefClientNote: string | null
  }>,
): Promise<TenantProfileResponse['portalIntegrations']> {
  const res = await fetch(`${API}/tenant/integrations`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await readApiErrorMessage(res))
  return (await res.json()) as TenantProfileResponse['portalIntegrations']
}

export type TenantKsefCredentialsPublic = {
  /** Efektywne API (serwer + ewentualne nadpisanie). */
  environment: string
  serverEnvironment: string
  ksefEnvOverride: 'sandbox' | 'production' | null
  tenantNip: string | null
  tenantNipOk: boolean
  storedCredential: boolean
  authMode: string | null
}

export type TenantKsefUpsertBody = {
  ksefTokenOrEncryptedBlob: string
  tokenPassword?: string | null
  certPemOrDerBase64?: string | null
}

export async function fetchTenantKsefCredentialsPublic(token: string): Promise<TenantKsefCredentialsPublic> {
  const res = await fetch(`${API}/tenant/ksef-credentials`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(await readApiErrorMessage(res))
  return (await res.json()) as TenantKsefCredentialsPublic
}

export async function putTenantKsefCredentials(token: string, body: TenantKsefUpsertBody): Promise<{ ok: boolean }> {
  const res = await fetch(`${API}/tenant/ksef-credentials`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await readApiErrorMessage(res))
  return (await res.json()) as { ok: boolean }
}

export async function deleteTenantKsefCredentials(token: string): Promise<{ ok: boolean }> {
  const res = await fetch(`${API}/tenant/ksef-credentials`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(await readApiErrorMessage(res))
  return (await res.json()) as { ok: boolean }
}

export type TenantKsefTestResult = {
  ok: boolean
  credentialSource: 'tenant' | 'global' | 'none'
  probe: 'saved' | 'draft'
  accessValidUntil?: string
  message?: string
}

/** Pusty `draft` = test zapisanych poświadczeń (tenant lub .env). */
export async function postTenantKsefConnectionTest(
  token: string,
  draft?: TenantKsefUpsertBody | null,
): Promise<TenantKsefTestResult> {
  const body =
    draft?.ksefTokenOrEncryptedBlob?.trim() ?
      JSON.stringify({
        ksefTokenOrEncryptedBlob: draft.ksefTokenOrEncryptedBlob,
        tokenPassword: draft.tokenPassword ?? null,
        certPemOrDerBase64: draft.certPemOrDerBase64 ?? null,
      })
    : JSON.stringify({})
  const res = await fetch(`${API}/tenant/ksef-credentials/test`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body,
  })
  if (!res.ok) throw new Error(await readApiErrorMessage(res))
  return (await res.json()) as TenantKsefTestResult
}
