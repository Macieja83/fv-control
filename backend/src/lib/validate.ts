import type { ZodError, ZodTypeAny } from "zod";
import { AppError } from "./errors.js";
import type { z } from "zod";

function formatZod(err: ZodError): unknown {
  return err.flatten();
}

/** Polskie etykiety pól — komunikaty walidacji czytelne w UI (rejestracja, hasło, itd.). */
const FIELD_LABELS: Record<string, string> = {
  password: "Hasło",
  email: "E-mail",
  tenantName: "Nazwa firmy",
  tenantNip: "NIP",
  planCode: "Plan",
  token: "Token",
  currentPassword: "Obecne hasło",
  refreshToken: "Token odświeżania",
};

/**
 * Składa pierwsze błędy Zod w jeden komunikat dla człowieka (zamiast samego „Validation failed”).
 */
export function formatUserFacingZodMessage(err: ZodError, fallback = "Sprawdź poprawność danych w formularzu."): string {
  const flat = err.flatten();
  const parts: string[] = [];
  for (const fe of flat.formErrors) {
    if (fe.trim()) parts.push(fe.trim());
  }
  for (const [key, msgs] of Object.entries(flat.fieldErrors)) {
    const first = Array.isArray(msgs) ? msgs[0] : undefined;
    if (first && String(first).trim()) {
      const label = FIELD_LABELS[key] ?? key;
      parts.push(`${label}: ${String(first).trim()}`);
    }
  }
  return parts.length > 0 ? parts.join(" ") : fallback;
}

export function parseOrThrow<S extends ZodTypeAny>(
  schema: S,
  data: unknown,
  message = "Validation failed",
): z.output<S> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const flat = formatZod(r.error);
    const userMsg = formatUserFacingZodMessage(r.error, message);
    throw AppError.validation(userMsg, flat);
  }
  return r.data as z.output<S>;
}
