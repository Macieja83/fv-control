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

async function readErrorMessage(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { error?: { message?: string } }
    if (typeof j.error?.message === 'string') return j.error.message
  } catch {
    /* ignore */
  }
  return `HTTP ${res.status}`
}

export async function fetchTenantProfile(token: string): Promise<TenantProfileResponse> {
  const res = await fetch(`${API}/tenant`, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(await readErrorMessage(res))
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
  if (!res.ok) throw new Error(await readErrorMessage(res))
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
  if (!res.ok) throw new Error(await readErrorMessage(res))
  return (await res.json()) as TenantProfileResponse['portalIntegrations']
}
