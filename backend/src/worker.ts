import "dotenv/config";
import type { Job } from "bullmq";
import { UnrecoverableError, Worker } from "bullmq";
import { PrismaClient } from "@prisma/client";
import { loadConfig } from "./config.js";
import { runPipelineJob } from "./modules/pipeline/pipeline-orchestrator.js";
import {
  runIdempotencyCleanup,
  refreshIdempotencyActiveGauge,
} from "./lib/housekeeping.js";
import { getRedisConnection } from "./lib/redis-connection.js";
import { IMAP_ZENBOX_SYNC_QUEUE_NAME, KSEF_SYNC_QUEUE_NAME, PIPELINE_QUEUE_NAME } from "./lib/queue-constants.js";
import { enqueueZenboxImapSync } from "./lib/imap-sync-queue.js";
import type { ImapZenboxSyncJobData } from "./lib/imap-sync-queue.js";
import { runZenboxImapSyncJob } from "./modules/zenbox/zenbox-imap-sync.service.js";
import { ZenboxImapPermanentError } from "./modules/zenbox/zenbox-imap-errors.js";
import { enqueueKsefSync } from "./lib/ksef-sync-queue.js";
import { mergeKsefQueueTelemetry } from "./modules/ksef/ksef-queue-telemetry.service.js";
import { getEffectiveKsefApiEnv } from "./modules/ksef/ksef-effective-env.js";
import { runKsefSyncJob, type KsefSyncJobData } from "./modules/ksef/ksef-sync.service.js";
import { tenantCanRunKsefSync } from "./modules/ksef/ksef-tenant-credentials.service.js";

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

/** Domyślny lock BullMQ (~30s) jest za krótki: sync KSeF czeka na 429 MF (nawet kilka min) i ma pauzę przed Issue — bez tego: „could not renew lock”. */
const KSEF_SYNC_LOCK_MS = 3_600_000;

const ksefWorker = new Worker<KsefSyncJobData>(
  KSEF_SYNC_QUEUE_NAME,
  async (job: Job<KsefSyncJobData>) => {
    await runKsefSyncJob(prisma, job.data, {
      queueJobId: job.id != null ? String(job.id) : null,
    });
  },
  { connection, prefix: cfg.BULLMQ_PREFIX, concurrency: 1, lockDuration: KSEF_SYNC_LOCK_MS },
);

ksefWorker.on("completed", (job: Job<KsefSyncJobData>) => {
  void mergeKsefQueueTelemetry(prisma, job.data.tenantId, {
    lastQueueJobId: job.id != null ? String(job.id) : null,
    lastQueueJobState: "completed",
    lastQueueFinishedAt: new Date().toISOString(),
    lastQueueAttempts: job.attemptsMade,
    lastQueueMaxAttempts: job.opts.attempts ?? 3,
    lastQueueError: null,
    lastQueueFinalFailure: false,
  });
});

ksefWorker.on("failed", (job: Job<KsefSyncJobData> | undefined, err: unknown) => {
  if (!job?.data?.tenantId) return;
  const max = job.opts.attempts ?? 3;
  const attempts = job.attemptsMade;
  const willRetry = attempts < max;
  const msg = err instanceof Error ? err.message : String(err);
  void mergeKsefQueueTelemetry(prisma, job.data.tenantId, {
    lastQueueJobId: job.id != null ? String(job.id) : null,
    lastQueueJobState: willRetry ? "retrying" : "failed",
    lastQueueFinishedAt: new Date().toISOString(),
    lastQueueAttempts: attempts,
    lastQueueMaxAttempts: max,
    lastQueueError: msg.slice(0, 600),
    lastQueueFinalFailure: !willRetry,
  });
});

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

async function autoScheduleImapSync(): Promise<void> {
  try {
    const mailboxes = await prisma.mailbox.findMany({
      where: { isActive: true, provider: "IMAP" },
      include: { syncState: true },
    });
    for (const mb of mailboxes) {
      if (mb.syncState?.imapSyncStatus === "RUNNING") continue;
      await enqueueZenboxImapSync({
        tenantId: mb.tenantId,
        accountKey: mb.label,
      }).catch(() => {});
    }
  } catch (err) {
    console.error("auto imap sync scheduling failed", err);
  }
}

const imapAutoSyncTimer =
  cfg.IMAP_AUTO_SYNC_INTERVAL_MS > 0
    ? setInterval(() => {
        void autoScheduleImapSync();
      }, cfg.IMAP_AUTO_SYNC_INTERVAL_MS)
    : null;
imapAutoSyncTimer?.unref();

if (cfg.IMAP_AUTO_SYNC_INTERVAL_MS > 0) {
  void autoScheduleImapSync();
}

async function autoScheduleKsefSync(): Promise<void> {
  try {
    const tenants = await prisma.tenant.findMany({ select: { id: true } });
    for (const t of tenants) {
      const effective = await getEffectiveKsefApiEnv(prisma, t.id);
      if (effective === "mock") continue;
      const can = await tenantCanRunKsefSync(prisma, t.id);
      if (!can) continue;
      try {
        const r = await enqueueKsefSync({ tenantId: t.id }, { autoDedupe: true });
        if (r.skipped) {
          console.info(
            `[KSeF auto] Pominięto enqueue — sync dla tenant ${t.id} już w kolejce lub w toku (bez stackowania wobec limitów MF).`,
          );
        }
      } catch (e) {
        console.warn(
          `[KSeF auto] enqueue tenant ${t.id}:`,
          e instanceof Error ? e.message : String(e),
        );
      }
    }
  } catch (err) {
    console.error("auto ksef sync scheduling failed", err);
  }
}

const ksefAutoSyncTimer =
  cfg.KSEF_AUTO_SYNC_INTERVAL_MS > 0
    ? setInterval(() => {
        void autoScheduleKsefSync();
      }, cfg.KSEF_AUTO_SYNC_INTERVAL_MS)
    : null;
ksefAutoSyncTimer?.unref();

if (cfg.KSEF_AUTO_SYNC_INTERVAL_MS > 0) {
  void autoScheduleKsefSync();
}

const housekeepingTimer = setInterval(() => {
  void (async () => {
    try {
      await runIdempotencyCleanup(prisma);
      await refreshIdempotencyActiveGauge(prisma);
    } catch (err) {
      console.error("housekeeping failed", err);
    }
  })();
}, cfg.HOUSEKEEPING_INTERVAL_MS);
housekeepingTimer.unref();

process.on("SIGTERM", () => {
  void (async () => {
    clearInterval(housekeepingTimer);
    if (imapAutoSyncTimer) clearInterval(imapAutoSyncTimer);
    if (ksefAutoSyncTimer) clearInterval(ksefAutoSyncTimer);
    await ksefWorker.close();
    await imapZenboxWorker.close();
    await worker.close();
    await prisma.$disconnect();
    process.exit(0);
  })();
});

console.info(
  `FVControl worker: pipeline ${PIPELINE_QUEUE_NAME}, IMAP ${IMAP_ZENBOX_SYNC_QUEUE_NAME}, KSeF ${KSEF_SYNC_QUEUE_NAME} (prefix=${cfg.BULLMQ_PREFIX}); IMAP auto-sync every ${cfg.IMAP_AUTO_SYNC_INTERVAL_MS}ms; KSeF auto-sync every ${cfg.KSEF_AUTO_SYNC_INTERVAL_MS}ms`,
);
