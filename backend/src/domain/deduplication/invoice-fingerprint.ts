import { createHash } from "node:crypto";

function normNip(nip: string | null | undefined): string {
  if (!nip) return "";
  return nip.replace(/\D/g, "");
}

function normNumber(num: string): string {
  return num.replace(/\s+/g, "").toUpperCase();
}

/** Deterministic fingerprint for exact duplicate detection (stored on Invoice.fingerprint). */
export function buildInvoiceFingerprint(input: {
  contractorNip?: string | null;
  number: string;
  issueDateIso: string;
  grossTotal: string;
  currency: string;
}): string {
  const raw = [
    normNip(input.contractorNip),
    normNumber(input.number),
    input.issueDateIso.slice(0, 10),
    input.grossTotal,
    input.currency.toUpperCase(),
  ].join("|");
  return createHash("sha256").update(raw, "utf8").digest("hex");
}
