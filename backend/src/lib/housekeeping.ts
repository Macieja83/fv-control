import type { PrismaClient } from "@prisma/client";
import { loadConfig } from "../config.js";
import {
  cleanupDeletedTotal,
  idempotencyKeysActiveGauge,
} from "./metrics.js";

export async function runIdempotencyCleanup(prisma: PrismaClient): Promise<number> {
  const now = new Date();
  const result = await prisma.idempotencyKey.deleteMany({
    where: { expiresAt: { lt: now } },
  });
  if (result.count > 0) {
    cleanupDeletedTotal.labels("idempotency").inc(result.count);
  }
  return result.count;
}

export async function runWebhookOutboxSentCleanup(prisma: PrismaClient): Promise<number> {
  const cfg = loadConfig();
  const days = cfg.WEBHOOK_OUTBOX_SENT_RETENTION_DAYS;
  const cutoff = new Date(Date.now() - days * 86_400_000);
  const result = await prisma.webhookOutbox.deleteMany({
    where: { status: "SENT", updatedAt: { lt: cutoff } },
  });
  if (result.count > 0) {
    cleanupDeletedTotal.labels("webhook").inc(result.count);
  }
  return result.count;
}

export async function refreshIdempotencyActiveGauge(prisma: PrismaClient): Promise<void> {
  const now = new Date();
  const n = await prisma.idempotencyKey.count({
    where: { expiresAt: { gte: now } },
  });
  idempotencyKeysActiveGauge.set(n);
}
