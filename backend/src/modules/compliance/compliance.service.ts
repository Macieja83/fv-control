import { Prisma } from "@prisma/client";
import type {
  ComplianceEventType,
  InvoiceDocumentKind,
  InvoiceIntakeSourceType,
  PrismaClient,
} from "@prisma/client";
import { loadConfig } from "../../config.js";
import { enqueueTenantWebhook } from "../../lib/outbox-enqueue.js";
import { evaluateComplianceRules } from "./compliance-engine.js";

type RefreshOpts = {
  eventType?: ComplianceEventType;
  enqueueClassified?: boolean;
  enqueueDuplicate?: boolean;
  enqueueIngested?: boolean;
};

export async function refreshInvoiceCompliance(
  prisma: PrismaClient,
  tenantId: string,
  invoiceId: string,
  overrides: Partial<{
    intakeSourceType: InvoiceIntakeSourceType;
    documentKind: InvoiceDocumentKind;
    isOwnSales: boolean;
    hasStructuredKsefPayload: boolean;
    ocrConfidence: number | null;
  }> = {},
  opts: RefreshOpts = {},
): Promise<void> {
  const cfg = loadConfig();
  const inv = await prisma.invoice.findFirst({
    where: { id: invoiceId, tenantId },
    include: { contractor: true },
  });
  if (!inv) return;

  const [dupAsCandidate, dupAsCanonical] = await Promise.all([
    prisma.invoiceDuplicate.findFirst({
      where: { tenantId, candidateInvoiceId: invoiceId, resolution: "OPEN" },
      orderBy: { confidence: "desc" },
      select: { confidence: true },
    }),
    prisma.invoiceDuplicate.findFirst({
      where: { tenantId, canonicalInvoiceId: invoiceId, resolution: "OPEN" },
      orderBy: { confidence: "desc" },
      select: { confidence: true },
    }),
  ]);
  const cCand = dupAsCandidate != null ? Number(dupAsCandidate.confidence) : 0;
  const cCanon = dupAsCanonical != null ? Number(dupAsCanonical.confidence) : 0;
  /** Oryginał z KSeF nie dostaje „duplikatu” w compliance tylko dlatego, że jest canonical — badge tylko dla strony candidate. */
  const isKsefOriginal =
    inv.intakeSourceType === "KSEF_API" ||
    (typeof inv.ksefNumber === "string" && inv.ksefNumber.trim().length > 0);
  const duplicateConfidence =
    dupAsCandidate != null
      ? cCand
      : isKsefOriginal
        ? null
        : dupAsCanonical != null
          ? cCanon
          : null;

  const mime = inv.primaryDocId
    ? (await prisma.document.findUnique({ where: { id: inv.primaryDocId }, select: { mimeType: true } }))?.mimeType
    : null;
  const hasXml = Boolean(mime && mime.includes("xml"));

  const isOwnSales = overrides.isOwnSales ?? inv.ledgerKind === "SALE";

  const input = {
    intakeSourceType: overrides.intakeSourceType ?? inv.intakeSourceType,
    documentKind: overrides.documentKind ?? inv.documentKind,
    currency: inv.currency,
    grossTotal: Number(inv.grossTotal.toString()),
    isOwnSales,
    hasStructuredKsefPayload: overrides.hasStructuredKsefPayload ?? hasXml,
    ocrConfidence:
      overrides.ocrConfidence ??
      (inv.ocrConfidence != null ? Number(inv.ocrConfidence.toString()) : null),
    duplicateConfidence,
    fingerprint: inv.fingerprint ?? null,
  };

  const result = evaluateComplianceRules(input, cfg);

  /** Oryginał KSeF bez roli „candidate” — czyścimy też `duplicateHash` z samego fingerprinta (wcześniej zostawał przy score null). */
  const suppressDupDisplay = isKsefOriginal && dupAsCandidate == null;
  const duplicateHashOut = suppressDupDisplay ? null : result.duplicateHash;
  const duplicateScoreOut = suppressDupDisplay ? null : result.duplicateScore;

  await prisma.$transaction(async (tx) => {
    await tx.invoice.update({
      where: { id: invoiceId },
      data: {
        documentKind: result.documentKind,
        legalChannel: result.legalChannel,
        ksefRequired: result.ksefRequired,
        ksefStatus: result.ksefStatus,
        reviewStatus: result.reviewStatus,
        complianceFlags: result.complianceFlags,
        duplicateHash: duplicateHashOut,
        duplicateScore:
          duplicateScoreOut != null ? new Prisma.Decimal(duplicateScoreOut.toFixed(4)) : null,
      },
    });

    await tx.invoiceComplianceEvent.create({
      data: {
        tenantId,
        invoiceId,
        eventType: opts.eventType ?? "COMPLIANCE_VALIDATED",
        payload: {
          legalChannel: result.legalChannel,
          ksefRequired: result.ksefRequired,
          ksefStatus: result.ksefStatus,
          reviewStatus: result.reviewStatus,
          flags: result.complianceFlags,
        } as object,
      },
    });
  });

  if (opts.enqueueIngested) {
    await enqueueTenantWebhook(prisma, tenantId, "invoice.ingested", { invoiceId });
  }

  if (opts.enqueueClassified !== false) {
    await enqueueTenantWebhook(prisma, tenantId, "invoice.classified", {
      invoiceId,
      legalChannel: result.legalChannel,
      documentKind: result.documentKind,
      reviewStatus: result.reviewStatus,
    });
  }

  if (
    opts.enqueueDuplicate &&
    duplicateConfidence != null &&
    duplicateConfidence >= 0.72 &&
    dupAsCandidate != null
  ) {
    await enqueueTenantWebhook(prisma, tenantId, "invoice.duplicate.detected", {
      invoiceId,
      confidence: duplicateConfidence,
    });
  }

  if (result.reviewStatus === "NEEDS_REVIEW") {
    await enqueueTenantWebhook(prisma, tenantId, "invoice.compliance.flagged", {
      invoiceId,
      flags: result.complianceFlags,
    });
  }
}

export async function recordComplianceEvent(
  prisma: PrismaClient,
  tenantId: string,
  invoiceId: string,
  eventType: ComplianceEventType,
  payload: Record<string, unknown>,
): Promise<void> {
  await prisma.invoiceComplianceEvent.create({
    data: {
      tenantId,
      invoiceId,
      eventType,
      payload: payload as object,
    },
  });
}
