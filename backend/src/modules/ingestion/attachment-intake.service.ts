import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { IngestionSourceType, InvoiceIntakeSourceType, PrismaClient } from "@prisma/client";
import { createObjectStorage } from "../../adapters/storage/create-storage.js";
import { loadConfig } from "../../config.js";
import { AppError } from "../../lib/errors.js";
import { getPipelineQueue } from "../../lib/pipeline-queue.js";
import { PIPELINE_QUEUE_NAME } from "../../lib/queue-constants.js";
import { assertInvoiceCreationAllowed } from "../billing/subscription-plans.js";
import { polishNipDigits10 } from "../contractors/contractor-resolve.js";
import { parseInvoiceDate } from "../invoices/invoice-dates.js";

function sha256Buffer(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

export type IngestAttachmentParams = {
  tenantId: string;
  actorUserId: string;
  buffer: Buffer;
  filename: string;
  mimeType: string;
  ingestionSourceType: IngestionSourceType;
  /** Stable id for Document @@unique(tenantId, sourceType, sourceExternalId) */
  sourceExternalId: string;
  metadata?: Record<string, unknown>;
  intakeSourceType: InvoiceIntakeSourceType;
  sourceAccount?: string | null;
  /**
   * Rzeczywista data wystawienia z źródła (np. metadane KSeF), zanim pipeline ustawi pola z XML/OCR.
   * Bez tego `issueDate` = moment ingestu → lista filtrowana po miesiącu „gubi” faktury po aktualizacji z XML.
   */
  initialIssueDate?: Date;
  /** When set, skip `putObject` (blob already stored — e.g. IMAP sync). */
  existingStorage?: { storageKey: string; storageBucket?: string | null };
};

export type IngestAttachmentResult =
  | {
      kind: "idempotent_document";
      documentId: string;
      invoiceId: string;
      message: string;
    }
  | {
      kind: "created";
      documentId: string;
      invoiceId: string;
      processingJobId: string;
    };

/**
 * Stores blob, creates Document + Invoice + pipeline job (shared by manual upload and IMAP).
 */
export async function ingestAttachmentAndEnqueue(
  prisma: PrismaClient,
  params: IngestAttachmentParams,
): Promise<IngestAttachmentResult> {
  const cfg = loadConfig();
  const sha = sha256Buffer(params.buffer);

  const existingDoc = await prisma.document.findFirst({
    where: { tenantId: params.tenantId, sha256: sha, deletedAt: null },
  });
  if (existingDoc) {
    const inv = await prisma.invoice.findFirst({
      where: { tenantId: params.tenantId, primaryDocId: existingDoc.id },
      orderBy: { createdAt: "desc" },
    });
    if (inv) {
      const ingestingHint =
        inv.status === "INGESTING"
          ? " Ten sam plik jest już w systemie — jeśli dane się nie uzupełniają, uruchom worker (Redis + kolejka fvcontrol-pipeline) z tymi samymi zmiennymi STORAGE/UPLOAD_DIR co API."
          : "";
      return {
        kind: "idempotent_document",
        documentId: existingDoc.id,
        invoiceId: inv.id,
        message: `Dokument o tym samym skrócie SHA-256 jest już w systemie.${ingestingHint}`,
      };
    }
  }

  await assertInvoiceCreationAllowed(prisma, params.tenantId);

  const storage = createObjectStorage();
  const objectKey = `${sha}-${params.filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const put = params.existingStorage
    ? {
        key: params.existingStorage.storageKey,
        bucket: params.existingStorage.storageBucket ?? undefined,
      }
    : await storage.putObject({
        key: objectKey,
        body: params.buffer,
        contentType: params.mimeType,
        tenantId: params.tenantId,
      });

  const storageUrl =
    put.bucket !== undefined && put.bucket !== null ? `s3://${put.bucket}/${put.key}` : `local:${put.key}`;

  const doc = await prisma.document.create({
    data: {
      tenantId: params.tenantId,
      sha256: sha,
      storageKey: put.key,
      storageBucket: put.bucket ?? null,
      mimeType: params.mimeType,
      sizeBytes: params.buffer.length,
      sourceType: params.ingestionSourceType,
      sourceExternalId: params.sourceExternalId,
      metadata: {
        ...(params.metadata ?? {}),
        filename: params.filename,
        storageUrl,
      } as object,
    },
  });

  const zero = new Prisma.Decimal(0);
  const issueDate =
    params.initialIssueDate instanceof Date && !Number.isNaN(params.initialIssueDate.getTime())
      ? params.initialIssueDate
      : new Date();
  const invoice = await prisma.invoice.create({
    data: {
      tenantId: params.tenantId,
      contractorId: null,
      primaryDocId: doc.id,
      number: `ING-${randomUUID().slice(0, 8).toUpperCase()}`,
      issueDate,
      currency: "PLN",
      netTotal: zero,
      vatTotal: zero,
      grossTotal: zero,
      status: "INGESTING",
      source: "OCR",
      ingestionKind: params.ingestionSourceType,
      sourceExternalId: doc.sourceExternalId,
      createdById: params.actorUserId,
      intakeSourceType: params.intakeSourceType,
      sourceAccount: params.sourceAccount ?? null,
    },
  });

  await prisma.auditLog.create({
    data: {
      tenantId: params.tenantId,
      actorId: params.actorUserId,
      action: "INVOICE_INTAKE",
      entityType: "INVOICE",
      entityId: invoice.id,
      metadata: {
        filename: params.filename,
        sourceAccount: params.sourceAccount ?? null,
      } as object,
    },
  });

  const processingJob = await prisma.processingJob.create({
    data: {
      tenantId: params.tenantId,
      queueName: PIPELINE_QUEUE_NAME,
      type: "INGEST_PIPELINE",
      correlationId: randomUUID(),
      payload: { documentId: doc.id, invoiceId: invoice.id, filename: params.filename },
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
    throw AppError.internal("Queue unavailable — job persisted as FAILED");
  }

  return {
    kind: "created",
    documentId: doc.id,
    invoiceId: invoice.id,
    processingJobId: processingJob.id,
  };
}

export type ResumeOrphanKsefDocumentParams = {
  tenantId: string;
  documentId: string;
  actorUserId: string;
  ksefNumber: string;
};

/**
 * Gdy po imporcie KSeF został zapisany `Document` (XML), ale bez `Invoice` + joba pipeline
 * (np. błąd po `document.create`), odtwarzamy fakturę i kolejkę na istniejącym dokumencie.
 */
export async function resumePipelineForOrphanKsefDocument(
  prisma: PrismaClient,
  params: ResumeOrphanKsefDocumentParams,
): Promise<{ invoiceId: string; processingJobId: string }> {
  await assertInvoiceCreationAllowed(prisma, params.tenantId);
  const cfg = loadConfig();
  const doc = await prisma.document.findFirst({
    where: { id: params.documentId, tenantId: params.tenantId, deletedAt: null },
  });
  if (!doc) throw AppError.notFound("Document not found");
  if (doc.sourceType !== "KSEF") {
    throw AppError.validation("resumePipelineForOrphanKsefDocument: document is not KSEF");
  }

  const blocking = await prisma.invoice.findFirst({
    where: { tenantId: params.tenantId, primaryDocId: doc.id },
    select: { id: true },
  });
  if (blocking) {
    throw AppError.conflict("Invoice already linked to this document");
  }

  const meta = doc.metadata as Record<string, unknown> | null;
  const issueRaw = typeof meta?.issueDate === "string" ? meta.issueDate.trim() : "";
  const initialIssueDate =
    issueRaw.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(issueRaw)
      ? parseInvoiceDate(issueRaw.slice(0, 10))
      : new Date();

  const filename =
    (typeof meta?.filename === "string" && meta.filename.trim()) || `${params.ksefNumber.trim()}.xml`;
  const sellerNip10 =
    typeof meta?.sellerNip === "string" ? polishNipDigits10(meta.sellerNip) : null;
  const sourceAccount = sellerNip10 ? `KSeF ${sellerNip10}` : "KSeF";
  const kn = params.ksefNumber.trim();

  const zero = new Prisma.Decimal(0);
  const invoice = await prisma.invoice.create({
    data: {
      tenantId: params.tenantId,
      contractorId: null,
      primaryDocId: doc.id,
      number: `ING-${randomUUID().slice(0, 8).toUpperCase()}`,
      issueDate: initialIssueDate,
      currency: "PLN",
      netTotal: zero,
      vatTotal: zero,
      grossTotal: zero,
      status: "INGESTING",
      source: "OCR",
      ingestionKind: "KSEF",
      sourceExternalId: doc.sourceExternalId,
      createdById: params.actorUserId,
      intakeSourceType: "KSEF_API",
      sourceAccount,
      ksefNumber: kn,
    },
  });

  await prisma.auditLog.create({
    data: {
      tenantId: params.tenantId,
      actorId: params.actorUserId,
      action: "INVOICE_INTAKE",
      entityType: "INVOICE",
      entityId: invoice.id,
      metadata: { filename, sourceAccount, resumedFromOrphanDocument: doc.id } as object,
    },
  });

  const processingJob = await prisma.processingJob.create({
    data: {
      tenantId: params.tenantId,
      queueName: PIPELINE_QUEUE_NAME,
      type: "INGEST_PIPELINE",
      correlationId: randomUUID(),
      payload: { documentId: doc.id, invoiceId: invoice.id, filename },
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
    throw AppError.internal("Queue unavailable — job persisted as FAILED");
  }

  return { invoiceId: invoice.id, processingJobId: processingJob.id };
}
