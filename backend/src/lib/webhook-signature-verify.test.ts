import { describe, expect, it } from "vitest";
import { buildFvControlSignatureHeader, canonicalWebhookPayload } from "./webhook-outbound-sign.js";
import { verifyFvControlWebhookSignature } from "./webhook-signature-verify.js";

describe("verifyFvControlWebhookSignature", () => {
  const secret = "0123456789abcdef0123456789abcdef";
  const body = canonicalWebhookPayload({ ok: true });
  const ts = "1710000000";
  const sig = buildFvControlSignatureHeader(secret, ts, body);

  it("accepts valid signature within skew", () => {
    const r = verifyFvControlWebhookSignature({
      secret,
      rawBody: body,
      signatureHeader: sig,
      timestampHeader: ts,
      maxSkewSeconds: 300,
      nowSeconds: 1710000000,
    });
    expect(r).toEqual({ ok: true });
  });

  it("rejects stale timestamp", () => {
    const r = verifyFvControlWebhookSignature({
      secret,
      rawBody: body,
      signatureHeader: sig,
      timestampHeader: ts,
      maxSkewSeconds: 60,
      nowSeconds: 1710001000,
    });
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ ok: false, reason: "skew" });
  });

  it("rejects tampered body", () => {
    const r = verifyFvControlWebhookSignature({
      secret,
      rawBody: `${body.slice(0, -1)} }`,
      signatureHeader: sig,
      timestampHeader: ts,
      maxSkewSeconds: 300,
      nowSeconds: 1710000000,
    });
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ ok: false, reason: "mismatch" });
  });
});
