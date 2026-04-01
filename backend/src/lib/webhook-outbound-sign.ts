import { createHmac } from "node:crypto";
import { stableStringify } from "./stable-json.js";

/** Canonical raw body for signing (stable key order). */
export function canonicalWebhookPayload(payload: unknown): string {
  return stableStringify(payload);
}

/**
 * HMAC-SHA256 over `${timestampSeconds}.${rawBody}` (UTF-8).
 * Header form: `X-FVControl-Signature: sha256=<hex>`.
 */
export function signFvControlWebhook(secret: string, timestampSeconds: string, rawBody: string): string {
  const msg = `${timestampSeconds}.${rawBody}`;
  return createHmac("sha256", secret).update(msg, "utf8").digest("hex");
}

export function buildFvControlSignatureHeader(secret: string, timestampSeconds: string, rawBody: string): string {
  return `sha256=${signFvControlWebhook(secret, timestampSeconds, rawBody)}`;
}
