import { describe, expect, it } from "vitest";
import { scoreInvoiceDuplicatePair } from "./duplicate-score.js";

describe("scoreInvoiceDuplicatePair", () => {
  it("flags exact fingerprint", () => {
    const r = scoreInvoiceDuplicatePair({
      fileHashEqual: false,
      fingerprintEqual: true,
      numberA: "FV/1",
      numberB: "FV/2",
      grossA: "100",
      grossB: "200",
      nipA: "123",
      nipB: "999",
    });
    expect(r.reasonCodes).toContain("EXACT_FINGERPRINT");
    expect(r.confidence).toBeGreaterThanOrEqual(0.98);
  });

  it("combines fuzzy number and amount", () => {
    const r = scoreInvoiceDuplicatePair({
      fileHashEqual: false,
      fingerprintEqual: false,
      numberA: "FV/2026/001",
      numberB: "FV/2026/002",
      grossA: "100.00",
      grossB: "100.50",
      nipA: "5260000000",
      nipB: "5260000000",
    });
    expect(r.reasonCodes.length).toBeGreaterThan(0);
    expect(r.confidence).toBeGreaterThan(0.5);
  });
});
