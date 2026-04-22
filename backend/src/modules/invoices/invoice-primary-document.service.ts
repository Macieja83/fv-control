import type { Document, PrismaClient } from "@prisma/client";
import { Readable } from "node:stream";
import { createObjectStorage } from "../../adapters/storage/create-storage.js";
import { loadConfig } from "../../config.js";
import { AppError } from "../../lib/errors.js";
import {
  buildImageScanPdf,
  buildInvoiceDataSummaryPdf,
  buildKsefInvoiceSummaryPdf,
} from "../ksef/ksef-invoice-summary-pdf.js";

export type PrimaryDocumentStreamOptions = {
  /**
   * Dla faktur z KSeF: zwróć **oryginalny FA XML** zamiast wizualnego PDF podsumowania,
   * żeby frontend mógł pokazać pełny podgląd (`KsefInvoicePreview`).
   */
  ksefFaXml?: boolean;
  /**
   * Paczka księgowa / ZIP: zawsze `application/pdf` — treść oryg. PDF, przerysowanie KSeF XML
   * na ten sam „podgląd” co w UI, albo skan w PDF (JPG/PNG) / zestawienie pól gdy inny typ.
   */
  accountantPdf?: boolean;
};

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function decimal2(d: { toFixed: (n: number) => string }): string {
  return d.toFixed(2);
}

function issueYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

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
  // Manual sales invoice: when primary is generated preview PDF, switch preview to FA(3) XML draft.
  const primaryMeta = invoice.primaryDoc?.metadata as Record<string, unknown> | null;
  if (primaryMeta?.kind === "sale_preview_pdf") {
    const saleDraft = await prisma.document.findFirst({
      where: {
        tenantId,
        sourceType: "MANUAL_UPLOAD",
        sourceExternalId: `${invoice.id}:sale-fa3-draft-xml`,
        deletedAt: null,
      },
      orderBy: { createdAt: "desc" },
    });
    if (saleDraft) {
      const mt = (saleDraft.mimeType ?? "").toLowerCase();
      if (mt.includes("xml") || mt.includes("text")) return saleDraft;
    }
  }

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
    include: { primaryDoc: true, contractor: true },
  });
  if (!inv) throw AppError.notFound("Invoice not found");
  let doc = inv.primaryDoc;
  if (!doc || doc.deletedAt) {
    throw AppError.notFound("Invoice has no primary document");
  }

  const cfg = loadConfig();
  const maxBytes = cfg.MAX_DOCUMENT_PREVIEW_MB * 1024 * 1024;

  if (opts?.accountantPdf) {
    const pdoc = inv.primaryDoc;
    if (!pdoc || pdoc.deletedAt) {
      throw AppError.notFound("Invoice has no primary document");
    }
    if (pdoc.sizeBytes > maxBytes) {
      throw AppError.payloadTooLarge(
        `Document size exceeds preview limit (${cfg.MAX_DOCUMENT_PREVIEW_MB} MB) — download via other means or raise MAX_DOCUMENT_PREVIEW_MB`,
      );
    }
    const storage0 = createObjectStorage();
    let fileBuf: Buffer;
    try {
      const { stream: src } = await storage0.getObjectStream({
        key: pdoc.storageKey,
        bucket: pdoc.storageBucket,
      });
      fileBuf = await streamToBuffer(src);
    } catch {
      throw AppError.notFound("Document file missing in storage");
    }
    const safeBase = (inv.number || "faktura")
      .replace(/[/\\:*?"<>|]+/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120) || "faktura";
    const downloadName = `${safeBase}__${inv.id.replace(/-/g, "").slice(0, 8)}.pdf`;
    const mimeL = (pdoc.mimeType || "").toLowerCase();

    if (mimeL.includes("pdf")) {
      return {
        stream: Readable.from([fileBuf]) as Readable,
        mimeType: "application/pdf",
        downloadName,
        contentLength: fileBuf.length,
      };
    }

    const cName = inv.contractor?.name?.trim() || null;
    const cNip = inv.contractor?.nip?.trim() || null;
    const isKsefXml =
      inv.intakeSourceType === "KSEF_API" &&
      pdoc.sourceType === "KSEF" &&
      (mimeL.includes("xml") || mimeL === "text/plain" || mimeL === "application/xml");
    if (isKsefXml) {
      const kn = (inv.ksefNumber ?? inv.sourceExternalId ?? "").trim() || "—";
      const out = await buildKsefInvoiceSummaryPdf({
        ksefNumber: kn,
        invoiceNumber: inv.number,
        issueDateYmd: issueYmd(inv.issueDate),
        contractorName: cName,
        contractorNip: cNip,
        netTotal: decimal2(inv.netTotal),
        vatTotal: decimal2(inv.vatTotal),
        grossTotal: decimal2(inv.grossTotal),
        currency: inv.currency,
      });
      return {
        stream: Readable.from([Buffer.from(out)]) as Readable,
        mimeType: "application/pdf",
        downloadName,
        contentLength: out.length,
      };
    }

    if (mimeL.startsWith("image/") && (mimeL.includes("png") || mimeL.includes("jpeg") || mimeL.includes("jpg"))) {
      let out: Uint8Array;
      try {
        out = await buildImageScanPdf(fileBuf, pdoc.mimeType || "image/jpeg");
      } catch {
        throw AppError.validation("Nie udało się zapisac skanu jako PDF (obsługiwane: JPG, PNG).");
      }
      return {
        stream: Readable.from([Buffer.from(out)]) as Readable,
        mimeType: "application/pdf",
        downloadName,
        contentLength: out.length,
      };
    }

    const foot =
      (mimeL.includes("xml") || pdoc.sourceType === "KSEF") && !isKsefXml
        ? "Pelna Faktura FA (XML) jest w systemie — ta strona to zestawienie pol do wysylki. Otwórz fakturę w aplikacji po plik zrodlowy."
        : "Dokument zrodlowy w formacie innym niz PDF — zestawienie danych z bazy (FV Control).";
    const out2 = await buildInvoiceDataSummaryPdf({
      title: "Faktura (FV Control / paczka ksiegowa)",
      invoiceNumber: inv.number,
      issueDateYmd: issueYmd(inv.issueDate),
      contractorName: cName,
      contractorNip: cNip,
      netTotal: decimal2(inv.netTotal),
      vatTotal: decimal2(inv.vatTotal),
      grossTotal: decimal2(inv.grossTotal),
      currency: inv.currency,
      ksefNumber: inv.ksefNumber?.trim() || inv.sourceExternalId?.trim() || null,
      footnote: foot,
    });
    return {
      stream: Readable.from([Buffer.from(out2)]) as Readable,
      mimeType: "application/pdf",
      downloadName,
      contentLength: out2.length,
    };
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
