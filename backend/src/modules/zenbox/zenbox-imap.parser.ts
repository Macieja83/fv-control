const INVOICE_MIME = new Set([
  "application/pdf",
  "text/xml",
  "application/xml",
  "application/xhtml+xml",
  "image/jpeg",
  "image/png",
]);

/**
 * Heuristic: MIME allow-list + loose filename hint (FV, invoice, faktura).
 * Many MTAs label PDF/XML/images as application/octet-stream — accept only with a matching extension.
 */
export function isInvoiceCandidateAttachment(filename: string, mimeType: string): boolean {
  const mt = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  const base = filename.toLowerCase();
  const hasInvoiceExtension = /\.(pdf|xml|jpg|jpeg|png)$/i.test(base);
  const hasInvoiceFilenameHint = /(faktura|fv|invoice|fa[_-]?\d)/i.test(base);

  if (INVOICE_MIME.has(mt)) {
    if (hasInvoiceExtension) return true;
    if (hasInvoiceFilenameHint) return true;
    return mt === "application/pdf" || mt === "text/xml" || mt === "application/xml";
  }

  // Do not use filename-keyword-only here — avoids e.g. "invoice_setup.exe" with octet-stream.
  if (mt === "application/octet-stream" || mt === "binary/octet-stream") {
    return hasInvoiceExtension;
  }

  return false;
}

export function normalizeAttachmentFilename(raw: string | undefined, index: number): string {
  const s = (raw ?? "").trim() || `attachment-${index}`;
  return s.replace(/[/\\]/g, "_").slice(0, 255);
}

export function stableExternalMessageId(messageIdHeader: string | undefined, uidValidityStr: string, uid: bigint): string {
  const mid = (messageIdHeader ?? "").trim();
  if (mid.length > 0) return mid.slice(0, 512);
  return `imap:${uidValidityStr}:${uid.toString()}`;
}

export function shouldResetCursorOnUidValidityChange(
  stored: string | null | undefined,
  current: string | null | undefined,
): boolean {
  if (!current) return false;
  if (!stored) return false;
  return stored !== current;
}
