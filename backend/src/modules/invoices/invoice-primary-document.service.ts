import type { Document, PrismaClient } from "@prisma/client";
import type { Readable } from "node:stream";
import { createObjectStorage } from "../../adapters/storage/create-storage.js";
import { loadConfig } from "../../config.js";
import { AppError } from "../../lib/errors.js";

export type PrimaryDocumentStreamOptions = {
  /**
   * Dla faktur z KSeF: zwróć **oryginalny FA XML** zamiast wizualnego PDF podsumowania,
   * żeby frontend mógł pokazać pełny podgląd (`KsefInvoicePreview`).
   */
  ksefFaXml?: boolean;
};

async function resolveKsefFaXmlDocument(
  prisma: PrismaClient,
  tenantId: string,
  invoice: {
    id: string;
    ksefNumber: string | null;
    sourceExternalId: string | null;
    intakeSourceType: string;
    primaryDoc: Document | null;
  },
): Promise<Document | null> {
  if (invoice.intakeSourceType !== "KSEF_API") return null;
  const primary = invoice.primaryDoc;
  if (!primary) return null;

  const meta = primary.metadata as Record<string, unknown> | null;
  if (meta?.kind === "ksef_summary_pdf") {
    const raw = meta.derivedFromDocumentId;
    if (typeof raw === "string" && raw.trim().length > 0) {
      const derived = await prisma.document.findFirst({
        where: { id: raw.trim(), tenantId, deletedAt: null },
      });
      if (derived) {
        const mt = (derived.mimeType ?? "").toLowerCase();
        if (mt.includes("xml") || mt.includes("text")) return derived;
      }
    }
  }

  const kn = (invoice.ksefNumber ?? invoice.sourceExternalId)?.trim();
  if (!kn) return null;
  return prisma.document.findFirst({
    where: { tenantId, sourceType: "KSEF", sourceExternalId: kn, deletedAt: null },
    orderBy: { createdAt: "desc" },
  });
}

function documentDownloadName(doc: Document): string {
  const meta = doc.metadata as Record<string, unknown> | null;
  const fn = meta?.filename;
  if (typeof fn === "string" && fn.trim().length > 0) {
    return fn.trim().replace(/[/\\]/g, "_").slice(0, 200);
  }
  return `document-${doc.id.slice(0, 8)}`;
}

export async function openInvoicePrimaryDocumentStream(
  prisma: PrismaClient,
  tenantId: string,
  invoiceId: string,
  opts?: PrimaryDocumentStreamOptions,
): Promise<{
  stream: Readable;
  mimeType: string;
  downloadName: string;
  contentLength?: number;
}> {
  const inv = await prisma.invoice.findFirst({
    where: { id: invoiceId, tenantId },
    include: { primaryDoc: true },
  });
  if (!inv) throw AppError.notFound("Invoice not found");
  let doc = inv.primaryDoc;
  if (!doc || doc.deletedAt) {
    throw AppError.notFound("Invoice has no primary document");
  }

  if (opts?.ksefFaXml) {
    const xmlDoc = await resolveKsefFaXmlDocument(prisma, tenantId, {
      id: inv.id,
      ksefNumber: inv.ksefNumber,
      sourceExternalId: inv.sourceExternalId,
      intakeSourceType: inv.intakeSourceType,
      primaryDoc: inv.primaryDoc,
    });
    if (!xmlDoc || xmlDoc.deletedAt) {
      throw AppError.notFound("KSeF FA XML not found for this invoice");
    }
    doc = xmlDoc;
  }

  const cfg = loadConfig();
  const maxBytes = cfg.MAX_DOCUMENT_PREVIEW_MB * 1024 * 1024;
  if (doc.sizeBytes > maxBytes) {
    throw AppError.payloadTooLarge(
      `Document size exceeds preview limit (${cfg.MAX_DOCUMENT_PREVIEW_MB} MB) — download via other means or raise MAX_DOCUMENT_PREVIEW_MB`,
    );
  }

  const storage = createObjectStorage();
  try {
    const { stream, contentLength } = await storage.getObjectStream({
      key: doc.storageKey,
      bucket: doc.storageBucket,
    });
    return {
      stream,
      mimeType: doc.mimeType || "application/octet-stream",
      downloadName: documentDownloadName(doc),
      contentLength,
    };
  } catch {
    throw AppError.notFound("Document file missing in storage");
  }
}
