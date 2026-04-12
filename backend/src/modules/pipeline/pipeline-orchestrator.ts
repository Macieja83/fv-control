import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import { Prisma } from "@prisma/client";
import type { IngestionSourceType, InvoiceIntakeSourceType, PipelineStep, PrismaClient } from "@prisma/client";
import type { ExtractedInvoiceDraft } from "../../adapters/ai/ai-invoice.adapter.js";
import { createMockAiAdapter } from "../../adapters/ai/ai-invoice.adapter.js";
import { createOpenAiAdapter } from "../../adapters/ai/openai-invoice.adapter.js";
import { createObjectStorage } from "../../adapters/storage/create-storage.js";
import { buildInvoiceFingerprint } from "../../domain/deduplication/invoice-fingerprint.js";
import {
  areBothKsefRepositoryInvoices,
  orientInvoiceDuplicateRoles,
  scoreInvoiceDuplicatePair,
} from "../../domain/deduplication/duplicate-score.js";
import { loadConfig } from "../../config.js";
import { pipelineJobsTotal } from "../../lib/metrics.js";
import { classifyDocumentType } from "../compliance/compliance-engine.js";
import { refreshInvoiceCompliance } from "../compliance/compliance.service.js";
import { findContractorByNormalizedNip, polishNipDigits10 } from "../contractors/contractor-resolve.js";
import { tryExtractDraftFromKsefFaXml } from "../ksef/ksef-fa-xml-extract.js";
import { draftFromKsefDocumentMetadata } from "../ksef/ksef-metadata-draft.js";
import { promoteKsefXmlPrimaryToSummaryPdf } from "../ksef/ksef-primary-visual-document.service.js";
import { extractVendorNipFromNormalizedPayload } from "../invoices/invoice-vendor-nip.js";
import { parseInvoiceDate } from "../invoices/invoice-dates.js";

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk instanceof Uint8Array ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks);
}

function mapIngestionToIntake(kind: IngestionSourceType | null | undefined): InvoiceIntakeSourceType {
  switch (kind) {
    case "MAIL_GMAIL":
    case "MAIL_IMAP":
      return "EMAIL";
    case "KSEF":
      return "KSEF_API";
    case "RESTA_API":
      return "CASH_REGISTER";
    case "MANUAL_UPLOAD":
    default:
      return "UPLOAD";
  }
}

async function recordAttempt(
  prisma: PrismaClient,
  jobId: string,
  attemptNo: number,
  step: PipelineStep,
  message?: string,
  errorClass?: string,
) {
  await prisma.processingAttempt.create({
    data: {
      jobId,
      attemptNo,
      step,
      message,
      errorClass,
      endedAt: new Date(),
    },
  });
}

export async function runPipelineJob(prisma: PrismaClient, processingJobId: string): Promise<void> {
  const cfg = loadConfig();
  const ai = cfg.OPENAI_API_KEY
    ? createOpenAiAdapter(cfg.OPENAI_API_KEY, cfg.OPENAI_MODEL)
    : createMockAiAdapter(cfg.FEATURE_AI_EXTRACTION_MOCK);
  if (!cfg.OPENAI_API_KEY && cfg.FEATURE_AI_EXTRACTION_MOCK) {
    console.warn(
      "[pipeline] OPENAI_API_KEY is unset — ekstrakcja używa stałych danych MOCK (numer MOCK/…, kwoty 100/23/123 PLN). Na produkcji ustaw OPENAI_API_KEY, żeby OCR czytał prawdziwą fakturę.",
    );
  }
  if (!cfg.OPENAI_API_KEY && !cfg.FEATURE_AI_EXTRACTION_MOCK) {
    console.warn(
      "[pipeline] OPENAI_API_KEY is unset and FEATURE_AI_EXTRACTION_MOCK=false — ekstrakcja zwróci pusty wynik (OCR się nie powiedzie). Ustaw OPENAI_API_KEY albo tymczasowo FEATURE_AI_EXTRACTION_MOCK=true tylko na dev.",
    );
  }

  const jobRow = await prisma.processingJob.findUnique({
    where: { id: processingJobId },
    include: { document: true, invoice: { include: { contractor: true, files: true } } },
  });
  if (!jobRow?.document || !jobRow.invoice) {
    pipelineJobsTotal.inc({ result: "missing_job" });
    return;
  }

  const document = jobRow.document;
  const invoice = jobRow.invoice;

  const attemptNo = jobRow.attemptCount + 1;
  await prisma.processingJob.update({
    where: { id: processingJobId },
    data: { status: "RUNNING", attemptCount: attemptNo, bullJobId: processingJobId },
  });

  let workingDraft: ExtractedInvoiceDraft | null = null;

  try {
    await recordAttempt(prisma, processingJobId, attemptNo, "INGEST", "ok");
    await recordAttempt(prisma, processingJobId, attemptNo, "PERSIST_RAW", "ok");
    await recordAttempt(prisma, processingJobId, attemptNo, "PARSE_METADATA", "ok");

    let documentBuffer: Buffer | undefined;
    try {
      const storage = createObjectStorage();
      const { stream } = await storage.getObjectStream({
        key: document.storageKey,
        bucket: document.storageBucket,
      });
      documentBuffer = await streamToBuffer(stream);
    } catch (storageErr) {
      console.warn("[pipeline] Could not read document from storage:", storageErr instanceof Error ? storageErr.message : storageErr);
    }

    if (!documentBuffer?.length) {
      throw new Error(
        "VALIDATION: could not load document bytes from storage — check STORAGE_DRIVER/S3_* or UPLOAD_DIR (API and worker must use the same env and reach the same files)",
      );
    }

    const intakeKind = mapIngestionToIntake(document.sourceType);
    const fromKsefSource = intakeKind === "KSEF_API" || document.sourceType === "KSEF";
    const xmlExtract = tryExtractDraftFromKsefFaXml(documentBuffer, document.mimeType ?? "");
    const docMeta = document.metadata as Record<string, unknown> | null | undefined;
    const metaDraft = fromKsefSource ? draftFromKsefDocumentMetadata(docMeta) : null;

    let extractedDraft: ExtractedInvoiceDraft;
    let confidence: number;
    if (fromKsefSource && xmlExtract?.draft?.number) {
      extractedDraft = xmlExtract.draft;
      confidence = xmlExtract.confidence;
      console.info(`[pipeline] KSeF FA XML structural extract for invoice ${invoice.id}`);
    } else if (fromKsefSource && metaDraft?.number) {
      extractedDraft = metaDraft;
      confidence = 0.82;
      console.info(
        `[pipeline] KSeF document.metadata fallback for invoice ${invoice.id} (XML structural extract or OpenAI unavailable)`,
      );
    } else {
      const aiResult = await ai.extractInvoiceData({
        mimeType: document.mimeType,
        sha256: document.sha256,
        storageKey: document.storageKey,
        buffer: documentBuffer,
      });
      extractedDraft = aiResult.draft;
      confidence = aiResult.confidence;
    }

    if (fromKsefSource) {
      const meta = document.metadata as Record<string, unknown> | null | undefined;
      const sellerNip10 =
        typeof meta?.sellerNip === "string" ? polishNipDigits10(meta.sellerNip) : null;
      const sellerName = typeof meta?.sellerName === "string" ? meta.sellerName.trim() : "";
      if (sellerNip10 && !polishNipDigits10(extractedDraft.contractorNip)) {
        extractedDraft = {
          ...extractedDraft,
          contractorNip: sellerNip10,
          contractorName:
            extractedDraft.contractorName?.trim() ||
            (sellerName.length > 0 ? sellerName : null) ||
            undefined,
        };
      }
    }

    workingDraft = extractedDraft;
    await prisma.extractionRun.create({
      data: {
        tenantId: jobRow.tenantId,
        documentId: document.id,
        invoiceId: invoice.id,
        provider: cfg.OPENAI_API_KEY ? "openai" : "mock",
        model: cfg.OPENAI_API_KEY ? cfg.OPENAI_MODEL : (cfg.FEATURE_AI_EXTRACTION_MOCK ? "mock-v1" : "disabled"),
        rawJson: extractedDraft as object,
        confidence: new Prisma.Decimal(confidence.toFixed(4)),
      },
    });
    await recordAttempt(prisma, processingJobId, attemptNo, "EXTRACT", "extracted");

    if (!workingDraft.number || typeof workingDraft.number !== "string") {
      throw new Error(
        "VALIDATION: missing invoice number from extraction — brak OPENAI_API_KEY (wymagany do prawdziwego OCR) lub wyłączony mock (FEATURE_AI_EXTRACTION_MOCK=false).",
      );
    }
    await recordAttempt(prisma, processingJobId, attemptNo, "VALIDATE", "valid");

    const draft = workingDraft;
    const invoiceNumber = draft.number!;

    const issueDate = draft.issueDate
      ? parseInvoiceDate(draft.issueDate)
      : invoice.issueDate;
    const net = new Prisma.Decimal(String(draft.netTotal ?? "0"));
    const vat = new Prisma.Decimal(String(draft.vatTotal ?? "0"));
    const gross = new Prisma.Decimal(String(draft.grossTotal ?? "0"));
    const currency = draft.currency ?? "PLN";

    const fingerprint = buildInvoiceFingerprint({
      contractorNip: draft.contractorNip ?? null,
      number: invoiceNumber,
      issueDateIso: issueDate.toISOString(),
      grossTotal: gross.toString(),
      currency,
    });

    const dupFinger = await prisma.invoice.findFirst({
      where: {
        tenantId: jobRow.tenantId,
        fingerprint,
        NOT: { id: invoice.id },
      },
    });

    await prisma.$transaction(async (tx) => {
      let finalNumber = invoiceNumber;
      const clash = await tx.invoice.findFirst({
        where: { tenantId: jobRow.tenantId, number: finalNumber, NOT: { id: invoice.id } },
      });
      if (clash) {
        finalNumber = `${finalNumber}-${randomUUID().slice(0, 6)}`;
      }

      let contractorId = invoice.contractorId;
      const ocrContractorName = draft.contractorName?.trim();
      const nip10 =
        polishNipDigits10(draft.contractorNip) ??
        polishNipDigits10(extractVendorNipFromNormalizedPayload(draft as unknown));
      if (nip10) {
        let contractor = await findContractorByNormalizedNip(tx, jobRow.tenantId, nip10);
        if (!contractor) {
          const name =
            ocrContractorName && ocrContractorName.length > 0
              ? ocrContractorName.slice(0, 500)
              : `Kontrahent ${nip10}`;
          const created = await tx.contractor.create({
            data: { tenantId: jobRow.tenantId, nip: nip10, name },
          });
          contractor = { id: created.id };
        }
        contractorId = contractor.id;
      }

      await tx.invoiceItem.deleteMany({ where: { invoiceId: invoice.id } });
      if (draft.lineItems?.length) {
        await tx.invoiceItem.createMany({
          data: draft.lineItems.map((li) => ({
            invoiceId: invoice.id,
            name: li.name ?? "Line",
            quantity: new Prisma.Decimal(String(li.quantity ?? "1")),
            unit: null,
            netPrice: new Prisma.Decimal(String(li.netPrice ?? "0")),
            vatRate: new Prisma.Decimal(String(li.vatRate ?? "23")),
            netValue: new Prisma.Decimal(String(li.netValue ?? "0")),
            grossValue: new Prisma.Decimal(String(li.grossValue ?? "0")),
          })),
        });
      }

      await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          number: finalNumber,
          issueDate,
          currency,
          netTotal: net,
          vatTotal: vat,
          grossTotal: gross,
          fingerprint,
          contractorId,
          status: dupFinger ? "PENDING_REVIEW" : "RECEIVED",
          source: "OCR",
          ocrConfidence: new Prisma.Decimal(confidence.toFixed(4)),
          intakeSourceType: mapIngestionToIntake(document.sourceType),
          documentKind: classifyDocumentType({
            intakeSourceType: mapIngestionToIntake(document.sourceType),
            filename: document.storageKey,
          }),
          normalizedPayload: draft as object,
          ...(document.sourceType === "KSEF" && document.sourceExternalId?.trim()
            ? { ksefNumber: document.sourceExternalId.trim() }
            : {}),
        },
      });
    });
    await recordAttempt(prisma, processingJobId, attemptNo, "DEDUP", "invoice updated");

    const refreshed = await prisma.invoice.findUnique({
      where: { id: invoice.id },
      include: { contractor: true, files: true },
    });
    if (!refreshed) throw new Error("Invoice missing after update");

    const refreshedNip = (refreshed.contractor?.nip ?? "").replace(/\D/g, "");
    const peerOr: Prisma.InvoiceWhereInput[] = [
      { issueDate: refreshed.issueDate },
      { grossTotal: refreshed.grossTotal },
    ];
    if (refreshed.contractorId) {
      peerOr.push({ contractorId: refreshed.contractorId });
    }
    if (refreshedNip.length === 10) {
      peerOr.push({
        contractor: { is: { nip: refreshedNip, deletedAt: null } },
      });
    }

    const peers = await prisma.invoice.findMany({
      where: {
        tenantId: jobRow.tenantId,
        NOT: { id: refreshed.id },
        status: { notIn: ["REJECTED", "DRAFT"] },
        OR: peerOr,
      },
      take: 500,
      orderBy: { createdAt: "desc" },
      include: { contractor: true, files: true },
    });

    const canonicalsToRefreshCompliance = new Set<string>();

    for (const p of peers) {
      const fileHashEqual =
        refreshed.files[0]?.sha256 &&
        p.files[0]?.sha256 &&
        refreshed.files[0].sha256 === p.files[0].sha256;
      const score = scoreInvoiceDuplicatePair({
        fileHashEqual: Boolean(fileHashEqual),
        fingerprintEqual: refreshed.fingerprint === p.fingerprint && Boolean(refreshed.fingerprint),
        numberA: refreshed.number,
        numberB: p.number,
        grossA: refreshed.grossTotal.toString(),
        grossB: p.grossTotal.toString(),
        nipA: refreshed.contractor?.nip ?? null,
        nipB: p.contractor?.nip ?? null,
        issueDateA: refreshed.issueDate,
        issueDateB: p.issueDate,
      });
      if (score.confidence >= 0.72) {
        const roleA = {
          id: refreshed.id,
          intakeSourceType: refreshed.intakeSourceType,
          createdAt: refreshed.createdAt,
          ksefNumber: refreshed.ksefNumber,
        };
        const roleB = {
          id: p.id,
          intakeSourceType: p.intakeSourceType,
          createdAt: p.createdAt,
          ksefNumber: p.ksefNumber,
        };
        if (areBothKsefRepositoryInvoices(roleA, roleB)) {
          continue;
        }
        const { canonicalId, candidateId } = orientInvoiceDuplicateRoles(roleA, roleB);
        canonicalsToRefreshCompliance.add(canonicalId);
        const inverted = await prisma.invoiceDuplicate.findFirst({
          where: {
            tenantId: jobRow.tenantId,
            candidateInvoiceId: canonicalId,
            canonicalInvoiceId: candidateId,
            resolution: "OPEN",
          },
        });
        if (inverted) {
          await prisma.invoiceDuplicate.delete({ where: { id: inverted.id } });
        }
        const existing = await prisma.invoiceDuplicate.findFirst({
          where: {
            tenantId: jobRow.tenantId,
            candidateInvoiceId: candidateId,
            canonicalInvoiceId: canonicalId,
          },
        });
        if (!existing) {
          await prisma.invoiceDuplicate.create({
            data: {
              tenantId: jobRow.tenantId,
              candidateInvoiceId: candidateId,
              canonicalInvoiceId: canonicalId,
              confidence: new Prisma.Decimal(Math.min(1, score.confidence).toFixed(4)),
              reasonCodes: score.reasonCodes,
            },
          });
        }
      }
    }

    for (const cid of canonicalsToRefreshCompliance) {
      if (cid === refreshed.id) continue;
      await refreshInvoiceCompliance(
        prisma,
        jobRow.tenantId,
        cid,
        {},
        {
          eventType: "COMPLIANCE_VALIDATED",
          enqueueDuplicate: false,
          enqueueClassified: false,
        },
      );
    }

    await recordAttempt(prisma, processingJobId, attemptNo, "CLASSIFY", "dedup pairs evaluated");

    await refreshInvoiceCompliance(
      prisma,
      jobRow.tenantId,
      invoice.id,
      {
        documentKind: classifyDocumentType({
          intakeSourceType: mapIngestionToIntake(document.sourceType),
          filename: document.storageKey,
        }),
      },
      { eventType: "CLASSIFIED", enqueueDuplicate: true, enqueueIngested: false },
    );
    await recordAttempt(prisma, processingJobId, attemptNo, "COMPLIANCE", "compliance layer applied");

    if (cfg.N8N_WEBHOOK_URL) {
      await prisma.webhookOutbox.create({
        data: {
          tenantId: jobRow.tenantId,
          eventType: "invoice.processed",
          url: cfg.N8N_WEBHOOK_URL,
          payload: {
            invoiceId: invoice.id,
            documentId: document.id,
            correlationId: jobRow.correlationId,
          } as object,
          status: "PENDING",
        },
      });
    }
    await recordAttempt(prisma, processingJobId, attemptNo, "EMIT_EVENTS", "outbox");

    await prisma.auditLog.create({
      data: {
        tenantId: jobRow.tenantId,
        action: "PIPELINE_COMPLETED",
        entityType: "INVOICE",
        entityId: invoice.id,
        metadata: { processingJobId } as object,
      },
    });
    await recordAttempt(prisma, processingJobId, attemptNo, "AUDIT", "audit");

    await prisma.processingJob.update({
      where: { id: processingJobId },
      data: { status: "COMPLETED", currentStep: "AUDIT", lastError: null },
    });

    // Po zakończeniu pipeline (compliance na primary XML) — podgląd PDF nie blokuje statusu joba ani refreshu.
    if (fromKsefSource) {
      try {
        await promoteKsefXmlPrimaryToSummaryPdf(prisma, {
          tenantId: jobRow.tenantId,
          invoiceId: invoice.id,
          xmlDocument: {
            id: document.id,
            mimeType: document.mimeType,
            sourceExternalId: document.sourceExternalId,
          },
          ksefNumber: refreshed.ksefNumber ?? document.sourceExternalId,
          invoiceNumber: refreshed.number,
          issueDate: refreshed.issueDate,
          contractorName: refreshed.contractor?.name ?? null,
          contractorNip: refreshed.contractor?.nip ?? null,
          netTotal: refreshed.netTotal.toString(),
          vatTotal: refreshed.vatTotal.toString(),
          grossTotal: refreshed.grossTotal.toString(),
          currency: refreshed.currency,
        });
      } catch (e) {
        console.warn(
          "[pipeline] KSeF summary PDF (primary):",
          e instanceof Error ? e.message : String(e),
        );
      }
    }

    pipelineJobsTotal.inc({ result: "completed" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await prisma.processingJob.update({
      where: { id: processingJobId },
      data: { status: "FAILED", lastError: msg },
    });
    pipelineJobsTotal.inc({ result: "failed" });
    throw e;
  }
}
