import { describe, expect, it } from "vitest";
import { draftFromKsefDocumentMetadata } from "./ksef-metadata-draft.js";

describe("draftFromKsefDocumentMetadata", () => {
  it("builds draft from KSeF sync metadata", () => {
    const d = draftFromKsefDocumentMetadata({
      invoiceNumber: "FV/1/04/2026",
      issueDate: "2026-04-10",
      sellerNip: "774-000-14-54",
      sellerName: " Urząd Skarbowy ",
      netAmount: 100,
      vatAmount: 23,
      grossAmount: 123,
      currency: "PLN",
    });
    expect(d).not.toBeNull();
    expect(d!.number).toBe("FV/1/04/2026");
    expect(d!.issueDate).toBe("2026-04-10");
    expect(d!.contractorNip).toBe("7740001454");
    expect(d!.contractorName).toContain("Urząd");
    expect(d!.grossTotal).toBe("123.00");
  });

  it("returns null without invoiceNumber", () => {
    expect(draftFromKsefDocumentMetadata({ sellerNip: "1234567890" })).toBeNull();
  });
});
