import type { PrismaClient } from "@prisma/client";
import { enqueueTenantWebhook } from "../../lib/outbox-enqueue.js";

/** Zdarzenie outbox (tylko gdy ustawione `N8N_WEBHOOK_URL`) — metadane przebiegu, bez sekretów. */
export async function enqueueKsefSyncCompletedOutbox(
  prisma: PrismaClient,
  tenantId: string,
  payload: {
    occurredAt: string;
    queueJobId: string | null;
    stats: {
      fetched: number;
      ingested: number;
      skippedDuplicate: number;
      refetched: number;
      errorCount: number;
    };
    newHwmDate: string | null;
    retryQueueSize: number;
  },
): Promise<void> {
  await enqueueTenantWebhook(prisma, tenantId, "ksef.sync.completed", {
    kind: "ksef.sync.completed",
    tenantId,
    ...payload,
  });
}

export async function enqueueKsefSyncFailedOutbox(
  prisma: PrismaClient,
  tenantId: string,
  payload: {
    occurredAt: string;
    queueJobId: string | null;
    errorPreview: string | null;
  },
): Promise<void> {
  await enqueueTenantWebhook(prisma, tenantId, "ksef.sync.failed", {
    kind: "ksef.sync.failed",
    tenantId,
    ...payload,
  });
}
