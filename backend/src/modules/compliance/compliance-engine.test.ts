import { describe, expect, it } from "vitest";
import type { AppConfig } from "../../config.js";
import {
  classifyDocumentType,
  detectLegalChannel,
  determineKsefRequirement,
  evaluateComplianceRules,
  routeReviewStatus,
} from "./compliance-engine.js";

const cfg = {
  SIMPLIFIED_RECEIPT_MAX_PLN: 450,
  SIMPLIFIED_RECEIPT_MAX_EUR: 100,
} as AppConfig;

describe("compliance-engine", () => {
  it("classifyDocumentType respects declared kind", () => {
    expect(
      classifyDocumentType({
        declaredKind: "RECEIPT_WITH_NIP",
        intakeSourceType: "EMAIL",
      }),
    ).toBe("RECEIPT_WITH_NIP");
  });

  it("detectLegalChannel: KSeF API is KSEF legal channel", () => {
    expect(
      detectLegalChannel({
        intakeSourceType: "KSEF_API",
        documentKind: "INVOICE",
        currency: "PLN",
        grossTotal: 100,
        isOwnSales: false,
        hasStructuredKsefPayload: false,
        ocrConfidence: null,
        duplicateConfidence: null,
        fingerprint: null,
      }),
    ).toBe("KSEF");
  });

  it("determineKsefRequirement: own sales requires KSeF issue flow", () => {
    const r = determineKsefRequirement(
      {
        intakeSourceType: "UPLOAD",
        documentKind: "INVOICE",
        currency: "PLN",
        grossTotal: 1000,
        isOwnSales: true,
        hasStructuredKsefPayload: false,
        ocrConfidence: null,
        duplicateConfidence: null,
        fingerprint: "x",
      },
      cfg,
    );
    expect(r.required).toBe(true);
    expect(r.ksefStatus).toBe("TO_ISSUE");
  });

  it("determineKsefRequirement: small receipt with NIP stays out of mandatory KSeF issue", () => {
    const r = determineKsefRequirement(
      {
        intakeSourceType: "CASH_REGISTER",
        documentKind: "RECEIPT_WITH_NIP",
        currency: "PLN",
        grossTotal: 200,
        isOwnSales: false,
        hasStructuredKsefPayload: false,
        ocrConfidence: null,
        duplicateConfidence: null,
        fingerprint: "x",
      },
      cfg,
    );
    expect(r.required).toBe(false);
    expect(r.ksefStatus).toBe("NOT_APPLICABLE");
  });

  it("evaluateComplianceRules flags external email PDF as outside_ksef not auto legalized", () => {
    const out = evaluateComplianceRules(
      {
        intakeSourceType: "EMAIL",
        documentKind: "INVOICE",
        currency: "PLN",
        grossTotal: 500,
        isOwnSales: false,
        hasStructuredKsefPayload: false,
        ocrConfidence: null,
        duplicateConfidence: null,
        fingerprint: "fp1",
      },
      cfg,
    );
    expect(out.legalChannel).toBe("OUTSIDE_KSEF");
    expect(out.complianceFlags).toContain("external_document_not_auto_legalized");
    expect(out.ksefRequired).toBe(false);
  });

  it("routeReviewStatus: OCR_SCAN forces needs_review", () => {
    expect(
      routeReviewStatus(
        {
          intakeSourceType: "OCR_SCAN",
          documentKind: "INVOICE",
          currency: "PLN",
          grossTotal: 1,
          isOwnSales: false,
          hasStructuredKsefPayload: false,
          ocrConfidence: 0.99,
          duplicateConfidence: null,
          fingerprint: null,
        },
        "OUTSIDE_KSEF",
      ),
    ).toBe("NEEDS_REVIEW");
  });
});
