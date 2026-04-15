const API = '/api/v1'

export type KsefSyncStats = {
  fetched?: number
  ingested?: number
  skippedDuplicate?: number
  refetched?: number
  errorCount?: number
}

export type KsefQueueStatus = {
  redisAvailable: boolean
  autoDedupeJobId: string
  autoJobState: string | null
  pendingOrActiveOtherJobs: number
  lastJobId: string | null
  lastJobState: 'completed' | 'failed' | 'retrying' | null
  lastJobFinishedAt: string | null
  lastJobError: string | null
  lastJobAttempts: number | null
  lastJobMaxAttempts: number | null
  /** Wyczerpane próby BullMQ — job trafił do „failed” bez dalszego retry. */
  lastJobFinalFailure: boolean | null
}

export type KsefConnectorStatus = {
  /** Efektywne API (nadpisanie tenanta lub KSEF_ENV). */
  environment: string
  /** Wartość KSEF_ENV na serwerze. */
  serverEnvironment?: string
  /** Nadpisanie z ustawień tenanta — gdy brak, używany jest serwer. */
  ksefEnvOverride?: 'sandbox' | 'production' | null
  configured: boolean
  /** Skąd biorą się poświadczenia: zapis tenanta, .env serwera, lub brak. */
  credentialSource?: 'tenant' | 'global' | 'none'
  nip: string | null
  issuanceMode: string
  issuanceLiveReady: boolean
  autoSyncIntervalMs: number
  lastSyncHwmDate: unknown
  lastSyncAt: string | null
  /** ISO — koniec ostatniego przebiegu joba sync (z metadanych). */
  lastSyncRunAt: string | null
  lastSyncOk: boolean | null
  lastSyncPhase: string | null
  lastSyncSkippedReason: string | null
  lastSyncStats: KsefSyncStats | null
  lastSyncErrorPreview: string | null
  invoiceCount: number
  queue: KsefQueueStatus
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

function emptyKsefQueue(): KsefQueueStatus {
  return {
    redisAvailable: false,
    autoDedupeJobId: '',
    autoJobState: null,
    pendingOrActiveOtherJobs: 0,
    lastJobId: null,
    lastJobState: null,
    lastJobFinishedAt: null,
    lastJobError: null,
    lastJobAttempts: null,
    lastJobMaxAttempts: null,
    lastJobFinalFailure: null,
  }
}

export async function fetchKsefConnectorStatus(token: string): Promise<KsefConnectorStatus> {
  const res = await fetch(`${API}/connectors/ksef/status`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(await readErrorMessage(res))
  const j = (await res.json()) as KsefConnectorStatus
  if (!j.queue) j.queue = emptyKsefQueue()
  return j
}

export type PostKsefSyncBody = { force?: boolean; fromDate?: string; toDate?: string }

/** Kolejkuje pełną synchronizację faktur przychodzących z KSeF (worker). Wymaga roli z prawem zapisu. */
export async function postKsefSync(
  token: string,
  body?: PostKsefSyncBody,
): Promise<{ queued: boolean; jobId?: string | number; dedupeSkipped?: boolean }> {
  const res = await fetch(`${API}/connectors/ksef/sync`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body ?? {}),
  })
  if (!res.ok) throw new Error(await readErrorMessage(res))
  return (await res.json()) as { queued: boolean; jobId?: string | number; dedupeSkipped?: boolean }
}

/** Środowisko API KSeF dla tenanta (`null` = zgodnie z KSEF_ENV serwera). */
export async function patchKsefConnectorSettings(
  token: string,
  ksefApiEnv: 'sandbox' | 'production' | null,
): Promise<{ ok: boolean }> {
  const res = await fetch(`${API}/connectors/ksef/settings`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `ksef-env-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    },
    body: JSON.stringify({ ksefApiEnv }),
  })
  if (!res.ok) throw new Error(await readErrorMessage(res))
  return (await res.json()) as { ok: boolean }
}
