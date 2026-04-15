import type { Prisma, PrismaClient } from "@prisma/client";
import { KSEF_INGESTION_SOURCE_LABEL } from "./ksef-effective-env.js";

export type KsefQueueTelemetryPatch = {
  lastQueueJobId?: string | null;
  lastQueueJobState?: "completed" | "failed" | "retrying";
  lastQueueFinishedAt?: string;
  lastQueueError?: string | null;
  lastQueueAttempts?: number;
  lastQueueMaxAttempts?: number;
  /** `true` gdy wyczerpano próby BullMQ — odpowiednik „DLQ” dla tego joba. */
  lastQueueFinalFailure?: boolean;
};

/** Dopisuje pola `lastQueue*` do `IngestionSource.metadata` (KSeF), bez kasowania HWM ani telemetrii sync. */
export async function mergeKsefQueueTelemetry(
  prisma: PrismaClient,
  tenantId: string,
  patch: KsefQueueTelemetryPatch,
): Promise<void> {
  const source = await prisma.ingestionSource.findFirst({
    where: { tenantId, kind: "KSEF" },
    orderBy: { updatedAt: "desc" },
    select: { id: true, metadata: true },
  });
  const base =
    source?.metadata && typeof source.metadata === "object"
      ? ({ ...(source.metadata as Record<string, unknown>) } as Record<string, unknown>)
      : {};
  const merged: Record<string, unknown> = { ...base };
  if (patch.lastQueueJobId !== undefined) merged.lastQueueJobId = patch.lastQueueJobId;
  if (patch.lastQueueJobState !== undefined) merged.lastQueueJobState = patch.lastQueueJobState;
  if (patch.lastQueueFinishedAt !== undefined) merged.lastQueueFinishedAt = patch.lastQueueFinishedAt;
  if (patch.lastQueueError !== undefined) merged.lastQueueError = patch.lastQueueError;
  if (patch.lastQueueAttempts !== undefined) merged.lastQueueAttempts = patch.lastQueueAttempts;
  if (patch.lastQueueMaxAttempts !== undefined) merged.lastQueueMaxAttempts = patch.lastQueueMaxAttempts;
  if (patch.lastQueueFinalFailure !== undefined) merged.lastQueueFinalFailure = patch.lastQueueFinalFailure;

  const jobIdStr = patch.lastQueueJobId != null ? String(patch.lastQueueJobId) : "";
  const prevAudited =
    typeof base.lastQueueExhaustedAuditedJobId === "string" ? base.lastQueueExhaustedAuditedJobId : "";
  const duplicateExhaustedAudit =
    patch.lastQueueFinalFailure === true && jobIdStr.length > 0 && prevAudited === jobIdStr;

  if (patch.lastQueueFinalFailure === true && jobIdStr.length > 0 && !duplicateExhaustedAudit) {
    merged.lastQueueExhaustedAuditedJobId = jobIdStr;
  }

  const metadata = merged as Prisma.InputJsonObject;

  if (source) {
    await prisma.ingestionSource.update({ where: { id: source.id }, data: { metadata } });
  } else {
    await prisma.ingestionSource.create({
      data: {
        tenantId,
        kind: "KSEF",
        label: KSEF_INGESTION_SOURCE_LABEL,
        isEnabled: true,
        metadata: {
          hwmDate: null,
          retryKsefNumbers: [],
          ...merged,
        },
      },
    });
  }

  if (patch.lastQueueFinalFailure === true && !duplicateExhaustedAudit) {
    await prisma.auditLog.create({
      data: {
        tenantId,
        actorId: null,
        action: "KSEF_SYNC_JOB_EXHAUSTED",
        entityType: "INTEGRATION",
        entityId: tenantId,
        metadata: {
          jobId: patch.lastQueueJobId ?? null,
          error: patch.lastQueueError ?? null,
          attempts: patch.lastQueueAttempts ?? null,
          maxAttempts: patch.lastQueueMaxAttempts ?? null,
        } as object,
      },
    });
  }
}
