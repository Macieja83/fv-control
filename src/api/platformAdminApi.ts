export type PlatformTenantRow = {
  id: string
  name: string
  nip: string | null
  userCount: number
  invoiceCount: number
  subscription: { status: string; planCode: string } | null
}

function authHeader(token: string) {
  return { Authorization: `Bearer ${token}` }
}

export async function fetchPlatformTenants(token: string): Promise<PlatformTenantRow[]> {
  const res = await fetch('/api/v1/platform-admin/tenants', { headers: authHeader(token) })
  const body = (await res.json()) as { data?: PlatformTenantRow[]; error?: { message?: string } }
  if (!res.ok) throw new Error(body.error?.message ?? `Nie udało się pobrać tenantów (${res.status})`)
  return Array.isArray(body.data) ? body.data : []
}

export async function issueImpersonationToken(token: string, tenantId: string): Promise<string> {
  const res = await fetch('/api/v1/platform-admin/impersonate', {
    method: 'POST',
    headers: { ...authHeader(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenantId }),
  })
  const body = (await res.json()) as { accessToken?: string; error?: { message?: string } }
  if (!res.ok || !body.accessToken) throw new Error(body.error?.message ?? `Impersonacja nieudana (${res.status})`)
  return body.accessToken
}
