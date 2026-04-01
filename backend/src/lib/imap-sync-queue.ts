import { Queue } from "bullmq";
import { loadConfig } from "../config.js";
import { getRedisConnection } from "./redis-connection.js";
import { IMAP_ZENBOX_SYNC_QUEUE_NAME } from "./queue-constants.js";

export type ImapZenboxSyncJobData = {
  tenantId: string;
  accountKey: string;
  triggeredByUserId?: string | null;
};

let imapQueue: Queue<ImapZenboxSyncJobData> | null = null;

export function getImapZenboxSyncQueue(): Queue<ImapZenboxSyncJobData> {
  if (!imapQueue) {
    const cfg = loadConfig();
    imapQueue = new Queue<ImapZenboxSyncJobData>(IMAP_ZENBOX_SYNC_QUEUE_NAME, {
      connection: getRedisConnection(),
      prefix: cfg.BULLMQ_PREFIX,
    });
  }
  return imapQueue;
}

export async function enqueueZenboxImapSync(job: ImapZenboxSyncJobData): Promise<{ jobId: string | undefined }> {
  const q = getImapZenboxSyncQueue();
  const bullJob = await q.add(
    IMAP_ZENBOX_SYNC_QUEUE_NAME,
    job,
    {
      attempts: 6,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: 500,
      removeOnFail: 2000,
    },
  );
  return { jobId: bullJob.id };
}
