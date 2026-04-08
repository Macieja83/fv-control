import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { ingestAttachmentAndEnqueue } from "./attachment-intake.service.js";

export async function manualUploadAndEnqueue(
  prisma: PrismaClient,
  params: {
    tenantId: string;
    userId: string;
    buffer: Buffer;
    filename: string;
    mimeType: string;
  },
) {
  const sourceExternalId = randomUUID();
  const result = await ingestAttachmentAndEnqueue(prisma, {
    tenantId: params.tenantId,
    actorUserId: params.userId,
    buffer: params.buffer,
    filename: params.filename,
    mimeType: params.mimeType,
    ingestionSourceType: "MANUAL_UPLOAD",
    sourceExternalId,
    intakeSourceType: "UPLOAD",
  });

  if (result.kind === "idempotent_document") {
    return {
      kind: "idempotent_document" as const,
      documentId: result.documentId,
      invoiceId: result.invoiceId,
      message: result.message,
    };
  }

  return {
    kind: "created" as const,
    documentId: result.documentId,
    invoiceId: result.invoiceId,
    processingJobId: result.processingJobId,
  };
}
