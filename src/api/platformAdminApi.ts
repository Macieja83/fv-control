export type PlatformTenantRow = {
  id: string
  name: string
  nip: string | null
  createdAt: string
  userCount: number
  invoiceCount: number
  subscription: {
    status: string
    planCode: string
    provider: string
    providerCustomerId: string | null
    providerSubscriptionId: string | null
    currentPeriodEnd: string | null
    trialEndsAt: string | null
  } | null
}

export type PlatformAdminKsefRow = {
  tenantId: string
  name: string
  nip: string | null
  effectiveKsefEnv: string
  serverKsefEnv: string
  ksefEnvOverride: 'sandbox' | 'production' | null
  credentialSource: 'tenant' | 'global' | 'none'
  ksefInvoiceCount: number
  lastSyncHwmDate: unknown
  lastSyncRunAt: string | null
  lastSyncOk: boolean | null
  lastSyncPhase: string | null
  lastSyncErrorPreview: string | null
  lastQueueFinalFailure: boolean | null
  lastQueueError: string | null
  ingestionUpdatedAt: string | null
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

export async function fetchPlatformKsefOverview(token: string, limit = 200): Promise<PlatformAdminKsefRow[]> {
  const q = new URLSearchParams({ limit: String(limit) })
  const res = await fetch(`/api/v1/platform-admin/ksef-overview?${q}`, { headers: authHeader(token) })
  const body = (await res.json()) as { data?: PlatformAdminKsefRow[]; error?: { message?: string } }
  if (!res.ok) throw new Error(body.error?.message ?? `KSeF overview (${res.status})`)
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

export type ConnectorsPlatformRow = {
  tenantId: string
  tenantName: string | null
  tenantNip: string | null
  ingestionSources: number
  integrationCredentials: number
  integrationPos: number
  totalConnectors: number
}

export async function fetchConnectorsPlatformSummary(token: string): Promise<ConnectorsPlatformRow[]> {
  const res = await fetch('/api/v1/platform-admin/connectors-summary', { headers: authHeader(token) })
  const body = (await res.json()) as { data?: { rows: ConnectorsPlatformRow[] }; error?: { message?: string } }
  if (!res.ok) throw new Error(body.error?.message ?? `Connectory (${res.status})`)
  return Array.isArray(body.data?.rows) ? body.data!.rows : []
}
