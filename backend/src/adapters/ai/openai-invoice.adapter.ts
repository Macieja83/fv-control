import OpenAI from "openai";
import { normalizeDueDateStringToYmd } from "../../modules/invoices/invoice-dates.js";
import type { AiInvoiceAdapter, ExtractedInvoiceDraft } from "./ai-invoice.adapter.js";

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

const EXTRACTION_PROMPT = `You are an invoice data extraction system. Analyze the provided invoice document and extract data as JSON.

Polish invoices (FV) usually label the issuer as "Sprzedawca" and the buyer as "Nabywca". You MUST extract the SELLER only:
- contractorName = full company/person name of Sprzedawca (the party issuing the invoice)
- contractorNip = NIP / numer identyfikacji podatkowej of Sprzedawca only (never the buyer's NIP)

Required JSON structure:
{
  "number": "invoice number (numer faktury)",
  "issueDate": "YYYY-MM-DD",
  "dueDate": "YYYY-MM-DD payment due date (termin płatności / data zapłaty) or null",
  "currency": "PLN/EUR/USD/GBP",
  "netTotal": "0.00",
  "vatTotal": "0.00",
  "grossTotal": "0.00",
  "contractorName": "legal name of seller (Sprzedawca) or null",
  "contractorNip": "exactly 10 digits, no dashes/spaces, or null",
  "paymentForm": "payment method in plain language (e.g. Przelew, Gotówka) or null",
  "bankAccount": "seller bank account / IBAN digits only, no spaces, or null",
  "paymentDescription": "transfer title / opis płatności or null",
  "lineItems": [
    {
      "name": "item description",
      "quantity": "1.00",
      "netPrice": "0.00",
      "vatRate": "23",
      "netValue": "0.00",
      "grossValue": "0.00"
    }
  ],
  "confidence": 0.95
}

Rules:
- Monetary values: strings with exactly 2 decimal places (e.g. "123.45")
- NIP: Polish tax ID is 10 digits. If shown as XXX-XXX-XX-XX or with spaces, output contractorNip as 10 digits only
- If multiple NIPs appear, use only Sprzedawca's NIP
- contractorName: include full name as on document (firma, spółka, imię i nazwisko)
- confidence: 0.0 to 1.0 reflecting extraction certainty
- dueDate: Polish invoices often show \"Termin płatności\", \"Płatność do\", \"Zapłata do\" as DD.MM.RRRR — you MUST output dueDate as YYYY-MM-DD (convert day-first dates)
- dueDate / paymentForm / bankAccount / paymentDescription: only if clearly visible on the document
- Omit or set to null any unknown fields
- Return ONLY valid JSON, no markdown fences`;

function toStr(val: unknown, fallback: string): string {
  if (typeof val === "string") return val;
  if (typeof val === "number") return val.toString();
  return fallback;
}

/**
 * Normalize monetary string from any locale format to "12345.67".
 * Handles: "10.434,50" (PL), "10,434.50" (US), "10 434,50", "10434.50".
 */
function normalizeMoneyStr(raw: string): string {
  let s = raw.replace(/\s/g, "");
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

function toMoneyStr(val: unknown, fallback: string): string {
  if (typeof val === "number") return val.toFixed(2);
  if (typeof val === "string") return normalizeMoneyStr(val);
  return fallback;
}

const NIP_CANDIDATE_KEYS = [
  "contractorNip",
  "sellerNip",
  "vendorNip",
  "nipSprzedawcy",
  "nip_sprzedawcy",
  "sprzedawcaNip",
  "nip",
] as const;

const NAME_CANDIDATE_KEYS = [
  "contractorName",
  "supplierName",
  "sellerName",
  "vendorName",
  "sprzedawca",
  "companyName",
  "seller",
] as const;

/** Polish NIP: 10 digits after stripping separators (dashes, spaces, "NIP"). */
function normalizeNipFromRaw(val: unknown): string | null {
  if (typeof val !== "string") return null;
  const digits = val.replace(/\D/g, "");
  if (digits.length === 10) return digits;
  return null;
}

function pickNipFromObject(raw: Record<string, unknown>): string | null {
  for (const key of NIP_CANDIDATE_KEYS) {
    const n = normalizeNipFromRaw(raw[key]);
    if (n) return n;
  }
  return null;
}

function pickContractorName(raw: Record<string, unknown>): string | null {
  for (const key of NAME_CANDIDATE_KEYS) {
    const v = raw[key];
    if (typeof v === "string") {
      const t = v.trim();
      if (t.length > 1) return t;
    }
  }
  return null;
}

function trimOrUndef(s: unknown): string | undefined {
  if (typeof s !== "string") return undefined;
  const t = s.trim();
  return t.length > 0 ? t : undefined;
}

const DUE_DATE_KEYS = [
  "dueDate",
  "paymentDueDate",
  "payment_due_date",
  "terminPlatnosci",
  "termin_platnosci",
  "paymentDue",
] as const;

function pickDueDateRawString(raw: Record<string, unknown>): string | undefined {
  for (const key of DUE_DATE_KEYS) {
    const v = raw[key];
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return undefined;
}

function resolveDueDateYmd(raw: Record<string, unknown>): string | undefined {
  const direct = pickDueDateRawString(raw);
  if (direct) {
    const ymd = normalizeDueDateStringToYmd(direct);
    if (ymd) return ymd;
  }
  const payDesc = trimOrUndef(raw.paymentDescription);
  if (payDesc) return normalizeDueDateStringToYmd(payDesc);
  return undefined;
}

function mapResponseToDraft(raw: Record<string, unknown>): ExtractedInvoiceDraft {
  const nip = pickNipFromObject(raw);
  const dueDate = resolveDueDateYmd(raw);
  const bankRaw = trimOrUndef(raw.bankAccount);
  const bankAccount = bankRaw ? bankRaw.replace(/\s/g, "") : undefined;
  return {
    number: typeof raw.number === "string" ? raw.number : undefined,
    issueDate: typeof raw.issueDate === "string" ? raw.issueDate : undefined,
    dueDate,
    currency: typeof raw.currency === "string" ? raw.currency : undefined,
    netTotal: toMoneyStr(raw.netTotal, "0"),
    vatTotal: toMoneyStr(raw.vatTotal, "0"),
    grossTotal: toMoneyStr(raw.grossTotal, "0"),
    contractorName: pickContractorName(raw),
    contractorNip: nip,
    paymentForm: trimOrUndef(raw.paymentForm) ?? null,
    bankAccount: bankAccount ?? null,
    paymentDescription: trimOrUndef(raw.paymentDescription) ?? null,
    lineItems: Array.isArray(raw.lineItems)
      ? raw.lineItems.map((li: Record<string, unknown>) => ({
          name: toStr(li.name, ""),
          quantity: toMoneyStr(li.quantity, "1"),
          netPrice: toMoneyStr(li.netPrice, "0"),
          vatRate: toMoneyStr(li.vatRate, "23"),
          netValue: toMoneyStr(li.netValue, "0"),
          grossValue: toMoneyStr(li.grossValue, "0"),
        }))
      : undefined,
  };
}

function buildContentParts(meta: { mimeType: string; buffer: Buffer }): unknown[] {
  const base64 = meta.buffer.toString("base64");
  const dataUrl = `data:${meta.mimeType};base64,${base64}`;

  const parts: unknown[] = [];

  if (meta.mimeType.startsWith("image/")) {
    parts.push({
      type: "image_url",
      image_url: { url: dataUrl, detail: "high" },
    });
  } else {
    parts.push({
      type: "file",
      file: { file_data: dataUrl, filename: "invoice.pdf" },
    });
  }

  parts.push({ type: "text", text: EXTRACTION_PROMPT });
  return parts;
}

export function createOpenAiAdapter(apiKey: string, model: string): AiInvoiceAdapter {
  const openai = new OpenAI({ apiKey });

  return {
    async extractInvoiceData(meta) {
      if (!meta.buffer || meta.buffer.length === 0) {
        return { draft: {}, confidence: 0 };
      }
      if (meta.buffer.length > MAX_FILE_SIZE_BYTES) {
        console.warn(`[openai] Document too large (${meta.buffer.length} bytes), skipping`);
        return { draft: {}, confidence: 0 };
      }

      const contentParts = buildContentParts({
        mimeType: meta.mimeType,
        buffer: meta.buffer,
      });

      try {
        const response = await openai.chat.completions.create({
          model,
          messages: [
            {
              role: "user" as const,
              content: contentParts as OpenAI.ChatCompletionContentPart[],
            },
          ],
          response_format: { type: "json_object" },
          temperature: 0.1,
          max_tokens: 4096,
        });

        const text = response.choices[0]?.message?.content;
        if (!text) return { draft: {}, confidence: 0 };

        const parsed = JSON.parse(text) as Record<string, unknown>;
        const draft = mapResponseToDraft(parsed);
        const confidence =
          typeof parsed.confidence === "number" ? parsed.confidence : 0.85;

        return { draft, confidence };
      } catch (err) {
        if (err instanceof OpenAI.RateLimitError) throw err;
        if (
          err instanceof OpenAI.APIError &&
          err.status !== undefined &&
          err.status >= 500
        ) {
          throw err;
        }
        console.error(
          "[openai] extraction failed:",
          err instanceof Error ? err.message : err,
        );
        return { draft: {}, confidence: 0 };
      }
    },

    async classifyInvoice() {
      return { label: "PURCHASE", confidence: 0.61 };
    },

    async anomalyCheck() {
      return { score: 0.12, flags: [] };
    },
  };
}
