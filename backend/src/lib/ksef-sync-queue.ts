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

export async function enqueueKsefSync(job: KsefSyncJobData): Promise<{ jobId: string | undefined }> {
  const q = getKsefSyncQueue();
  const bullJob = await q.add(KSEF_SYNC_QUEUE_NAME, job, {
    attempts: 3,
    backoff: { type: "exponential", delay: 10_000 },
    removeOnComplete: 200,
    removeOnFail: 500,
  });
  return { jobId: bullJob.id };
}
