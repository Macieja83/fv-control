import type { PrismaClient } from "@prisma/client";
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

export async function refreshIdempotencyActiveGauge(prisma: PrismaClient): Promise<void> {
  const now = new Date();
  const n = await prisma.idempotencyKey.count({
    where: { expiresAt: { gte: now } },
  });
  idempotencyKeysActiveGauge.set(n);
}
