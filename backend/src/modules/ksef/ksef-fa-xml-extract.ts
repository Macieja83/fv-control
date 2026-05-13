/**
 * Strukturalny odczyt polskiej faktury FA (KSeF XML) bez OpenAI — używany w pipeline
 * dla dokumentów z `sourceType: KSEF` / `intakeSourceType: KSEF_API`.
 */
import { XMLParser } from "fast-xml-parser";
import type { ExtractedInvoiceDraft } from "../../adapters/ai/ai-invoice.adapter.js";
import { polishNipDigits10 } from "../contractors/contractor-resolve.js";

/** Zgodnie z KSeF / UI — mapowanie kodu FormaPlatnosci */
const PAYMENT_FORM_LABELS: Record<string, string> = {
  "1": "Gotówka",
  "2": "Karta",
  "3": "Bon",
  "4": "Czek",
  "5": "Kredyt",
  "6": "Przelew",
  "7": "Płatność mobilna",
};

function isXmlMime(mime: string): boolean {
  const m = (mime ?? "").toLowerCase();
  return m.includes("xml") || m === "text/plain";
}

function looksLikeXml(buf: Buffer): boolean {
  const head = buf.subarray(0, Math.min(512, buf.length)).toString("utf8").trimStart();
  return head.startsWith("<?xml") || head.startsWith("<");
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v != null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function pickText(el: unknown): string {
  if (typeof el === "string" || typeof el === "number") return String(el).trim();
  if (typeof el === "object" && el !== null && "#text" in el) {
    return String((el as { "#text": unknown })["#text"]).trim();
  }
  return "";
}

function oneOrFirst<T>(v: T | T[] | undefined): T | undefined {
  if (v == null) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

/** Szuka bloku z polami faktury (P_2 + sumy lub wiersze FA). */
function deepFindFaBlock(node: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > 40) return null;
  const o = asRecord(node);
  if (!o) return null;
  const hasP2 = o.P_2 != null || o.p_2 != null;
  const hasAmounts =
    o.P_15 != null ||
    o.P_13_1 != null ||
    o.P_13_2 != null ||
    o.P_13_3 != null ||
    o.P_13_4 != null ||
    o.P_13_5 != null;
  const hasLines = o.FaWiersz != null || o.FaWiersze != null;
  if (hasP2 && (hasAmounts || hasLines)) return o;

  for (const v of Object.values(o)) {
    if (v == null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") continue;
    const arr = Array.isArray(v) ? v : [v];
    for (const item of arr) {
      const found = deepFindFaBlock(item, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/** Gdy `deepFindFaBlock` nie znajdzie bloku, szukamy węzła z sekcją Płatność (np. nietypowy układ numeru faktury). */
function deepFindRecordContainingKey(node: unknown, key: string, depth = 0): Record<string, unknown> | null {
  if (depth > 40) return null;
  const o = asRecord(node);
  if (!o) return null;
  if (key in o && o[key] != null) return o;
  for (const v of Object.values(o)) {
    if (v == null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") continue;
    const arr = Array.isArray(v) ? v : [v];
    for (const item of arr) {
      const found = deepFindRecordContainingKey(item, key, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/** Sprzedawca z bloku Podmiot1 (FA(2)/FA(3) — często na poziomie Faktura, nie wewnątrz Fa). */
function extractSellerFromPodmiot1(pod1: Record<string, unknown> | null): {
  contractorNip: string | null;
  contractorName: string | null;
} {
  let contractorNip: string | null = null;
  let contractorName: string | null = null;
  if (!pod1) return { contractorNip, contractorName };
  const daneRoot = pod1.DaneIdentyfikacyjne;
  const blocks = daneRoot == null ? [] : Array.isArray(daneRoot) ? daneRoot : [daneRoot];
  for (const block of blocks) {
    const dane = asRecord(block);
    if (!dane) continue;
    const nipRaw =
      pickText(dane.NIP) ||
      pickText(dane.Nip) ||
      pickText(dane.NumerIdentyfikacjiPodatkowej) ||
      pickText(dane.IdentyfikatorPodatkowy);
    const nip10 = polishNipDigits10(nipRaw);
    const nm = pickText(dane.Nazwa) || pickText(dane.Nazwisko) || "";
    if (nip10) {
      contractorNip = nip10;
      contractorName = nm.length > 0 ? nm : null;
      break;
    }
    if (nm.length > 0 && !contractorName) contractorName = nm;
  }
  return { contractorNip, contractorName };
}

function extractPaymentFromFaBlock(fa: Record<string, unknown>): Partial<
  Pick<
    ExtractedInvoiceDraft,
    | "dueDate"
    | "paymentForm"
    | "paymentFormCode"
    | "bankAccount"
    | "bankName"
    | "swift"
    | "paymentDescription"
  >
> {
  const plat = asRecord(oneOrFirst(fa.Platnosc as Record<string, unknown> | Record<string, unknown>[] | undefined));
  if (!plat) return {};

  const out: Partial<
    Pick<
      ExtractedInvoiceDraft,
      | "dueDate"
      | "paymentForm"
      | "paymentFormCode"
      | "bankAccount"
      | "bankName"
      | "swift"
      | "paymentDescription"
    >
  > = {};

  const formaRaw = pickText(plat.FormaPlatnosci);
  if (formaRaw) {
    out.paymentFormCode = formaRaw;
    out.paymentForm = PAYMENT_FORM_LABELS[formaRaw] ?? formaRaw;
  }

  const terminBlock = asRecord(
    oneOrFirst(plat.TerminPlatnosci as Record<string, unknown> | Record<string, unknown>[] | undefined),
  );
  if (terminBlock) {
    const term = pickText(terminBlock.Termin);
    if (term.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(term)) {
      out.dueDate = term.slice(0, 10);
    }
  }
  if (!out.dueDate) {
    const t = pickText(plat.Termin);
    if (t.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(t)) {
      out.dueDate = t.slice(0, 10);
    }
  }

  const rachRows = plat.RachunekBankowy;
  const rachList = rachRows == null ? [] : Array.isArray(rachRows) ? rachRows : [rachRows];
  for (const row of rachList) {
    const rach = asRecord(row);
    if (!rach) continue;
    const nr = pickText(rach.NrRB).replace(/\s/g, "");
    if (nr.length > 0) {
      out.bankAccount = nr;
      const bn = pickText(rach.NazwaBanku);
      if (bn) out.bankName = bn;
      const sw = pickText(rach.SWIFT);
      if (sw) out.swift = sw;
      break;
    }
  }

  const desc = pickText(plat.OpisRachunku) || pickText(plat.OpisPlatnosciInnej);
  if (desc) out.paymentDescription = desc;

  return out;
}

type PaymentDraftFields = Pick<
  ExtractedInvoiceDraft,
  | "dueDate"
  | "paymentForm"
  | "paymentFormCode"
  | "bankAccount"
  | "bankName"
  | "swift"
  | "paymentDescription"
>;

/** Uzupełnia brakujące pola płatności z drugiego odczytu XML (np. przy fallback z metadanych KSeF). */
export function mergeExtractedPaymentFields(
  base: ExtractedInvoiceDraft,
  extra: Partial<PaymentDraftFields>,
): ExtractedInvoiceDraft {
  const out: ExtractedInvoiceDraft = { ...base };
  const take = <K extends keyof PaymentDraftFields>(k: K) => {
    const v = out[k];
    const empty = v == null || (typeof v === "string" && v.trim() === "");
    if (empty && extra[k] != null && String(extra[k]).trim() !== "") {
      (out as Record<string, unknown>)[k] = extra[k];
    }
  };
  take("dueDate");
  take("paymentForm");
  take("paymentFormCode");
  take("bankAccount");
  take("bankName");
  take("swift");
  take("paymentDescription");
  return out;
}

function tryParseInvoiceXmlTree(buffer: Buffer, mimeType: string): unknown | null {
  if (!buffer.length) return null;
  if (!isXmlMime(mimeType) && !looksLikeXml(buffer)) return null;
  let xml: string;
  try {
    xml = buffer.toString("utf8");
  } catch {
    return null;
  }
  const parser = new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
    trimValues: true,
    /** false: NrRB i inne długie ciągi cyfr muszą zostać stringiem (inaczej tracą precyzję jako number). */
    parseTagValue: false,
  });
  try {
    return parser.parse(xml);
  } catch {
    return null;
  }
}

function resolveFaRecordForPayment(parsed: unknown): Record<string, unknown> | null {
  const docRoot = asRecord(parsed);
  const fakturaNode = asRecord(docRoot?.Faktura) ?? docRoot;
  const faFromRoot =
    fakturaNode?.Fa != null
      ? asRecord(oneOrFirst(fakturaNode.Fa as Record<string, unknown> | Record<string, unknown>[] | undefined))
      : null;
  let fa = faFromRoot ?? deepFindFaBlock(parsed);
  if (!fa) fa = deepFindFaBlock(parsed);
  if (fa) return fa;
  return deepFindRecordContainingKey(parsed, "Platnosc");
}

/**
 * Pola płatności z FA XML — gdy pełny ekstrakt nie przejdzie, nadal można wyciągnąć termin i rachunek.
 */
export function tryExtractPaymentFieldsFromKsefFaXml(
  buffer: Buffer,
  mimeType: string,
): Partial<PaymentDraftFields> | null {
  const parsed = tryParseInvoiceXmlTree(buffer, mimeType);
  if (parsed == null) return null;
  const fa = resolveFaRecordForPayment(parsed);
  if (!fa) return null;
  const p = extractPaymentFromFaBlock(fa);
  return Object.keys(p).length > 0 ? p : null;
}

function normalizeMoneyStr(raw: string): string {
  let s = raw.replace(/\s/g, "");
  if (!s) return "0.00";
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > lastDot) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (lastDot > lastComma) {
    s = s.replace(/,/g, "");
  }
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n.toFixed(2) : "0.00";
}

/**
 * Próbuje zbudować draft jak z OCR/AI z treści FA XML.
 * Zwraca `null`, gdy to nie jest rozpoznawalna struktura FA.
 */
export function tryExtractDraftFromKsefFaXml(
  buffer: Buffer,
  mimeType: string,
): { draft: ExtractedInvoiceDraft; confidence: number } | null {
  const parsed = tryParseInvoiceXmlTree(buffer, mimeType);
  if (parsed == null) return null;

  const docRoot = asRecord(parsed);
  const fakturaNode = asRecord(docRoot?.Faktura) ?? docRoot;
  const faFromRoot =
    fakturaNode?.Fa != null
      ? asRecord(oneOrFirst(fakturaNode.Fa as Record<string, unknown> | Record<string, unknown>[] | undefined))
      : null;
  let fa = faFromRoot ?? deepFindFaBlock(parsed);
  if (!fa) fa = deepFindFaBlock(parsed);
  if (!fa) return null;

  let num = pickText(fa.P_2 ?? fa.p_2);
  if (!num) {
    const withP2 = deepFindRecordContainingKey(parsed, "P_2");
    if (withP2) num = pickText(withP2.P_2 ?? withP2.p_2);
  }
  if (!num) return null;

  /** Tylko P_1 = data wystawienia wg FA. P_6 to data sprzedaży/usługi — portal KSeF pokazuje „wystawienie” inaczej niż my, gdy mieszamy z P_6. */
  const issueRaw = pickText(fa.P_1) || pickText(fa.p_1);
  const issueDate = issueRaw.length >= 10 ? issueRaw.slice(0, 10) : undefined;

  let net = pickText(fa.P_13_1) || pickText(fa.P_13_2) || pickText(fa.P_13_3) || "0";
  let vat = pickText(fa.P_14_1) || pickText(fa.P_14_2) || pickText(fa.P_14_3) || "0";
  let gross = pickText(fa.P_15);
  if (!gross) {
    const n = Number.parseFloat(normalizeMoneyStr(net));
    const v = Number.parseFloat(normalizeMoneyStr(vat));
    if (Number.isFinite(n) && Number.isFinite(v)) gross = (n + v).toFixed(2);
    else gross = "0.00";
  }

  const currency = pickText(fa.KodWaluty) || "PLN";

  const pod1InsideFa = asRecord(
    oneOrFirst(fa.Podmiot1 as Record<string, unknown> | Record<string, unknown>[] | undefined),
  );
  const pod1AtFaktura =
    fakturaNode?.Podmiot1 != null
      ? asRecord(
          oneOrFirst(fakturaNode.Podmiot1 as Record<string, unknown> | Record<string, unknown>[] | undefined),
        )
      : null;
  let { contractorNip, contractorName } = extractSellerFromPodmiot1(pod1InsideFa);
  if (!contractorNip) {
    const fromRoot = extractSellerFromPodmiot1(pod1AtFaktura);
    contractorNip = contractorNip ?? fromRoot.contractorNip;
    contractorName = contractorName ?? fromRoot.contractorName;
  }

  const wiersze = fa.FaWiersz ?? fa.FaWiersze;
  const lineItems: NonNullable<ExtractedInvoiceDraft["lineItems"]> = [];
  if (wiersze != null) {
    const rows = Array.isArray(wiersze) ? wiersze : [wiersze];
    for (const w of rows) {
      const wr = asRecord(w);
      if (!wr) continue;
      const name = pickText(wr.P_7);
      if (!name) continue;
      const netVal = normalizeMoneyStr(pickText(wr.P_11) || "0");
      const rate = pickText(wr.P_12) || "23";
      const netN = Number.parseFloat(netVal);
      const rateN = Number.parseFloat(rate.replace(",", ".")) || 0;
      const grossLine = Number.isFinite(netN) ? (netN * (1 + rateN / 100)).toFixed(2) : "0.00";
      lineItems.push({
        name,
        quantity: pickText(wr.P_8B) || "1",
        unit: pickText(wr.P_8A) || undefined,
        netPrice: normalizeMoneyStr(pickText(wr.P_9A) || "0"),
        vatRate: rate,
        netValue: netVal,
        grossValue: grossLine,
      });
    }
  }

  if (
    normalizeMoneyStr(gross) === "0.00" &&
    lineItems.length > 0 &&
    normalizeMoneyStr(net) === "0.00"
  ) {
    let sumNet = 0;
    let sumGross = 0;
    for (const li of lineItems) {
      sumNet += Number.parseFloat(li.netValue);
      sumGross += Number.parseFloat(li.grossValue);
    }
    if (Number.isFinite(sumNet) && sumNet > 0) {
      net = sumNet.toFixed(2);
      gross = (Number.isFinite(sumGross) && sumGross > 0 ? sumGross : sumNet).toFixed(2);
      const g = Number.parseFloat(gross);
      const n = Number.parseFloat(net);
      vat = (g - n).toFixed(2);
    }
  }

  const paymentFields = extractPaymentFromFaBlock(fa);

  const pod2InsideFa = asRecord(
    oneOrFirst(fa.Podmiot2 as Record<string, unknown> | Record<string, unknown>[] | undefined),
  );
  const pod2AtFaktura =
    fakturaNode?.Podmiot2 != null
      ? asRecord(
          oneOrFirst(fakturaNode.Podmiot2 as Record<string, unknown> | Record<string, unknown>[] | undefined),
        )
      : null;
  let buyerParty = extractSellerFromPodmiot1(pod2InsideFa);
  if (!buyerParty.contractorNip && !buyerParty.contractorName) {
    buyerParty = extractSellerFromPodmiot1(pod2AtFaktura);
  }

  const draft: ExtractedInvoiceDraft = {
    number: num,
    issueDate,
    currency,
    netTotal: normalizeMoneyStr(net),
    vatTotal: normalizeMoneyStr(vat),
    grossTotal: normalizeMoneyStr(gross),
    contractorNip,
    contractorName,
    buyerNip: buyerParty.contractorNip,
    buyerName: buyerParty.contractorName,
    lineItems: lineItems.length > 0 ? lineItems : undefined,
    ...paymentFields,
  };

  return { draft, confidence: 0.99 };
}
