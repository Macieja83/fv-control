import type { Document, PrismaClient } from "@prisma/client";
import type { Readable } from "node:stream";
import { createObjectStorage } from "../../adapters/storage/create-storage.js";
import { loadConfig } from "../../config.js";
import { AppError } from "../../lib/errors.js";

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
  const doc = inv.primaryDoc;
  if (!doc || doc.deletedAt) {
    throw AppError.notFound("Invoice has no primary document");
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
