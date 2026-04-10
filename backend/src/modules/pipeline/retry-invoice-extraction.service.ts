import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { loadConfig } from "../../config.js";
import { AppError } from "../../lib/errors.js";
import { getPipelineQueue } from "../../lib/pipeline-queue.js";
import { PIPELINE_QUEUE_NAME } from "../../lib/queue-constants.js";

export type RetryInvoiceExtractionResult = {
  invoiceId: string;
  documentId: string;
  processingJobId: string;
};

/**
 * Tworzy nowy ProcessingJob i dodaje go do kolejki pipeline (OCR / ekstrakcja).
 * `invoiceOrDocumentId` może być UUID faktury albo UUID dokumentu głównego (`primaryDocId`).
 */
export async function retryInvoiceExtraction(
  prisma: PrismaClient,
  tenantId: string,
  invoiceOrDocumentId: string,
): Promise<RetryInvoiceExtractionResult> {
  const invoice = await prisma.invoice.findFirst({
    where: {
      tenantId,
      OR: [{ id: invoiceOrDocumentId }, { primaryDocId: invoiceOrDocumentId }],
    },
    include: { primaryDoc: true },
  });

  if (!invoice) {
    throw AppError.notFound(
      "Nie znaleziono faktury dla podanego identyfikatora (sprawdź ID faktury lub dokumentu).",
    );
  }

  if (!invoice.primaryDocId || !invoice.primaryDoc) {
    throw AppError.validation(
      "Ta faktura nie ma podpiętego pliku źródłowego — ponowna ekstrakcja OCR nie jest możliwa.",
    );
  }

  const inflight = await prisma.processingJob.findFirst({
    where: {
      tenantId,
      invoiceId: invoice.id,
      status: { in: ["PENDING", "RUNNING"] },
    },
  });

  if (inflight) {
    throw AppError.conflict(
      "Dla tej faktury kolejka przetwarzania jest już aktywna lub oczekuje — poczekaj na zakończenie.",
    );
  }

  const cfg = loadConfig();
  const doc = invoice.primaryDoc;

  const meta = doc.metadata as { filename?: unknown } | null;
  const filename =
    meta && typeof meta.filename === "string" && meta.filename.length > 0 ? meta.filename : "document";

  const processingJob = await prisma.processingJob.create({
    data: {
      tenantId,
      queueName: PIPELINE_QUEUE_NAME,
      type: "INGEST_PIPELINE",
      correlationId: randomUUID(),
      payload: { documentId: doc.id, invoiceId: invoice.id, filename } as object,
      documentId: doc.id,
      invoiceId: invoice.id,
      maxAttempts: cfg.PIPELINE_MAX_ATTEMPTS,
    },
  });

  try {
    const queue = getPipelineQueue();
    await queue.add(
      "run",
      { processingJobId: processingJob.id },
      {
        attempts: cfg.PIPELINE_MAX_ATTEMPTS,
        backoff: { type: "exponential", delay: 5000 },
        jobId: processingJob.id,
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    );
  } catch {
    await prisma.processingJob.update({
      where: { id: processingJob.id },
      data: { status: "FAILED", lastError: "Redis/queue unavailable" },
    });
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { status: "FAILED_NEEDS_REVIEW" },
    });
    throw AppError.internal("Kolejka Redis jest niedostępna — nie udało się zaplanować OCR.");
  }

  await prisma.invoice.update({
    where: { id: invoice.id },
    data: { status: "INGESTING" },
  });

  return {
    invoiceId: invoice.id,
    documentId: doc.id,
    processingJobId: processingJob.id,
  };
}
