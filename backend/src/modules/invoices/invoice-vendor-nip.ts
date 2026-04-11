/** Best-effort NIP z payloadu OCR / normalizacji (np. openai-invoice.adapter). */
export function extractVendorNipFromNormalizedPayload(normalizedPayload: unknown): string | null {
  if (!normalizedPayload || typeof normalizedPayload !== "object") return null;
  const o = normalizedPayload as Record<string, unknown>;
  const raw = o.vendorNip ?? o.supplierNip;
  if (typeof raw !== "string" || !raw.trim()) return null;
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(0, 14) : null;
}
