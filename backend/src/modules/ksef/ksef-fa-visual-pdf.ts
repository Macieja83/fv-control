/**
 * PDF „jak faktura” z treści FA XML — do paczki księgowej i pobrania, gdy MF nie udostępnia PDF przez API.
 * Źródło danych: `tryExtractDraftFromKsefFaXml` (te same pola co podgląd w UI).
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { ExtractedInvoiceDraft } from "../../adapters/ai/ai-invoice.adapter.js";
import { tryExtractDraftFromKsefFaXml } from "./ksef-fa-xml-extract.js";
import { foldForPdfText } from "./ksef-invoice-summary-pdf.js";

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const M = 42;
const LINE_H = 12;
const FOOT = 48;

type DrawCtx = {
  pdf: PDFDocument;
  page: PDFPage;
  y: number;
  font: PDFFont;
  fontBold: PDFFont;
};

function wrapAscii(text: string, maxChars: number): string[] {
  const t = foldForPdfText(text);
  if (!t.trim()) return [""];
  const words = t.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length <= maxChars) cur = next;
    else {
      if (cur) lines.push(cur);
      cur = w.length > maxChars ? w.slice(0, maxChars) : w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function newPage(ctx: DrawCtx): void {
  ctx.page = ctx.pdf.addPage([PAGE_W, PAGE_H]);
  ctx.y = PAGE_H - M;
}

function ensureSpace(ctx: DrawCtx, need: number): void {
  if (ctx.y < M + FOOT + need) {
    newPage(ctx);
  }
}

function drawLine(ctx: DrawCtx, text: string, opts?: { bold?: boolean; size?: number; muted?: boolean }): void {
  ensureSpace(ctx, LINE_H);
  const f = opts?.bold ? ctx.fontBold : ctx.font;
  const size = opts?.size ?? 9;
  const color = opts?.muted ? rgb(0.35, 0.38, 0.42) : rgb(0.12, 0.14, 0.2);
  const lines = wrapAscii(text, 92);
  for (const line of lines) {
    ensureSpace(ctx, LINE_H);
    ctx.page.drawText(line, {
      x: M,
      y: ctx.y,
      size,
      font: f,
      color,
    });
    ctx.y -= LINE_H + (size > 10 ? 2 : 0);
  }
}

function drawTwoColBlock(ctx: DrawCtx, leftTitle: string, leftLines: string[], rightTitle: string, rightLines: string[]): void {
  ensureSpace(ctx, LINE_H + 4);
  const colW = (PAGE_W - 2 * M - 24) / 2;
  const xL = M;
  const xR = M + colW + 24;
  ctx.page.drawText(foldForPdfText(leftTitle), { x: xL, y: ctx.y, size: 9, font: ctx.fontBold, color: rgb(0.1, 0.12, 0.2) });
  ctx.page.drawText(foldForPdfText(rightTitle), { x: xR, y: ctx.y, size: 9, font: ctx.fontBold, color: rgb(0.1, 0.12, 0.2) });
  ctx.y -= LINE_H + 4;

  const maxLines = Math.max(leftLines.length, rightLines.length, 1);
  for (let i = 0; i < maxLines; i++) {
    ensureSpace(ctx, LINE_H);
    const l = leftLines[i] ?? "";
    const r = rightLines[i] ?? "";
    if (l) ctx.page.drawText(l, { x: xL, y: ctx.y, size: 8, font: ctx.font, color: rgb(0.15, 0.17, 0.22) });
    if (r) ctx.page.drawText(r, { x: xR, y: ctx.y, size: 8, font: ctx.font, color: rgb(0.15, 0.17, 0.22) });
    ctx.y -= LINE_H;
  }
  ctx.y -= 6;
}

function drawTableHeader(ctx: DrawCtx): void {
  ensureSpace(ctx, LINE_H + 4);
  const headers = ["Lp", "Nazwa", "Il.", "Jm.", "Netto", "VAT%", "W.netto"];
  const xs = [M, M + 22, M + 290, M + 318, M + 352, M + 400, M + 438];
  const sizes = [8, 8, 8, 8, 8, 8, 8];
  for (let i = 0; i < headers.length; i++) {
    ctx.page.drawText(headers[i]!, {
      x: xs[i]!,
      y: ctx.y,
      size: sizes[i]!,
      font: ctx.fontBold,
      color: rgb(0.1, 0.12, 0.18),
    });
  }
  ctx.y -= LINE_H + 2;
  ctx.y -= 6;
}

function drawTableRow(ctx: DrawCtx, row: string[]): void {
  const xs = [M, M + 22, M + 290, M + 318, M + 352, M + 400, M + 438];
  const h = LINE_H;
  ensureSpace(ctx, h);
  for (let i = 0; i < row.length; i++) {
    ctx.page.drawText(row[i]!, { x: xs[i]!, y: ctx.y, size: 7.5, font: ctx.font, color: rgb(0.12, 0.14, 0.2) });
  }
  ctx.y -= h;
}

/**
 * Zwraca `null`, gdy XML nie jest rozpoznawalnym FA (wtedy paczka może użyć PDF zestawienia).
 */
export async function buildKsefFaXmlVisualPdf(params: {
  xmlBuffer: Buffer;
  mimeType: string;
  ksefNumber: string;
}): Promise<Uint8Array | null> {
  const extracted = tryExtractDraftFromKsefFaXml(params.xmlBuffer, params.mimeType);
  if (!extracted?.draft.number) return null;

  const d: ExtractedInvoiceDraft = extracted.draft;
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const ctx: DrawCtx = {
    pdf,
    page: pdf.addPage([PAGE_W, PAGE_H]),
    y: PAGE_H - M,
    font,
    fontBold,
  };

  drawLine(ctx, "Faktura VAT / struktura FA (KSeF)", { bold: true, size: 14 });
  drawLine(ctx, `Numer faktury: ${d.number ?? "—"}`);
  drawLine(ctx, `Numer KSeF: ${params.ksefNumber}`);
  drawLine(ctx, `Data wystawienia: ${d.issueDate ?? "—"}  |  Waluta: ${d.currency ?? "PLN"}`);
  ctx.y -= 4;

  const sellerLines = [
    ...(d.contractorName ? wrapAscii(d.contractorName, 48) : ["—"]),
    ...(d.contractorNip ? [`NIP: ${d.contractorNip}`] : []),
  ];
  const buyerLines = [
    ...(d.buyerName ? wrapAscii(d.buyerName, 48) : ["—"]),
    ...(d.buyerNip ? [`NIP: ${d.buyerNip}`] : []),
  ];
  drawTwoColBlock(ctx, "Sprzedawca", sellerLines, "Nabywca", buyerLines);

  if (d.lineItems && d.lineItems.length > 0) {
    drawLine(ctx, "Pozycje faktury", { bold: true, size: 10 });
    drawTableHeader(ctx);
    let lp = 1;
    for (const li of d.lineItems) {
      const nameLines = wrapAscii(li.name, 52);
      const firstRow = [
        String(lp),
        nameLines[0] ?? "",
        foldForPdfText(li.quantity).slice(0, 12),
        foldForPdfText((li.unit || "-").slice(0, 8)),
        li.netPrice,
        `${String(li.vatRate).replace(/%$/, "")}%`,
        li.netValue,
      ];
      drawTableRow(ctx, firstRow);
      for (let ni = 1; ni < nameLines.length; ni++) {
        drawTableRow(ctx, ["", nameLines[ni] ?? "", "", "", "", "", ""]);
      }
      lp++;
    }
    ctx.y -= 4;
  }

  drawLine(ctx, "Podsumowanie VAT / kwoty", { bold: true, size: 10 });
  drawLine(ctx, `Razem netto: ${d.netTotal ?? "0.00"} ${d.currency ?? "PLN"}`);
  drawLine(ctx, `Razem VAT: ${d.vatTotal ?? "0.00"} ${d.currency ?? "PLN"}`);
  drawLine(ctx, `Razem brutto: ${d.grossTotal ?? "0.00"} ${d.currency ?? "PLN"}`);
  ctx.y -= 4;

  if (d.paymentForm || d.dueDate || d.bankAccount) {
    drawLine(ctx, "Płatność", { bold: true, size: 10 });
    if (d.paymentForm) drawLine(ctx, `Forma: ${d.paymentForm}`);
    if (d.dueDate) drawLine(ctx, `Termin: ${d.dueDate}`);
    if (d.bankAccount) drawLine(ctx, `Rachunek: ${d.bankAccount}`);
    if (d.bankName) drawLine(ctx, `Bank: ${d.bankName}`);
    if (d.swift) drawLine(ctx, `SWIFT: ${d.swift}`);
    ctx.y -= 4;
  }

  drawLine(
    ctx,
    "Wizualizacja wygenerowana w FV Control na podstawie pliku FA XML (KSeF). " +
      "Wylacznym zrodlem tresci prawnej i strukturalnej pozostaje dokument XML w systemie KSeF oraz portal MF.",
    { size: 7.5, muted: true },
  );

  return pdf.save();
}
