import { describe, expect, it } from "vitest";
import { buildKsefInvoiceSummaryPdf, foldForPdfText } from "./ksef-invoice-summary-pdf.js";

describe("buildKsefInvoiceSummaryPdf", () => {
  it("produces a valid PDF header", async () => {
    const bytes = await buildKsefInvoiceSummaryPdf({
      ksefNumber: "1234567890-20260101-ABCDEF",
      invoiceNumber: "FV/1/2026",
      issueDateYmd: "2026-04-01",
      contractorName: "Test Sp zoo",
      contractorNip: "1234567890",
      netTotal: "100.00",
      vatTotal: "23.00",
      grossTotal: "123.00",
      currency: "PLN",
    });
    const head = Buffer.from(bytes.subarray(0, 5)).toString("utf8");
    expect(head).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(500);
  });
});

describe("foldForPdfText", () => {
  it("folds diacritics for WinAnsi-safe output", () => {
    expect(foldForPdfText("ąę")).toBe("ae");
  });
});
