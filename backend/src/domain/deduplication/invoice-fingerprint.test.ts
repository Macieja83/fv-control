import { describe, expect, it } from "vitest";
import { buildInvoiceFingerprint } from "./invoice-fingerprint.js";

describe("buildInvoiceFingerprint", () => {
  it("is stable for same logical invoice", () => {
    const a = buildInvoiceFingerprint({
      contractorNip: " 526-000-00-00 ",
      number: " fv/1 ",
      issueDateIso: "2026-03-15T00:00:00.000Z",
      grossTotal: "123.00",
      currency: "pln",
    });
    const b = buildInvoiceFingerprint({
      contractorNip: "5260000000",
      number: "FV/1",
      issueDateIso: "2026-03-15T12:00:00.000Z",
      grossTotal: "123.00",
      currency: "PLN",
    });
    expect(a).toBe(b);
    expect(a.length).toBe(64);
  });
});
