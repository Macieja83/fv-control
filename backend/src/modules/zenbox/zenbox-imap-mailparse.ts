import { simpleParser } from "mailparser";
import { isInvoiceCandidateAttachment, normalizeAttachmentFilename } from "./zenbox-imap.parser.js";

export type ParsedMailAttachment = {
  index: number;
  fileName: string;
  mimeType: string;
  content: Buffer;
  isInvoiceCandidate: boolean;
};

export type ParsedMailForSync = {
  messageIdHeader?: string;
  subject?: string;
  fromAddress?: string;
  receivedAt: Date;
  rawHeaders: Record<string, string>;
  attachments: ParsedMailAttachment[];
};

function headersMapToRecord(headers: unknown): Record<string, string> {
  if (!headers || typeof headers !== "object") return {};
  const h = headers as Map<string, unknown>;
  if (typeof h.forEach !== "function") return {};
  const out: Record<string, string> = {};
  h.forEach((value, key) => {
    out[String(key)] = Array.isArray(value) ? value.map(String).join(", ") : String(value);
  });
  return out;
}

export async function parseImapRawSource(rawSource: Buffer): Promise<ParsedMailForSync> {
  const parsed = await simpleParser(rawSource);
  const receivedAt = parsed.date ?? new Date();
  const fromAddr = parsed.from?.value?.[0]?.address ?? parsed.from?.text;

  const attachments: ParsedMailAttachment[] = [];
  let idx = 0;
  for (const a of parsed.attachments ?? []) {
    const content = a.content;
    if (!Buffer.isBuffer(content) || content.length === 0) continue;
    const fileName = normalizeAttachmentFilename(a.filename, idx);
    const mimeType = (a.contentType ?? "application/octet-stream").split(";")[0]?.trim() ?? "application/octet-stream";
    attachments.push({
      index: idx,
      fileName,
      mimeType,
      content,
      isInvoiceCandidate: isInvoiceCandidateAttachment(fileName, mimeType),
    });
    idx += 1;
  }

  const rawHeaders = headersMapToRecord(parsed.headers);

  return {
    messageIdHeader: parsed.messageId,
    subject: parsed.subject ?? undefined,
    fromAddress: fromAddr,
    receivedAt,
    rawHeaders,
    attachments,
  };
}
