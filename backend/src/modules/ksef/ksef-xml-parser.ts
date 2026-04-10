/**
 * Parse a KSeF FA (Faktura) XML into an ExtractedInvoiceDraft.
 *
 * FA XML schema versions:
 *   - http://crd.gov.pl/wzor/2023/06/29/12648/   (FA v2)
 *   - http://crd.gov.pl/wzor/2024/07/25/13149/   (FA v3)
 *
 * All versions share the same core element names under `<Fa>`.
 */

import { XMLParser } from "fast-xml-parser";
import type { ExtractedInvoiceDraft } from "../../adapters/ai/ai-invoice.adapter.js";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  isArray: (_name, _jpath, isLeafNode) => !isLeafNode,
});

type ParsedXml = Record<string, unknown>;

function dig(obj: unknown, ...keys: string[]): unknown {
  let cur = obj;
  for (const k of keys) {
    if (cur == null || typeof cur !== "object") return undefined;
    const rec = cur as Record<string, unknown>;
    if (k in rec) {
      cur = rec[k];
    } else {
      cur = undefined;
    }
    if (Array.isArray(cur) && cur.length === 1) cur = cur[0];
  }
  return cur;
}

function str(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s.length > 0 ? s : undefined;
}

function num(v: unknown): string | undefined {
  if (v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : undefined;
}

export function parseKsefXml(xml: string): { draft: ExtractedInvoiceDraft; confidence: number } {
  const doc = parser.parse(xml) as ParsedXml;

  const root = dig(doc, "Faktura") ?? dig(doc, "FA") ?? doc;
  const fa = dig(root, "Fa");
  const seller = dig(root, "Podmiot1");

  const invoiceNumber = str(dig(fa, "P_2")) ? str(dig(fa, "P_1")) : str(dig(fa, "P_1"));
  const issueDate = str(dig(fa, "P_1")) ? str(dig(fa, "P_2")) : undefined;
  const currency = str(dig(fa, "KodWaluty")) ?? "PLN";

  const sellerNip = str(dig(seller, "DaneIdentyfikacyjne", "NIP"))
    ?? str(dig(seller, "PrefiksPodatnika"))
    ?? undefined;
  const sellerName = str(dig(seller, "DaneIdentyfikacyjne", "Nazwa"))
    ?? str(dig(seller, "DaneIdentyfikacyjne", "ImiePierwsze"))
    ?? undefined;

  const netTotal = num(dig(fa, "P_13_1")) ?? num(dig(fa, "P_13_2")) ?? num(dig(fa, "P_13_3"));
  const vatTotal = num(dig(fa, "P_14_1")) ?? num(dig(fa, "P_14_2")) ?? num(dig(fa, "P_14_3"));

  let grossTotal: string | undefined;
  const p15 = dig(fa, "P_15");
  if (p15 != null) {
    grossTotal = num(p15);
  } else if (netTotal && vatTotal) {
    grossTotal = (parseFloat(netTotal) + parseFloat(vatTotal)).toFixed(2);
  }

  const faWiersze = dig(fa, "FaWiersz");
  const lineItems: ExtractedInvoiceDraft["lineItems"] = [];

  if (Array.isArray(faWiersze)) {
    for (const row of faWiersze) {
      const item = Array.isArray(row) ? row[0] : row;
      if (!item || typeof item !== "object") continue;
      lineItems.push({
        name: str(dig(item, "P_7")) ?? "Pozycja",
        quantity: num(dig(item, "P_8B")) ?? "1",
        netPrice: num(dig(item, "P_9A")) ?? "0",
        vatRate: num(dig(item, "P_12")) ?? "23",
        netValue: num(dig(item, "P_11")) ?? "0",
        grossValue: num(dig(item, "P_11A"))
          ?? (() => {
            const nv = parseFloat(num(dig(item, "P_11")) ?? "0");
            const vr = parseFloat(num(dig(item, "P_12")) ?? "23");
            return (nv * (1 + vr / 100)).toFixed(2);
          })(),
      });
    }
  }

  const draft: ExtractedInvoiceDraft = {
    number: str(dig(fa, "P_2")) ? invoiceNumber : undefined,
    issueDate: issueDate?.slice(0, 10),
    currency,
    netTotal,
    vatTotal,
    grossTotal,
    contractorNip: sellerNip,
    contractorName: sellerName,
    lineItems: lineItems.length > 0 ? lineItems : undefined,
  };

  const confidence = draft.number && draft.grossTotal ? 0.99 : 0.85;
  return { draft, confidence };
}

/**
 * Build an ExtractedInvoiceDraft from document metadata (fallback when XML parsing fails).
 */
export function draftFromKsefMetadata(meta: Record<string, unknown>): {
  draft: ExtractedInvoiceDraft;
  confidence: number;
} {
  return {
    draft: {
      number: str(meta.invoiceNumber),
      issueDate: str(meta.issueDate),
      currency: str(meta.currency) ?? "PLN",
      netTotal: num(meta.netAmount),
      vatTotal: num(meta.vatAmount),
      grossTotal: num(meta.grossAmount),
      contractorNip: str(meta.sellerNip),
      contractorName: str(meta.sellerName),
    },
    confidence: 0.95,
  };
}
