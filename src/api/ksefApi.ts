import { readApiErrorMessage } from './http'
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

/** Błąd POST sync — 429: dołącza sekundy z `Retry-After` lub `details.retryAfterSec`, jeśli brak w treści. */
async function readPostKsefSyncError(res: Response): Promise<string> {
  const retryHeader = res.headers.get('Retry-After')
  let fromHeader: number | undefined
  if (retryHeader) {
    const n = parseInt(retryHeader, 10)
    if (!Number.isNaN(n) && n > 0) fromHeader = n
  }
  let bodyMsg = `HTTP ${res.status}`
  let fromDetails: number | undefined
  try {
    const raw = await res.text()
    if (raw) {
      const j = JSON.parse(raw) as {
        error?: { message?: string; details?: { retryAfterSec?: unknown } }
      }
      if (typeof j.error?.message === 'string') bodyMsg = j.error.message
      const d = j.error?.details?.retryAfterSec
      if (typeof d === 'number' && Number.isFinite(d) && d > 0) fromDetails = Math.ceil(d)
    }
  } catch {
    /* keep defaults */
  }
  if (res.status === 429) {
    const sec = fromDetails ?? fromHeader
    const alreadyHasSeconds =
      /\b\d+\s*s\.?\b/i.test(bodyMsg) || /za ok\.\s*\d+/i.test(bodyMsg) || /ponownie za ok/i.test(bodyMsg)
    if (sec != null && sec > 0 && !alreadyHasSeconds) {
      return `${bodyMsg.trim()} Możesz spróbować ponownie za ok. ${sec} s.`
    }
  }
  return bodyMsg
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
  if (!res.ok) throw new Error(await readApiErrorMessage(res))
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
  if (!res.ok) throw new Error(await readPostKsefSyncError(res))
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
  if (!res.ok) throw new Error(await readApiErrorMessage(res))
  return (await res.json()) as { ok: boolean }
}
