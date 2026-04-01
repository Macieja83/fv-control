import { createHmac, timingSafeEqual } from "node:crypto";

export type FvControlSignatureVerifyResult =
  | { ok: true }
  | { ok: false; reason: "missing_secret" | "bad_header" | "skew" | "mismatch" };

function parseSignatureHeader(raw: string | undefined): string | null {
  if (!raw || typeof raw !== "string") return null;
  const m = raw.match(/^sha256=([a-f0-9]{64})$/i);
  return m ? m[1]!.toLowerCase() : null;
}

function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Verify `X-FVControl-Signature` / `X-FVControl-Timestamp` for inbound HTTP payloads.
 * `rawBody` must be the exact bytes the sender signed (UTF-8 string of canonical JSON).
 */
export function verifyFvControlWebhookSignature(opts: {
  secret: string;
  rawBody: string;
  signatureHeader: string | undefined;
  timestampHeader: string | undefined;
  maxSkewSeconds: number;
  nowSeconds?: number;
}): FvControlSignatureVerifyResult {
  const { secret, rawBody, signatureHeader, timestampHeader, maxSkewSeconds } = opts;
  if (!secret) {
    return { ok: false, reason: "missing_secret" };
  }
  const sigHex = parseSignatureHeader(signatureHeader);
  if (!sigHex || !timestampHeader || !/^\d+$/.test(timestampHeader)) {
    return { ok: false, reason: "bad_header" };
  }
  const ts = Number(timestampHeader);
  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Number.isNaN(ts) || Math.abs(now - ts) > maxSkewSeconds) {
    return { ok: false, reason: "skew" };
  }
  const expected = createHmac("sha256", secret).update(`${timestampHeader}.${rawBody}`, "utf8").digest("hex");
  if (!safeEqualHex(expected, sigHex)) {
    return { ok: false, reason: "mismatch" };
  }
  return { ok: true };
}
