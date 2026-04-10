/**
 * Parse a KSeF FA (Faktura) XML into an ExtractedInvoiceDraft.
 *
 * FA field mapping (all FA schema versions share these element names):
 *   P_1  = data wystawienia (issue date)
 *   P_2  = numer faktury (invoice number)
 *   P_6  = data sprzedaży (sale date)
 *   P_13_1..P_13_11 = kwoty netto per stawka
 *   P_14_1..P_14_5  = kwoty VAT per stawka
 *   P_15 = kwota brutto (gross total)
 *   Platnosc/TerminPlatnosci/Termin = termin płatności (due date)
 *   Platnosc/FormaPlatnosci = forma płatności
 *   Platnosc/RachunekBankowy/NrRB = numer konta
 *   FaWiersz = pozycje faktury (line items)
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

function dateStr(v: unknown): string | undefined {
  const s = str(v);
  if (!s) return undefined;
  return s.slice(0, 10);
}

export function parseKsefXml(xml: string): { draft: ExtractedInvoiceDraft; confidence: number } {
  const doc = parser.parse(xml) as ParsedXml;

  const root = dig(doc, "Faktura") ?? dig(doc, "FA") ?? doc;
  const fa = dig(root, "Fa");
  const seller = dig(root, "Podmiot1");
  const buyer = dig(root, "Podmiot2");

  const invoiceNumber = str(dig(fa, "P_2"));
  const issueDate = dateStr(dig(fa, "P_1"));
  const saleDate = dateStr(dig(fa, "P_6"));
  const currency = str(dig(fa, "KodWaluty")) ?? "PLN";

  const dueDate = dateStr(dig(fa, "Platnosc", "TerminPlatnosci", "Termin"));
  const paymentForm = str(dig(fa, "Platnosc", "FormaPlatnosci"));
  const bankAccount = str(dig(fa, "Platnosc", "RachunekBankowy", "NrRB"));

  const sellerNip = str(dig(seller, "DaneIdentyfikacyjne", "NIP"));
  const sellerName = str(dig(seller, "DaneIdentyfikacyjne", "Nazwa"));
  const sellerAddress = str(dig(seller, "Adres", "AdresL1"));
  const sellerAddress2 = str(dig(seller, "Adres", "AdresL2"));

  const buyerNip = str(dig(buyer, "DaneIdentyfikacyjne", "NIP"));
  const buyerName = str(dig(buyer, "DaneIdentyfikacyjne", "Nazwa"));
  const buyerAddress = str(dig(buyer, "Adres", "AdresL1"));
  const buyerAddress2 = str(dig(buyer, "Adres", "AdresL2"));

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
  const lineItems: NonNullable<ExtractedInvoiceDraft["lineItems"]> = [];

  if (Array.isArray(faWiersze)) {
    for (const row of faWiersze) {
      const item = Array.isArray(row) ? row[0] : row;
      if (!item || typeof item !== "object") continue;
      const netValue = num(dig(item, "P_11")) ?? "0";
      const vatRate = num(dig(item, "P_12")) ?? "23";
      lineItems.push({
        name: str(dig(item, "P_7")) ?? "Pozycja",
        quantity: num(dig(item, "P_8B")) ?? "1",
        netPrice: num(dig(item, "P_9A")) ?? "0",
        vatRate,
        netValue,
        grossValue: num(dig(item, "P_11A"))
          ?? (parseFloat(netValue) * (1 + parseFloat(vatRate) / 100)).toFixed(2),
      });
    }
  }

  const draft: ExtractedInvoiceDraft = {
    number: invoiceNumber,
    issueDate,
    saleDate,
    dueDate,
    currency,
    netTotal,
    vatTotal,
    grossTotal,
    contractorNip: sellerNip,
    contractorName: sellerName,
    lineItems: lineItems.length > 0 ? lineItems : undefined,
    ksefMeta: {
      sellerAddress: [sellerAddress, sellerAddress2].filter(Boolean).join(", "),
      buyerNip,
      buyerName,
      buyerAddress: [buyerAddress, buyerAddress2].filter(Boolean).join(", "),
      paymentForm,
      bankAccount,
    },
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
