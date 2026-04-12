import { normalizedLevenshteinSimilarity } from "../../lib/levenshtein.js";

export type DuplicateReasonCode =
  | "EXACT_FILE_HASH"
  | "EXACT_FINGERPRINT"
  | "FUZZY_NUMBER"
  | "AMOUNT_NEAR"
  | "SAME_NIP"
  | "NIP_AMOUNT_SAME_DAY"
  | "AMOUNT_SAME_ISSUE_DAY";

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

/** YYYY-MM-DD for same-calendar-day duplicate hints (KSeF vs zdjęcie / OCR). */
function normalizeIssueYmd(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "string") {
    if (value.length >= 10 && value[4] === "-" && value[7] === "-") {
      return value.slice(0, 10);
    }
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  }
  return null;
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
  /** Data wystawienia (np. z faktury) — wzmacnia wykrywanie gdy numery FV różnią się przez OCR. */
  issueDateA?: Date | string | null;
  issueDateB?: Date | string | null;
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

  const ymdA = normalizeIssueYmd(input.issueDateA);
  const ymdB = normalizeIssueYmd(input.issueDateB);
  const sameIssueDay = Boolean(ymdA && ymdB && ymdA === ymdB);

  if (
    nipA.length === 10 &&
    nipA === nipB &&
    amountsClose(input.grossA, input.grossB) &&
    sameIssueDay
  ) {
    reasonCodes.push("NIP_AMOUNT_SAME_DAY");
    confidence = Math.max(confidence, 0.88);
  }

  if (
    amountsClose(input.grossA, input.grossB) &&
    sameIssueDay &&
    !(nipA.length === 10 && nipA === nipB)
  ) {
    reasonCodes.push("AMOUNT_SAME_ISSUE_DAY");
    confidence = Math.max(confidence, 0.76);
  }

  confidence = Math.min(1, confidence);
  return { confidence, reasonCodes };
}

export type InvoiceDuplicateRoleInput = {
  id: string;
  intakeSourceType: string;
  createdAt: Date;
  /** Ustawione dla faktur z repozytorium KSeF — silniejszy sygnał niż sam `intakeSourceType` (np. po migracji). */
  ksefNumber?: string | null;
};

export function isKsefRepositoryInvoice(x: InvoiceDuplicateRoleInput): boolean {
  return Boolean(x.ksefNumber?.trim()) || x.intakeSourceType === "KSEF_API";
}

/** Oba wpisy z KSeF — bez relacji duplikatu między sobą (oba to oryginały z MF). */
export function areBothKsefRepositoryInvoices(
  a: InvoiceDuplicateRoleInput,
  b: InvoiceDuplicateRoleInput,
): boolean {
  return isKsefRepositoryInvoice(a) && isKsefRepositoryInvoice(b);
}

/**
 * Wybór „oryginał” (canonical) vs duplikat (candidate):
 * — dokument z numerem KSeF (`ksefNumber`) lub `KSEF_API` zawsze nad kanałem zwykłym;
 * — przy remisie — starszy wpis (`createdAt`).
 */
export function orientInvoiceDuplicateRoles(
  a: InvoiceDuplicateRoleInput,
  b: InvoiceDuplicateRoleInput,
): { canonicalId: string; candidateId: string } {
  const aRepo = isKsefRepositoryInvoice(a);
  const bRepo = isKsefRepositoryInvoice(b);
  if (aRepo && !bRepo) return { canonicalId: a.id, candidateId: b.id };
  if (bRepo && !aRepo) return { canonicalId: b.id, candidateId: a.id };

  const aK = a.intakeSourceType === "KSEF_API";
  const bK = b.intakeSourceType === "KSEF_API";
  if (aK && !bK) return { canonicalId: a.id, candidateId: b.id };
  if (bK && !aK) return { canonicalId: b.id, candidateId: a.id };
  const aTime = a.createdAt.getTime();
  const bTime = b.createdAt.getTime();
  if (aTime !== bTime) {
    return aTime <= bTime ? { canonicalId: a.id, candidateId: b.id } : { canonicalId: b.id, candidateId: a.id };
  }
  return a.id <= b.id ? { canonicalId: a.id, candidateId: b.id } : { canonicalId: b.id, candidateId: a.id };
}
