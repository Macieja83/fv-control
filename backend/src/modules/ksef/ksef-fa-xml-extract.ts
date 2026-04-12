/**
 * Strukturalny odczyt polskiej faktury FA (KSeF XML) bez OpenAI — używany w pipeline
 * dla dokumentów z `sourceType: KSEF` / `intakeSourceType: KSEF_API`.
 */
import { XMLParser } from "fast-xml-parser";
import type { ExtractedInvoiceDraft } from "../../adapters/ai/ai-invoice.adapter.js";
import { polishNipDigits10 } from "../contractors/contractor-resolve.js";

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
  if (el && typeof el === "object" && "#text" in (el as object)) {
    return String((el as { "#text": unknown })["#text"]).trim();
  }
  return "";
}

function oneOrFirst<T>(v: T | T[] | undefined): T | undefined {
  if (v == null) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

/** Szuka bloku z polami faktury (P_2, P_15 / P_13_*). */
function deepFindFaBlock(node: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > 40) return null;
  const o = asRecord(node);
  if (!o) return null;
  const hasP2 = o.P_2 != null || o.p_2 != null;
  const hasAmounts = o.P_15 != null || o.P_13_1 != null || o.P_13_2 != null || o.P_13_3 != null;
  if (hasP2 && hasAmounts) return o;

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
    parseTagValue: true,
  });

  let parsed: unknown;
  try {
    parsed = parser.parse(xml);
  } catch {
    return null;
  }

  const fa = deepFindFaBlock(parsed);
  if (!fa) return null;

  const num = pickText(fa.P_2 ?? fa.p_2);
  if (!num) return null;

  const issueRaw = pickText(fa.P_1) || pickText(fa.P_6);
  const issueDate = issueRaw.length >= 10 ? issueRaw.slice(0, 10) : undefined;

  const net = pickText(fa.P_13_1) || pickText(fa.P_13_2) || pickText(fa.P_13_3) || "0";
  const vat = pickText(fa.P_14_1) || pickText(fa.P_14_2) || pickText(fa.P_14_3) || "0";
  let gross = pickText(fa.P_15);
  if (!gross) {
    const n = Number.parseFloat(normalizeMoneyStr(net));
    const v = Number.parseFloat(normalizeMoneyStr(vat));
    if (Number.isFinite(n) && Number.isFinite(v)) gross = (n + v).toFixed(2);
    else gross = "0.00";
  }

  const currency = pickText(fa.KodWaluty) || "PLN";

  let contractorNip: string | null = null;
  let contractorName: string | null = null;
  const pod1 = asRecord(oneOrFirst(fa.Podmiot1 as unknown[]));
  if (pod1) {
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
        netPrice: normalizeMoneyStr(pickText(wr.P_9A) || "0"),
        vatRate: rate,
        netValue: netVal,
        grossValue: grossLine,
      });
    }
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
    lineItems: lineItems.length > 0 ? lineItems : undefined,
  };

  return { draft, confidence: 0.99 };
}
