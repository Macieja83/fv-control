import { createHash, randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { createObjectStorage } from "../../adapters/storage/create-storage.js";
import { loadConfig } from "../../config.js";
import { AppError } from "../../lib/errors.js";
import { getPipelineQueue } from "../../lib/pipeline-queue.js";
import { PIPELINE_QUEUE_NAME } from "../../lib/queue-constants.js";
import { loadKsefClientForTenant } from "./ksef-tenant-credentials.service.js";

export type RehydrateKsefInvoiceResult = {
  invoiceId: string;
  xmlDocumentId: string;
  ksefNumber: string;
  storageKey: string;
  storageBucket: string | null;
  processingJobId: string | null;
};

/**
 * Ponownie pobiera FA XML z API MF, zapisuje w storage i ustawia `primaryDocId` na dokument XML
 * (naprawa 404 podglądu, gdy plik zniknął albo primary wskazywał na uszkodzony PDF).
 */
export async function rehydrateKsefInvoiceFromApi(
  prisma: PrismaClient,
  tenantId: string,
  invoiceId: string,
): Promise<RehydrateKsefInvoiceResult> {
  const cfg = loadConfig();

  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, tenantId },
    include: { primaryDoc: true },
  });
  if (!invoice) {
    throw AppError.notFound("Nie znaleziono faktury.");
  }

  if (invoice.intakeSourceType !== "KSEF_API") {
    throw AppError.validation("Ta operacja dotyczy tylko faktur z importu KSeF API.");
  }

  const ksefNum =
    invoice.ksefNumber?.trim() ||
    invoice.sourceExternalId?.trim() ||
    (invoice.primaryDoc?.sourceType === "KSEF" ? invoice.primaryDoc.sourceExternalId?.trim() : "") ||
    "";

  if (!ksefNum) {
    throw AppError.validation("Brak numeru KSeF dla tej faktury.");
  }

  let xmlDoc = await prisma.document.findFirst({
    where: { tenantId, sourceType: "KSEF", sourceExternalId: ksefNum, deletedAt: null },
  });

  if (!xmlDoc && invoice.primaryDoc) {
    const p = invoice.primaryDoc;
    const mime = (p.mimeType ?? "").toLowerCase();
    if (p.sourceType === "KSEF" && (mime.includes("xml") || mime.includes("text/xml"))) {
      xmlDoc = p;
    } else if (mime.includes("pdf")) {
      const meta = p.metadata as { derivedFromDocumentId?: unknown } | null;
      const derived =
        typeof meta?.derivedFromDocumentId === "string" && meta.derivedFromDocumentId.trim().length > 0
          ? meta.derivedFromDocumentId.trim()
          : null;
      if (derived) {
        xmlDoc = await prisma.document.findFirst({
          where: { id: derived, tenantId, deletedAt: null },
        });
      }
    }
  }

  if (!xmlDoc) {
    throw AppError.notFound("Nie znaleziono dokumentu XML KSeF powiązanego z tą fakturą.");
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
      `Dla tej faktury trwa już przetwarzanie (job ${inflight.id}) — poczekaj na zakończenie.`,
    );
  }

  const client = await loadKsefClientForTenant(prisma, tenantId);
  if (!client) {
    throw AppError.validation(
      "KSeF nie jest skonfigurowany: ustaw poświadczenia w Płatnościach (KSeF) lub zmienne KSEF_TOKEN i KSEF_NIP na serwerze.",
    );
  }
  await client.authenticate();

  const xml = await client.fetchInvoiceXml(ksefNum);
  const buf = Buffer.from(xml, "utf-8");
  const sha = createHash("sha256").update(buf).digest("hex");
  const objectKey = `${sha}-${ksefNum.replace(/[^a-zA-Z0-9._-]/g, "_")}.xml`;

  const storage = createObjectStorage();
  const put = await storage.putObject({
    key: objectKey,
    body: buf,
    contentType: "application/xml",
    tenantId,
  });

  await prisma.document.update({
    where: { id: xmlDoc.id },
    data: {
      storageKey: put.key,
      storageBucket: put.bucket ?? null,
      sha256: sha,
      sizeBytes: buf.length,
      mimeType: "application/xml",
    },
  });

  await prisma.invoice.update({
    where: { id: invoice.id },
    data: { primaryDocId: xmlDoc.id },
  });

  const meta = xmlDoc.metadata as { filename?: unknown } | null;
  const filename =
    meta && typeof meta.filename === "string" && meta.filename.length > 0 ? meta.filename : `${ksefNum}.xml`;

  const processingJob = await prisma.processingJob.create({
    data: {
      tenantId,
      queueName: PIPELINE_QUEUE_NAME,
      type: "INGEST_PIPELINE",
      correlationId: randomUUID(),
      payload: { documentId: xmlDoc.id, invoiceId: invoice.id, filename } as object,
      documentId: xmlDoc.id,
      invoiceId: invoice.id,
      maxAttempts: cfg.PIPELINE_MAX_ATTEMPTS,
    },
  });

  let processingJobId: string | null = processingJob.id;
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
    processingJobId = null;
    throw AppError.internal("Kolejka Redis jest niedostępna — plik zapisano, ale nie uruchomiono OCR.");
  }

  await prisma.invoice.update({
    where: { id: invoice.id },
    data: { status: "INGESTING" },
  });

  return {
    invoiceId: invoice.id,
    xmlDocumentId: xmlDoc.id,
    ksefNumber: ksefNum,
    storageKey: put.key,
    storageBucket: put.bucket ?? null,
    processingJobId,
  };
}
