import { describe, expect, it } from "vitest";
import { buildFvControlSignatureHeader, canonicalWebhookPayload, signFvControlWebhook } from "./webhook-outbound-sign.js";

describe("webhook outbound signing", () => {
  it("canonical payload is stable regardless of object key order", () => {
    const a = canonicalWebhookPayload({ z: 1, a: { y: 2, b: 3 } });
    const b = canonicalWebhookPayload({ a: { b: 3, y: 2 }, z: 1 });
    expect(a).toBe(b);
  });

  it("signature is deterministic for same timestamp and body", () => {
    const secret = "0123456789abcdef0123456789abcdef";
    const ts = "1710000000";
    const body = canonicalWebhookPayload({ invoiceId: "x", amount: 1 });
    const h1 = signFvControlWebhook(secret, ts, body);
    const h2 = signFvControlWebhook(secret, ts, body);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[a-f0-9]{64}$/);
    expect(buildFvControlSignatureHeader(secret, ts, body)).toBe(`sha256=${h1}`);
  });
});
