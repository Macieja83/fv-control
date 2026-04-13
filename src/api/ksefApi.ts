const API = '/api/v1'

export type KsefConnectorStatus = {
  environment: string
  configured: boolean
  nip: string | null
  issuanceMode: string
  issuanceLiveReady: boolean
  autoSyncIntervalMs: number
  lastSyncHwmDate: unknown
  lastSyncAt: string | null
  invoiceCount: number
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

export async function fetchKsefConnectorStatus(token: string): Promise<KsefConnectorStatus> {
  const res = await fetch(`${API}/connectors/ksef/status`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(await readErrorMessage(res))
  return (await res.json()) as KsefConnectorStatus
}

export type PostKsefSyncBody = { force?: boolean; fromDate?: string; toDate?: string }

/** Kolejkuje pełną synchronizację faktur przychodzących z KSeF (worker). Wymaga roli z prawem zapisu. */
export async function postKsefSync(
  token: string,
  body?: PostKsefSyncBody,
): Promise<{ queued: boolean; jobId?: string | number }> {
  const res = await fetch(`${API}/connectors/ksef/sync`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body ?? {}),
  })
  if (!res.ok) throw new Error(await readErrorMessage(res))
  return (await res.json()) as { queued: boolean; jobId?: string | number }
}
