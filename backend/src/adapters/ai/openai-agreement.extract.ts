import OpenAI from "openai";
import { loadConfig } from "../../config.js";

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

const CONTRACT_PROMPT = `You extract structured data from a Polish business CONTRACT / AGREEMENT (umowa, kontrakt, aneks).
Identify parties (Strony umowy), subject (przedmiot), dates, and counterpart (druga strona względem naszej firmy — często "Wykonawca" / "Dostawca" / druga strona).

Return ONLY valid JSON (no markdown):
{
  "title": "short title of the contract or null",
  "subject": "brief subject matter / przedmiot umowy or null",
  "counterpartyName": "full legal name of the other party (not our client if labeled as Zamawiający) or null",
  "counterpartyNip": "10-digit NIP of the other party without spaces/dashes, or null",
  "signedAt": "YYYY-MM-DD or null",
  "validUntil": "YYYY-MM-DD end date / data zakończenia or null",
  "confidence": 0.0-1.0
}

Rules:
- If the document is not a contract, still return best-effort fields and low confidence.
- NIP must be exactly 10 digits when present.
- Dates strictly YYYY-MM-DD or null.`;

function buildParts(mimeType: string, buffer: Buffer): OpenAI.ChatCompletionContentPart[] {
  const base64 = buffer.toString("base64");
  const dataUrl = `data:${mimeType};base64,${base64}`;
  const parts: OpenAI.ChatCompletionContentPart[] = [];
  if (mimeType.startsWith("image/")) {
    parts.push({ type: "image_url", image_url: { url: dataUrl, detail: "high" } });
  } else {
    parts.push({ type: "file", file: { file_data: dataUrl, filename: "agreement.pdf" } });
  }
  parts.push({ type: "text", text: CONTRACT_PROMPT });
  return parts;
}

export type ExtractedAgreementFields = {
  title: string | null;
  subject: string | null;
  counterpartyName: string | null;
  counterpartyNip: string | null;
  signedAt: string | null;
  validUntil: string | null;
  confidence: number;
};

function pickStr(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
}

function pickNip(v: unknown): string | null {
  const s = pickStr(v);
  if (!s) return null;
  const d = s.replace(/\D/g, "");
  return d.length === 10 ? d : null;
}

export async function extractAgreementWithOpenAI(
  buffer: Buffer,
  mimeType: string,
): Promise<{ fields: ExtractedAgreementFields; raw: Record<string, unknown> }> {
  const cfg = loadConfig();
  const apiKey = cfg.OPENAI_API_KEY;
  if (!apiKey || buffer.length === 0) {
    return {
      fields: {
        title: null,
        subject: null,
        counterpartyName: null,
        counterpartyNip: null,
        signedAt: null,
        validUntil: null,
        confidence: 0,
      },
      raw: {},
    };
  }
  if (buffer.length > MAX_FILE_SIZE_BYTES) {
    return {
      fields: {
        title: null,
        subject: null,
        counterpartyName: null,
        counterpartyNip: null,
        signedAt: null,
        validUntil: null,
        confidence: 0,
      },
      raw: { error: "file_too_large" },
    };
  }

  const openai = new OpenAI({ apiKey });
  const parts = buildParts(mimeType, buffer);
  const response = await openai.chat.completions.create({
    model: cfg.OPENAI_MODEL,
    messages: [{ role: "user", content: parts }],
    response_format: { type: "json_object" },
    temperature: 0.15,
    max_tokens: 2048,
  });
  const text = response.choices[0]?.message?.content;
  if (!text) {
    return {
      fields: {
        title: null,
        subject: null,
        counterpartyName: null,
        counterpartyNip: null,
        signedAt: null,
        validUntil: null,
        confidence: 0,
      },
      raw: {},
    };
  }
  const parsed = JSON.parse(text) as Record<string, unknown>;
  const conf = typeof parsed.confidence === "number" ? parsed.confidence : 0.75;
  return {
    fields: {
      title: pickStr(parsed.title),
      subject: pickStr(parsed.subject),
      counterpartyName: pickStr(parsed.counterpartyName),
      counterpartyNip: pickNip(parsed.counterpartyNip),
      signedAt: pickStr(parsed.signedAt),
      validUntil: pickStr(parsed.validUntil),
      confidence: conf,
    },
    raw: parsed,
  };
}
