import type {
  InvoiceDocumentKind,
  InvoiceIntakeSourceType,
  InvoiceReviewStatus,
  KsefWorkflowStatus,
  LegalChannel,
} from "@prisma/client";
import type { AppConfig } from "../../config.js";

export type ComplianceRuleInput = {
  intakeSourceType: InvoiceIntakeSourceType;
  documentKind: InvoiceDocumentKind;
  currency: string;
  grossTotal: number;
  isOwnSales: boolean;
  hasStructuredKsefPayload: boolean;
  ocrConfidence: number | null;
  duplicateConfidence: number | null;
  fingerprint: string | null;
};

export type ComplianceRuleResult = {
  documentKind: InvoiceDocumentKind;
  legalChannel: LegalChannel;
  ksefRequired: boolean;
  ksefStatus: KsefWorkflowStatus;
  reviewStatus: InvoiceReviewStatus;
  complianceFlags: string[];
  duplicateHash: string | null;
  duplicateScore: number | null;
};

function grossInPlnEquivalent(input: ComplianceRuleInput): number {
  const g = input.grossTotal;
  if (input.currency === "PLN") return g;
  if (input.currency === "EUR") return g * 4.3;
  return g;
}

/**
 * Heuristic document kind from intake hints (does not legalize; classification only).
 */
export function classifyDocumentType(input: {
  declaredKind?: InvoiceDocumentKind | null;
  filename?: string | null;
  intakeSourceType: InvoiceIntakeSourceType;
}): InvoiceDocumentKind {
  if (input.declaredKind) return input.declaredKind;
  const fn = (input.filename ?? "").toLowerCase();
  if (fn.includes("korekta") || fn.includes("correct")) return "CORRECTIVE_INVOICE";
  if (fn.includes("proforma")) return "PROFORMA";
  if (input.intakeSourceType === "OCR_SCAN") return "INVOICE";
  return "INVOICE";
}

export function detectLegalChannel(input: ComplianceRuleInput): LegalChannel {
  if (input.hasStructuredKsefPayload || input.intakeSourceType === "KSEF_API") {
    return "KSEF";
  }
  if (input.isOwnSales) {
    return "KSEF";
  }
  if (input.intakeSourceType === "EMAIL" || input.intakeSourceType === "UPLOAD" || input.intakeSourceType === "OCR_SCAN") {
    return "OUTSIDE_KSEF";
  }
  if (input.documentKind === "PROFORMA") {
    return "EXCLUDED";
  }
  return "UNKNOWN";
}

export function determineKsefRequirement(input: ComplianceRuleInput, cfg: AppConfig): {
  required: boolean;
  ksefStatus: KsefWorkflowStatus;
} {
  if (input.documentKind === "PROFORMA" || input.documentKind === "OTHER") {
    return { required: false, ksefStatus: "NOT_APPLICABLE" };
  }

  if (input.isOwnSales) {
    return { required: true, ksefStatus: "TO_ISSUE" };
  }

  if (input.intakeSourceType === "KSEF_API" || input.hasStructuredKsefPayload) {
    return { required: false, ksefStatus: "RECEIVED" };
  }

  if (input.documentKind === "RECEIPT_WITH_NIP") {
    const plnEq = grossInPlnEquivalent(input);
    const maxPln = cfg.SIMPLIFIED_RECEIPT_MAX_PLN;
    const maxEur = cfg.SIMPLIFIED_RECEIPT_MAX_EUR;
    const within =
      (input.currency === "PLN" && input.grossTotal <= maxPln) ||
      (input.currency === "EUR" && input.grossTotal <= maxEur) ||
      (input.currency !== "PLN" && input.currency !== "EUR" && plnEq <= maxPln);
    if (within) {
      return { required: false, ksefStatus: "NOT_APPLICABLE" };
    }
    return { required: false, ksefStatus: "MANUAL_REVIEW" };
  }

  return { required: false, ksefStatus: "NOT_APPLICABLE" };
}

export function detectDuplicate(fingerprint: string | null, duplicateConfidence: number | null): {
  duplicateHash: string | null;
  duplicateScore: number | null;
} {
  if (!fingerprint) return { duplicateHash: null, duplicateScore: null };
  return {
    duplicateHash: fingerprint,
    duplicateScore: duplicateConfidence,
  };
}

export function buildAccountingPackage(invoice: {
  id: string;
  number: string;
  issueDate: Date;
  currency: string;
  netTotal: { toString(): string };
  vatTotal: { toString(): string };
  grossTotal: { toString(): string };
  documentKind: InvoiceDocumentKind;
  intakeSourceType: InvoiceIntakeSourceType;
  contractorNip?: string | null;
}): Record<string, unknown> {
  return {
    version: 1,
    invoiceId: invoice.id,
    number: invoice.number,
    issueDate: invoice.issueDate.toISOString().slice(0, 10),
    currency: invoice.currency,
    netTotal: invoice.netTotal.toString(),
    vatTotal: invoice.vatTotal.toString(),
    grossTotal: invoice.grossTotal.toString(),
    documentKind: invoice.documentKind,
    intakeSourceType: invoice.intakeSourceType,
    contractorNip: invoice.contractorNip ?? null,
  };
}

export function routeReviewStatus(input: ComplianceRuleInput, legalChannel: LegalChannel): InvoiceReviewStatus {
  if (input.intakeSourceType === "OCR_SCAN") {
    return "NEEDS_REVIEW";
  }
  if (input.ocrConfidence != null && input.ocrConfidence < 0.75) {
    return "NEEDS_REVIEW";
  }
  if (legalChannel === "UNKNOWN") {
    return "NEEDS_REVIEW";
  }
  if (input.duplicateConfidence != null && input.duplicateConfidence >= 0.72) {
    return "NEEDS_REVIEW";
  }
  return "PARSED";
}

export function evaluateComplianceRules(input: ComplianceRuleInput, cfg: AppConfig): ComplianceRuleResult {
  const legalChannel = detectLegalChannel(input);
  const { required, ksefStatus } = determineKsefRequirement(input, cfg);
  const { duplicateHash, duplicateScore } = detectDuplicate(input.fingerprint, input.duplicateConfidence);
  const flags: string[] = [];
  if (input.intakeSourceType === "OCR_SCAN") flags.push("ocr_requires_review");
  if (input.isOwnSales) flags.push("ksef_first_sales");
  if (input.documentKind === "RECEIPT_WITH_NIP") flags.push("simplified_receipt_path");
  if (legalChannel === "OUTSIDE_KSEF" && input.intakeSourceType !== "KSEF_API") {
    flags.push("external_document_not_auto_legalized");
  }

  return {
    documentKind: input.documentKind,
    legalChannel,
    ksefRequired: required,
    ksefStatus,
    reviewStatus: routeReviewStatus(input, legalChannel),
    complianceFlags: flags,
    duplicateHash,
    duplicateScore,
  };
}
