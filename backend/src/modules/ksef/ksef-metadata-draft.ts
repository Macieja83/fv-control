import type { ExtractedInvoiceDraft } from "../../adapters/ai/ai-invoice.adapter.js";
import { polishNipDigits10 } from "../contractors/contractor-resolve.js";

function toFiniteNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number.parseFloat(v.replace(/\s/g, "").replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Draft z metadanych zapisanych przy syncu KSeF (`ksefMetadataPayload` na dokumencie).
 * Gdy parser FA XML zawiedzie lub brak OpenAI — nadal wypełniamy fakturę danymi z API MF.
 */
export function draftFromKsefDocumentMetadata(
  meta: Record<string, unknown> | null | undefined,
): ExtractedInvoiceDraft | null {
  if (!meta) return null;
  const num = typeof meta.invoiceNumber === "string" ? meta.invoiceNumber.trim() : "";
  if (!num) return null;

  const issueRaw = typeof meta.issueDate === "string" ? meta.issueDate.trim() : "";
  const issueDate = issueRaw.length >= 10 ? issueRaw.slice(0, 10) : issueRaw || undefined;

  const nip10 = polishNipDigits10(typeof meta.sellerNip === "string" ? meta.sellerNip : null);
  const sellerName = typeof meta.sellerName === "string" ? meta.sellerName.trim() : "";
  const contractorName = sellerName.length > 0 ? sellerName : null;

  const currency =
    typeof meta.currency === "string" && meta.currency.trim() ? meta.currency.trim() : "PLN";

  let net = toFiniteNumber(meta.netAmount);
  let vat = toFiniteNumber(meta.vatAmount);
  let gross = toFiniteNumber(meta.grossAmount);

  if (gross == null && net != null && vat != null) gross = net + vat;
  if (net == null && gross != null && vat != null) net = gross - vat;
  if (vat == null && gross != null && net != null) vat = gross - net;

  const nz = net ?? 0;
  const vz = vat ?? 0;
  const gz = gross ?? (nz + vz);

  return {
    number: num,
    issueDate,
    currency,
    netTotal: nz.toFixed(2),
    vatTotal: vz.toFixed(2),
    grossTotal: gz.toFixed(2),
    contractorNip: nip10,
    contractorName,
  };
}
