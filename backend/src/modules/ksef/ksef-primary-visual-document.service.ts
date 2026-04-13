import { createHash } from "node:crypto";
import type { Document, PrismaClient } from "@prisma/client";
import { createObjectStorage } from "../../adapters/storage/create-storage.js";
import { buildKsefInvoiceSummaryPdf } from "./ksef-invoice-summary-pdf.js";

export type XmlDocumentRef = Pick<Document, "id" | "mimeType" | "sourceExternalId">;

/**
 * Opcjonalnie: PDF „podsumowanie” i ustawienie go jako `primaryDoc` (włącz `KSEF_PROMOTE_SUMMARY_PDF_PRIMARY`).
 * Domyślnie pipeline **nie** wywołuje tej funkcji — `primaryDoc` zostaje FA XML dla pełnego podglądu w UI.
 */
export async function promoteKsefXmlPrimaryToSummaryPdf(
  prisma: PrismaClient,
  params: {
    tenantId: string;
    invoiceId: string;
    xmlDocument: XmlDocumentRef;
    ksefNumber: string | null;
    invoiceNumber: string;
    issueDate: Date;
    contractorName: string | null;
    contractorNip: string | null;
    netTotal: string;
    vatTotal: string;
    grossTotal: string;
    currency: string;
  },
): Promise<void> {
  const mime = (params.xmlDocument.mimeType ?? "").toLowerCase();
  if (!mime.includes("xml")) return;

  const ksefNo =
    params.ksefNumber?.trim() || params.xmlDocument.sourceExternalId?.trim() || "";
  if (!ksefNo) return;

  const stableExt = `${params.invoiceId}:ksef-visual-pdf`;

  const issueYmd = params.issueDate.toISOString().slice(0, 10);
  const bytes = await buildKsefInvoiceSummaryPdf({
    ksefNumber: ksefNo,
    invoiceNumber: params.invoiceNumber,
    issueDateYmd: issueYmd,
    contractorName: params.contractorName,
    contractorNip: params.contractorNip,
    netTotal: params.netTotal,
    vatTotal: params.vatTotal,
    grossTotal: params.grossTotal,
    currency: params.currency,
  });

  const buf = Buffer.from(bytes);
  const sha = createHash("sha256").update(buf).digest("hex");
  const safeK = ksefNo.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  const filename = `${safeK}-podglad.pdf`;

  const storage = createObjectStorage();
  const put = await storage.putObject({
    key: `${sha}-${filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`,
    body: buf,
    contentType: "application/pdf",
    tenantId: params.tenantId,
  });

  const storageUrl =
    put.bucket !== undefined && put.bucket !== null ? `s3://${put.bucket}/${put.key}` : `local:${put.key}`;

  const meta = {
    filename,
    storageUrl,
    derivedFromDocumentId: params.xmlDocument.id,
    kind: "ksef_summary_pdf",
  } as object;

  const existing = await prisma.document.findFirst({
    where: { tenantId: params.tenantId, sourceType: "KSEF", sourceExternalId: stableExt },
  });

  let pdfDocId: string;
  if (existing) {
    await prisma.document.update({
      where: { id: existing.id },
      data: {
        sha256: sha,
        storageKey: put.key,
        storageBucket: put.bucket ?? null,
        mimeType: "application/pdf",
        sizeBytes: buf.length,
        metadata: meta,
      },
    });
    pdfDocId = existing.id;
  } else {
    const pdfDoc = await prisma.document.create({
      data: {
        tenantId: params.tenantId,
        sha256: sha,
        storageKey: put.key,
        storageBucket: put.bucket ?? null,
        mimeType: "application/pdf",
        sizeBytes: buf.length,
        sourceType: "KSEF",
        sourceExternalId: stableExt,
        metadata: meta,
      },
    });
    pdfDocId = pdfDoc.id;
  }

  await prisma.invoice.update({
    where: { id: params.invoiceId, tenantId: params.tenantId },
    data: { primaryDocId: pdfDocId },
  });
}
