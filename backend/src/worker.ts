import "dotenv/config";
import type { Job } from "bullmq";
import { UnrecoverableError, Worker } from "bullmq";
import { PrismaClient } from "@prisma/client";
import { loadConfig } from "./config.js";
import { runPipelineJob } from "./modules/pipeline/pipeline-orchestrator.js";
import {
  runIdempotencyCleanup,
  refreshIdempotencyActiveGauge,
  runWebhookOutboxSentCleanup,
} from "./lib/housekeeping.js";
import { sweepWebhookOutbox } from "./modules/webhooks/webhook-delivery.service.js";
import { getRedisConnection } from "./lib/redis-connection.js";
import { IMAP_ZENBOX_SYNC_QUEUE_NAME, PIPELINE_QUEUE_NAME } from "./lib/queue-constants.js";
import type { ImapZenboxSyncJobData } from "./lib/imap-sync-queue.js";
import { runZenboxImapSyncJob } from "./modules/zenbox/zenbox-imap-sync.service.js";
import { ZenboxImapPermanentError } from "./modules/zenbox/zenbox-imap-errors.js";

type PipelineJobData = { processingJobId: string };

const prisma = new PrismaClient();
const cfg = loadConfig();

const connection = getRedisConnection();

const worker = new Worker<PipelineJobData>(
  PIPELINE_QUEUE_NAME,
  async (job: Job<PipelineJobData>) => {
    const processingJobId = job.data.processingJobId;
    if (!processingJobId) {
      throw new Error("Missing processingJobId in job payload");
    }
    await runPipelineJob(prisma, processingJobId);
  },
  { connection, prefix: cfg.BULLMQ_PREFIX, concurrency: 4 },
);

const imapZenboxWorker = new Worker<ImapZenboxSyncJobData>(
  IMAP_ZENBOX_SYNC_QUEUE_NAME,
  async (job: Job<ImapZenboxSyncJobData>) => {
    try {
      await runZenboxImapSyncJob(prisma, connection, job.data);
    } catch (e) {
      if (e instanceof ZenboxImapPermanentError) {
        throw new UnrecoverableError(e.message);
      }
      throw e;
    }
  },
  { connection, prefix: cfg.BULLMQ_PREFIX, concurrency: 1 },
);

worker.on("failed", (job, err) => {
  void (async () => {
    const id = job?.data?.processingJobId;
    if (!id) return;
    const max = job.opts.attempts ?? 1;
    if (job.attemptsMade < max) return;
    const msg = err instanceof Error ? err.message : String(err);
    await prisma.processingJob.updateMany({
      where: { id },
      data: { status: "DEAD_LETTER", lastError: msg },
    });
    const row = await prisma.processingJob.findUnique({
      where: { id },
      select: { invoiceId: true },
    });
    if (row?.invoiceId) {
      await prisma.invoice.updateMany({
        where: { id: row.invoiceId },
        data: { status: "FAILED_NEEDS_REVIEW" },
      });
    }
  })();
});

worker.on("completed", () => {
  /* logged per job in orchestrator metrics */
});

const webhookTimer = setInterval(() => {
  void sweepWebhookOutbox(prisma).catch((err) => {
    console.error("webhook outbox sweep failed", err);
  });
}, cfg.WEBHOOK_DELIVERY_INTERVAL_MS);
webhookTimer.unref();

const housekeepingTimer = setInterval(() => {
  void (async () => {
    try {
      await runIdempotencyCleanup(prisma);
      await runWebhookOutboxSentCleanup(prisma);
      await refreshIdempotencyActiveGauge(prisma);
    } catch (err) {
      console.error("housekeeping failed", err);
    }
  })();
}, cfg.HOUSEKEEPING_INTERVAL_MS);
housekeepingTimer.unref();

process.on("SIGTERM", () => {
  void (async () => {
    clearInterval(webhookTimer);
    clearInterval(housekeepingTimer);
    await imapZenboxWorker.close();
    await worker.close();
    await prisma.$disconnect();
    process.exit(0);
  })();
});

console.info(
  `FVControl worker: pipeline ${PIPELINE_QUEUE_NAME}, IMAP ${IMAP_ZENBOX_SYNC_QUEUE_NAME} (prefix=${cfg.BULLMQ_PREFIX}); webhooks every ${cfg.WEBHOOK_DELIVERY_INTERVAL_MS}ms`,
);
