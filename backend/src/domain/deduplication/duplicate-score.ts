import { normalizedLevenshteinSimilarity } from "../../lib/levenshtein.js";

export type DuplicateReasonCode =
  | "EXACT_FILE_HASH"
  | "EXACT_FINGERPRINT"
  | "FUZZY_NUMBER"
  | "AMOUNT_NEAR"
  | "SAME_NIP";

export type DuplicateScoreResult = {
  confidence: number;
  reasonCodes: DuplicateReasonCode[];
};

const AMOUNT_TOLERANCE_RATIO = 0.02;

function amountsClose(a: string, b: string): boolean {
  const x = Number(a);
  const y = Number(b);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  const max = Math.max(Math.abs(x), Math.abs(y), 1e-9);
  return Math.abs(x - y) / max <= AMOUNT_TOLERANCE_RATIO;
}

export function scoreInvoiceDuplicatePair(input: {
  fileHashEqual: boolean;
  fingerprintEqual: boolean;
  numberA: string;
  numberB: string;
  grossA: string;
  grossB: string;
  nipA: string | null;
  nipB: string | null;
}): DuplicateScoreResult {
  const reasonCodes: DuplicateReasonCode[] = [];
  let confidence = 0;

  if (input.fileHashEqual) {
    reasonCodes.push("EXACT_FILE_HASH");
    confidence = Math.max(confidence, 0.99);
  }
  if (input.fingerprintEqual) {
    reasonCodes.push("EXACT_FINGERPRINT");
    confidence = Math.max(confidence, 0.98);
  }

  const nipA = (input.nipA ?? "").replace(/\D/g, "");
  const nipB = (input.nipB ?? "").replace(/\D/g, "");
  if (nipA.length > 0 && nipA === nipB) {
    reasonCodes.push("SAME_NIP");
    confidence = Math.max(confidence, 0.35);
  }

  const sim = normalizedLevenshteinSimilarity(
    input.numberA.replace(/\s/g, ""),
    input.numberB.replace(/\s/g, ""),
  );
  if (sim >= 0.88) {
    reasonCodes.push("FUZZY_NUMBER");
    confidence = Math.max(confidence, 0.55 + sim * 0.25);
  }

  if (amountsClose(input.grossA, input.grossB)) {
    reasonCodes.push("AMOUNT_NEAR");
    confidence = Math.max(confidence, 0.45);
  }

  confidence = Math.min(1, confidence);
  return { confidence, reasonCodes };
}
