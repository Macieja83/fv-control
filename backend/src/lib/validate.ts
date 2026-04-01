import type { ZodError, ZodTypeAny } from "zod";
import { AppError } from "./errors.js";
import type { z } from "zod";

function formatZod(err: ZodError): unknown {
  return err.flatten();
}

export function parseOrThrow<S extends ZodTypeAny>(
  schema: S,
  data: unknown,
  message = "Validation failed",
): z.output<S> {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw AppError.validation(message, formatZod(r.error));
  }
  return r.data as z.output<S>;
}
