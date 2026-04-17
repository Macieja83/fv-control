import { createHash } from "node:crypto";
import type { Document, PrismaClient } from "@prisma/client";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { createObjectStorage } from "../../adapters/storage/create-storage.js";
import { buildFa3InvoiceXml } from "./ksef-fa3-xml.js";

function safeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function foldAscii(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\n\t\x20-\x7E]/g, " ");
}

async function buildSalesInvoicePreviewPdf(input: {
  invoiceNumber: string;
  issueDateYmd: string;
  sellerName: string;
  sellerNip: string;
  buyerName: string;
  buyerNip: string;
  currency: string;
  netTotal: string;
  vatTotal: string;
  grossTotal: string;
  lines: Array<{ name: string; quantity: string; unit: string | null; netValue: string; grossValue: string }>;
}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let y = 800;
  const x = 44;
  const draw = (text: string, bold = false, size = 10) => {
    page.drawText(foldAscii(text), {
      x,
      y,
      size,
      font: bold ? fontBold : font,
      color: rgb(0.12, 0.14, 0.2),
    });
    y -= size + 6;
  };

  draw("Faktura sprzedazowa - podglad", true, 14);
  draw(`Numer: ${input.invoiceNumber}`);
  draw(`Data wystawienia: ${input.issueDateYmd}`);
  draw(`Sprzedawca: ${input.sellerName} (NIP ${input.sellerNip || "-"})`);
  draw(`Nabywca: ${input.buyerName} (NIP ${input.buyerNip || "-"})`);
  y -= 4;
  draw("Pozycje:", true, 11);
  for (const line of input.lines.slice(0, 18)) {
    draw(
      `- ${line.name || "Pozycja"} | ${line.quantity} ${line.unit ?? "szt."} | netto ${line.netValue} | brutto ${line.grossValue}`,
    );
    if (y < 120) break;
  }
  y -= 6;
  draw(`Razem netto: ${input.netTotal} ${input.currency}`, true);
  draw(`VAT: ${input.vatTotal} ${input.currency}`, true);
  draw(`Razem brutto: ${input.grossTotal} ${input.currency}`, true);
  y -= 6;
  draw("Dokument podgladowy wygenerowany automatycznie przed wysylka do KSeF.");
  draw("Struktura FA XML (draft) jest zapisana osobno dla dalszej wysylki.");

  return pdf.save();
}

async function upsertGeneratedDocument(
  prisma: PrismaClient,
  params: {
    tenantId: string;
    sourceExternalId: string;
    mimeType: string;
    filename: string;
    bytes: Buffer;
    metadataKind: string;
    invoiceId: string;
  },
): Promise<Document> {
  const sha = createHash("sha256").update(params.bytes).digest("hex");
  const storage = createObjectStorage();
  const safe = safeFilename(params.filename);
  const put = await storage.putObject({
    key: `${sha}-${safe}`,
    body: params.bytes,
    contentType: params.mimeType,
    tenantId: params.tenantId,
  });

  const metadata = {
    filename: params.filename,
    kind: params.metadataKind,
    invoiceId: params.invoiceId,
  } as object;

  const existing = await prisma.document.findFirst({
    where: {
      tenantId: params.tenantId,
      sourceType: "MANUAL_UPLOAD",
      sourceExternalId: params.sourceExternalId,
    },
  });
  if (existing) {
    return prisma.document.update({
      where: { id: existing.id },
      data: {
        sha256: sha,
        storageKey: put.key,
        storageBucket: put.bucket ?? null,
        mimeType: params.mimeType,
        sizeBytes: params.bytes.length,
        metadata,
      },
    });
  }
  return prisma.document.create({
    data: {
      tenantId: params.tenantId,
      sha256: sha,
      storageKey: put.key,
      storageBucket: put.bucket ?? null,
      mimeType: params.mimeType,
      sizeBytes: params.bytes.length,
      sourceType: "MANUAL_UPLOAD",
      sourceExternalId: params.sourceExternalId,
      metadata,
    },
  });
}

export async function regenerateSalesInvoicePreviewDocuments(
  prisma: PrismaClient,
  tenantId: string,
  invoiceId: string,
): Promise<void> {
  const inv = await prisma.invoice.findFirst({
    where: { id: invoiceId, tenantId },
    include: {
      tenant: true,
      contractor: true,
      items: { orderBy: { id: "asc" } },
    },
  });
  if (!inv || inv.ledgerKind !== "SALE") return;

  const sellerNip = (inv.tenant.nip ?? "").replace(/\D/g, "");
  const buyerNip = (inv.contractor?.nip ?? "").replace(/\D/g, "");
  const sellerNipSafe = sellerNip.length === 10 ? sellerNip : "0000000000";
  const buyerNipSafe = buyerNip.length === 10 ? buyerNip : "0000000000";
  const issueYmd = inv.issueDate.toISOString().slice(0, 10);
  const lines = inv.items.map((it) => ({
    name: it.name,
    quantity: it.quantity.toString(),
    unit: it.unit,
    netPrice: it.netPrice.toString(),
    vatRate: it.vatRate.toString(),
    netValue: it.netValue.toString(),
    grossValue: it.grossValue.toString(),
  }));

  const xml = buildFa3InvoiceXml({
    sellerName: inv.tenant.name || "Sprzedawca",
    sellerNip: sellerNipSafe,
    buyerName: inv.contractor?.name || "Nabywca",
    buyerNip: buyerNipSafe,
    invoiceNumber: inv.number,
    issueDateYmd: issueYmd,
    currency: inv.currency,
    lines,
    netTotal: inv.netTotal.toString(),
    vatTotal: inv.vatTotal.toString(),
    grossTotal: inv.grossTotal.toString(),
  });

  const xmlDoc = await upsertGeneratedDocument(prisma, {
    tenantId,
    sourceExternalId: `${invoiceId}:sale-fa3-draft-xml`,
    mimeType: "application/xml",
    filename: `${safeFilename(inv.number || invoiceId)}-ksef-draft.xml`,
    bytes: Buffer.from(xml, "utf-8"),
    metadataKind: "sale_fa3_draft_xml",
    invoiceId,
  });

  const pdfBytes = await buildSalesInvoicePreviewPdf({
    invoiceNumber: inv.number,
    issueDateYmd: issueYmd,
    sellerName: inv.tenant.name || "Sprzedawca",
    sellerNip: sellerNipSafe,
    buyerName: inv.contractor?.name || "Nabywca",
    buyerNip: buyerNipSafe,
    currency: inv.currency,
    netTotal: inv.netTotal.toString(),
    vatTotal: inv.vatTotal.toString(),
    grossTotal: inv.grossTotal.toString(),
    lines,
  });

  await upsertGeneratedDocument(prisma, {
    tenantId,
    sourceExternalId: `${invoiceId}:sale-preview-pdf`,
    mimeType: "application/pdf",
    filename: `${safeFilename(inv.number || invoiceId)}-podglad.pdf`,
    bytes: Buffer.from(pdfBytes),
    metadataKind: "sale_preview_pdf",
    invoiceId,
  });

  await prisma.invoice.update({
    where: { id: invoiceId, tenantId },
    data: {
      primaryDocId: xmlDoc.id,
    },
  });
}
