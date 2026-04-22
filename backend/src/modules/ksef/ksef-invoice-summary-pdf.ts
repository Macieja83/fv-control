import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

export type KsefSummaryPdfInput = {
  ksefNumber: string;
  invoiceNumber: string;
  issueDateYmd: string;
  contractorName: string | null;
  contractorNip: string | null;
  netTotal: string;
  vatTotal: string;
  grossTotal: string;
  currency: string;
};

/** Helvetica (WinAnsi) — polskie znaki → ASCII, reszta spoza Latin → `?` / spacja. */
export function foldForPdfText(s: string): string {
  const pl: Record<string, string> = {
    ą: "a",
    ć: "c",
    ę: "e",
    ł: "l",
    ń: "n",
    ó: "o",
    ś: "s",
    ź: "z",
    ż: "z",
    Ą: "A",
    Ć: "C",
    Ę: "E",
    Ł: "L",
    Ń: "N",
    Ó: "O",
    Ś: "S",
    Ź: "Z",
    Ż: "Z",
  };
  let t = s.normalize("NFC");
  for (const [k, v] of Object.entries(pl)) {
    if (k.length === 1) t = t.split(k).join(v);
  }
  return t
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\n\t\x20-\x7E]/g, (ch) => (/\s/.test(ch) ? " " : "?"));
}

function wrapLines(text: string, maxChars: number): string[] {
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

type TextBlock = { text: string; bold?: boolean; title?: boolean };

function drawTextBlocks(page: PDFPage, blocks: TextBlock[], font: PDFFont, fontBold: PDFFont): void {
  let y = 800;
  const x = 50;
  const maxChars = 85;
  for (const b of blocks) {
    const f = b.bold ? fontBold : font;
    const fontSize = b.title ? 14 : 10;
    const lineGap = b.title ? 18 : 13;
    for (const line of wrapLines(b.text, maxChars)) {
      if (y < 56) return;
      page.drawText(line, { x, y, size: fontSize, font: f, color: rgb(0.1, 0.15, 0.25) });
      y -= lineGap;
    }
  }
}

async function renderTextBlocksToPdfBytes(blocks: TextBlock[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  drawTextBlocks(page, blocks, font, fontBold);
  return pdf.save();
}

/**
 * Jednostronicowy PDF z kluczowymi polami — do podglądu i pobrania tak jak PDF z maila.
 * Nie zastępuje oficjalnego FA XML; XML pozostaje osobnym rekordem Document.
 */
export async function buildKsefInvoiceSummaryPdf(input: KsefSummaryPdfInput): Promise<Uint8Array> {
  const blocks: TextBlock[] = [
    { text: "Faktura z KSeF (podglad PDF)", bold: true, title: true },
    { text: "" },
    { text: `Numer KSeF: ${input.ksefNumber}` },
    { text: `Numer faktury: ${input.invoiceNumber}` },
    { text: `Data wystawienia: ${input.issueDateYmd}` },
    { text: "" },
    { text: `Sprzedawca: ${input.contractorName?.trim() || "—"}` },
    { text: `NIP: ${input.contractorNip?.trim() || "—"}` },
    { text: "" },
    { text: `Netto: ${input.netTotal} ${input.currency}` },
    { text: `VAT: ${input.vatTotal} ${input.currency}` },
    { text: `Brutto: ${input.grossTotal} ${input.currency}` },
    { text: "" },
    {
      text: "Uproszczony podglad wygenerowany w FV Control z danych po imporcie. Pelna tresc strukturalna znajduje sie w pliku FA XML w KSeF.",
    },
  ];
  return renderTextBlocksToPdfBytes(blocks);
}

/**
 * Uproszczony PDF z pól faktury w bazie — gdy brak pliku PDF (np. XML) i nie chodzi o szablon KSeF.
 */
export async function buildInvoiceDataSummaryPdf(
  input: {
    title: string;
    invoiceNumber: string;
    issueDateYmd: string;
    contractorName: string | null;
    contractorNip: string | null;
    netTotal: string;
    vatTotal: string;
    grossTotal: string;
    currency: string;
    ksefNumber: string | null;
    footnote: string;
  },
): Promise<Uint8Array> {
  const ksefExtra: TextBlock[] = input.ksefNumber?.trim()
    ? [
        { text: `Numer KSeF: ${input.ksefNumber.trim()}` },
        { text: "" },
      ]
    : [];
  const blocks: TextBlock[] = [
    { text: input.title, bold: true, title: true },
    { text: "" },
    ...ksefExtra,
    { text: `Numer faktury: ${input.invoiceNumber}` },
    { text: `Data wystawienia: ${input.issueDateYmd}` },
    { text: "" },
    { text: `Podmiot (dostawca / kontrahent): ${input.contractorName?.trim() || "—"}` },
    { text: `NIP: ${input.contractorNip?.trim() || "—"}` },
    { text: "" },
    { text: `Netto: ${input.netTotal} ${input.currency}` },
    { text: `VAT: ${input.vatTotal} ${input.currency}` },
    { text: `Brutto: ${input.grossTotal} ${input.currency}` },
    { text: "" },
    { text: input.footnote },
  ];
  return renderTextBlocksToPdfBytes(blocks);
}

/**
 * Jednostronicowy PDF ze skanem (JPG/PNG) — do paczki księgowej gdy główny plik to obraz, nie PDF.
 */
export async function buildImageScanPdf(imageBytes: Buffer, mime: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]);
  const m = mime.toLowerCase();
  const image = m.includes("png")
    ? await pdf.embedPng(imageBytes)
    : m.includes("jpeg") || m.includes("jpg")
      ? await pdf.embedJpg(imageBytes)
      : (() => {
          throw new Error("unsupported image type for PDF embedding");
        })();
  const { width, height } = image;
  const margin = 20;
  const pageW = page.getWidth() - 2 * margin;
  const pageH = page.getHeight() - 2 * margin;
  const s = Math.min(pageW / width, pageH / height);
  const dw = width * s;
  const dh = height * s;
  const y = page.getHeight() - margin - dh;
  page.drawImage(image, { x: margin, y, width: dw, height: dh });
  return pdf.save();
}
