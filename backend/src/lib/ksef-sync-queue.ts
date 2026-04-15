import { Queue } from "bullmq";
import { loadConfig } from "../config.js";
import { getRedisConnection } from "./redis-connection.js";
import { KSEF_SYNC_QUEUE_NAME } from "./queue-constants.js";
import type { KsefSyncJobData } from "../modules/ksef/ksef-sync.service.js";

let ksefQueue: Queue<KsefSyncJobData> | null = null;

export type KsefQueueSnapshot = {
  autoDedupeJobId: string;
  autoJobState: string | null;
  pendingOrActiveOtherJobs: number;
};

const SNAPSHOT_CACHE_MAX_KEYS = 512;
const snapshotCache = new Map<string, { expiresAt: number; value: KsefQueueSnapshot }>();

function pruneExpiredSnapshotCache(now: number): void {
  for (const [k, v] of snapshotCache) {
    if (v.expiresAt <= now) snapshotCache.delete(k);
  }
}

function evictOneSnapshotCacheEntry(): void {
  let oldestKey: string | null = null;
  let oldestExp = Infinity;
  for (const [k, v] of snapshotCache) {
    if (v.expiresAt < oldestExp) {
      oldestExp = v.expiresAt;
      oldestKey = k;
    }
  }
  if (oldestKey) snapshotCache.delete(oldestKey);
}

function invalidateKsefQueueSnapshotCache(tenantId: string): void {
  snapshotCache.delete(tenantId);
}

export function getKsefSyncQueue(): Queue<KsefSyncJobData> {
  if (!ksefQueue) {
    const cfg = loadConfig();
    ksefQueue = new Queue<KsefSyncJobData>(KSEF_SYNC_QUEUE_NAME, {
      connection: getRedisConnection(),
      prefix: cfg.BULLMQ_PREFIX,
    });
  }
  return ksefQueue;
}

export type EnqueueKsefSyncOptions = {
  /**
   * Jedna automatyczna pozycja na tenant (`jobId` stały) — nie dokładamy kolejnych,
   * dopóki poprzedni sync nie skończy się (MF: ~20 zapytań metadanych / h).
   */
  autoDedupe?: boolean;
};

export async function enqueueKsefSync(
  job: KsefSyncJobData,
  opts?: EnqueueKsefSyncOptions,
): Promise<{ jobId: string | undefined; skipped?: boolean }> {
  const q = getKsefSyncQueue();
  const autoJobId = opts?.autoDedupe === true ? `auto-ksef-${job.tenantId}` : undefined;

  if (autoJobId) {
    const existing = await q.getJob(autoJobId);
    if (existing) {
      const st = await existing.getState();
      /** BullMQ — nie stackujemy drugiego auto-syncu, dopóki pierwszy nie zakończy się lub nie padnie. */
      if (st === "waiting" || st === "delayed" || st === "active" || st === "waiting-children") {
        return { jobId: existing.id ?? autoJobId, skipped: true };
      }
      if (st === "failed") {
        try {
          await existing.remove();
        } catch {
          /* np. job właśnie w workerze */
        }
      }
    }
  }

  const bullJob = await q.add(KSEF_SYNC_QUEUE_NAME, job, {
    attempts: 3,
    backoff: { type: "exponential", delay: 10_000 },
    removeOnComplete: 200,
    removeOnFail: 500,
    ...(autoJobId ? { jobId: autoJobId } : {}),
  });
  invalidateKsefQueueSnapshotCache(job.tenantId);
  return { jobId: bullJob.id };
}

/** Id joba auto-sync dla tenanta (BullMQ deduplikacja). */
export function ksefAutoSyncJobId(tenantId: string): string {
  return `auto-ksef-${tenantId}`;
}

async function fetchKsefQueueSnapshotForTenantUncached(tenantId: string): Promise<KsefQueueSnapshot> {
  const q = getKsefSyncQueue();
  const autoId = ksefAutoSyncJobId(tenantId);
  const autoJob = await q.getJob(autoId);
  const autoJobState = autoJob ? await autoJob.getState() : null;

  const inFlight = await q.getJobs(["waiting", "delayed", "active", "waiting-children"], 0, 120);
  const pendingOrActiveOtherJobs = inFlight.filter((j) => {
    const id = j.id != null ? String(j.id) : "";
    if (id === autoId) return false;
    return j.data?.tenantId === tenantId;
  }).length;

  return {
    autoDedupeJobId: autoId,
    autoJobState,
    pendingOrActiveOtherJobs,
  };
}

/**
 * Stan kolejki KSeF dla tenanta (Redis). Przy braku Redis wywołujący może złapać wyjątek.
 * Krótki cache in-process (`KSEF_QUEUE_SNAPSHOT_CACHE_MS`) ogranicza obciążenie Redis przy odświeżaniu statusu.
 */
export async function getKsefQueueSnapshotForTenant(tenantId: string): Promise<KsefQueueSnapshot> {
  const ttl = loadConfig().KSEF_QUEUE_SNAPSHOT_CACHE_MS;
  if (ttl <= 0) return fetchKsefQueueSnapshotForTenantUncached(tenantId);

  const now = Date.now();
  pruneExpiredSnapshotCache(now);
  const hit = snapshotCache.get(tenantId);
  if (hit && hit.expiresAt > now) return hit.value;

  const value = await fetchKsefQueueSnapshotForTenantUncached(tenantId);

  while (snapshotCache.size >= SNAPSHOT_CACHE_MAX_KEYS) {
    evictOneSnapshotCacheEntry();
  }
  snapshotCache.set(tenantId, { value, expiresAt: now + ttl });
  return value;
}
