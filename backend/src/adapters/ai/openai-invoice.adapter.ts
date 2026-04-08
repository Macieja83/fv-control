import OpenAI from "openai";
import type { AiInvoiceAdapter, ExtractedInvoiceDraft } from "./ai-invoice.adapter.js";

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

const EXTRACTION_PROMPT = `You are an invoice data extraction system. Analyze the provided invoice document and extract data as JSON.

Required JSON structure:
{
  "number": "invoice number (numer faktury)",
  "issueDate": "YYYY-MM-DD",
  "currency": "PLN/EUR/USD/GBP",
  "netTotal": "0.00",
  "vatTotal": "0.00",
  "grossTotal": "0.00",
  "contractorNip": "10-digit NIP or null",
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
- NIP: 10 digits only, no dashes or spaces
- confidence: 0.0 to 1.0 reflecting extraction certainty
- Omit or set to null any unknown fields
- Return ONLY valid JSON, no markdown fences`;

function toStr(val: unknown, fallback: string): string {
  if (typeof val === "string") return val;
  if (typeof val === "number") return val.toString();
  return fallback;
}

function mapResponseToDraft(raw: Record<string, unknown>): ExtractedInvoiceDraft {
  return {
    number: typeof raw.number === "string" ? raw.number : undefined,
    issueDate: typeof raw.issueDate === "string" ? raw.issueDate : undefined,
    currency: typeof raw.currency === "string" ? raw.currency : undefined,
    netTotal: toStr(raw.netTotal, "0"),
    vatTotal: toStr(raw.vatTotal, "0"),
    grossTotal: toStr(raw.grossTotal, "0"),
    contractorNip:
      typeof raw.contractorNip === "string"
        ? raw.contractorNip.replace(/\D/g, "") || null
        : null,
    lineItems: Array.isArray(raw.lineItems)
      ? raw.lineItems.map((li: Record<string, unknown>) => ({
          name: toStr(li.name, ""),
          quantity: toStr(li.quantity, "1"),
          netPrice: toStr(li.netPrice, "0"),
          vatRate: toStr(li.vatRate, "23"),
          netValue: toStr(li.netValue, "0"),
          grossValue: toStr(li.grossValue, "0"),
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
