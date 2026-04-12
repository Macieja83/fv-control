import { describe, expect, it } from "vitest";
import { orientInvoiceDuplicateRoles, scoreInvoiceDuplicatePair } from "./duplicate-score.js";

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

  it("same NIP + same gross + same issue day passes threshold even when numbers differ (KSeF vs OCR)", () => {
    const r = scoreInvoiceDuplicatePair({
      fileHashEqual: false,
      fingerprintEqual: false,
      numberA: "FV/2026/ORLEN/123",
      numberB: "ING-OCR-GARBAGE",
      grossA: "99.98",
      grossB: "99.98",
      nipA: "5260000000",
      nipB: "5260000000",
      issueDateA: "2026-04-06",
      issueDateB: "2026-04-06",
    });
    expect(r.reasonCodes).toContain("NIP_AMOUNT_SAME_DAY");
    expect(r.confidence).toBeGreaterThanOrEqual(0.72);
  });

  it("same gross + same issue day without matching NIP still passes threshold (OCR missed NIP)", () => {
    const r = scoreInvoiceDuplicatePair({
      fileHashEqual: false,
      fingerprintEqual: false,
      numberA: "FV/A",
      numberB: "FV/B",
      grossA: "99.98",
      grossB: "99.98",
      nipA: null,
      nipB: "5260000000",
      issueDateA: "2026-04-06",
      issueDateB: "2026-04-06",
    });
    expect(r.reasonCodes).toContain("AMOUNT_SAME_ISSUE_DAY");
    expect(r.confidence).toBeGreaterThanOrEqual(0.72);
  });
});

describe("orientInvoiceDuplicateRoles", () => {
  const t0 = new Date("2026-04-01T10:00:00Z");
  const t1 = new Date("2026-04-02T10:00:00Z");

  it("prefers KSEF_API as canonical over EMAIL", () => {
    const ksef = { id: "a", intakeSourceType: "KSEF_API", createdAt: t1 };
    const mail = { id: "b", intakeSourceType: "EMAIL", createdAt: t0 };
    expect(orientInvoiceDuplicateRoles(ksef, mail)).toEqual({ canonicalId: "a", candidateId: "b" });
    expect(orientInvoiceDuplicateRoles(mail, ksef)).toEqual({ canonicalId: "a", candidateId: "b" });
  });

  it("when both non-KSEF, older createdAt is canonical", () => {
    const older = { id: "x", intakeSourceType: "EMAIL", createdAt: t0 };
    const newer = { id: "y", intakeSourceType: "UPLOAD", createdAt: t1 };
    expect(orientInvoiceDuplicateRoles(newer, older)).toEqual({ canonicalId: "x", candidateId: "y" });
  });

  it("prefers invoice with ksefNumber as canonical even if intakeSourceType is not KSEF_API", () => {
    const fromRepo = { id: "k", intakeSourceType: "UPLOAD", createdAt: t1, ksefNumber: "1234567890-AB-CD-EF" };
    const scan = { id: "s", intakeSourceType: "UPLOAD", createdAt: t0, ksefNumber: null };
    expect(orientInvoiceDuplicateRoles(scan, fromRepo)).toEqual({ canonicalId: "k", candidateId: "s" });
  });
});
