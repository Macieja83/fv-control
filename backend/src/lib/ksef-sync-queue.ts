import { Queue } from "bullmq";
import { loadConfig } from "../config.js";
import { getRedisConnection } from "./redis-connection.js";
import { KSEF_SYNC_QUEUE_NAME } from "./queue-constants.js";
import type { KsefSyncJobData } from "../modules/ksef/ksef-sync.service.js";

let ksefQueue: Queue<KsefSyncJobData> | null = null;

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
      if (
        st === "waiting" ||
        st === "delayed" ||
        st === "active" ||
        st === "paused" ||
        st === "waiting-children"
      ) {
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
  return { jobId: bullJob.id };
}
