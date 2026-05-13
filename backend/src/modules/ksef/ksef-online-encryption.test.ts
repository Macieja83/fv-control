import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import certFixture from "./__fixtures__/mf-public-key-certificates.json" assert { type: "json" };
import { KsefClient } from "./ksef-client.js";

/**
 * Regression: MF 21405 `open online session 400: 'encryption' must not be empty`
 * when `POST /sessions/online` omitted `encryption` (pre e42dd9c). Fixture = snapshot
 * of `GET /v2/security/public-key-certificates` (prod) for deterministic RSA-OAEP encrypt.
 */
describe("KSeF prepareOnlineInvoiceEncryption", () => {
  const origFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/security/public-key-certificates")) {
        return new Response(JSON.stringify(certFixture), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return origFetch(input, init);
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it("builds non-empty encryption + invoicePayload (OpenAPI OpenOnlineSessionRequest)", async () => {
    const client = new KsefClient("production", "5260250274", { kind: "token", ksefToken: "unused" });
    const enc = await client.prepareOnlineInvoiceEncryption("<Fa/>");
    expect(enc.sessionEncryption.encryptedSymmetricKey.length).toBeGreaterThan(80);
    expect(enc.sessionEncryption.initializationVector.length).toBeGreaterThan(10);
    expect(enc.sessionEncryption.publicKeyId).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(enc.invoicePayload.encryptedInvoiceContent.length).toBeGreaterThan(10);
    expect(enc.invoicePayload.offlineMode).toBe(false);

    const body = {
      formCode: { systemCode: "FA (3)", schemaVersion: "1-0E", value: "FA" },
      encryption: enc.sessionEncryption,
    };
    const json = JSON.stringify(body);
    const parsed = JSON.parse(json) as { encryption: Record<string, string> };
    expect(parsed.encryption.encryptedSymmetricKey?.length).toBeGreaterThan(0);
    expect(parsed.encryption.initializationVector?.length).toBeGreaterThan(0);
  });
});
