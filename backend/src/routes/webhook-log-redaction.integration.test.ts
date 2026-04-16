import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { buildFvControlSignatureHeader, canonicalWebhookPayload } from "../lib/webhook-outbound-sign.js";

describe("inbound webhook log redaction", () => {
  let app: FastifyInstance;
  const infoSpy = vi.fn();
  const prevSecret = process.env.WEBHOOK_SIGNING_SECRET;

  beforeAll(async () => {
    process.env.WEBHOOK_SIGNING_SECRET = "0123456789abcdef0123456789abcdef";
    app = await buildApp();
    app.addHook("onRequest", async (req) => {
      if (!req.url.includes("/webhooks/inbound")) return;
      const orig = req.log.info.bind(req.log) as (...args: unknown[]) => void;
      req.log.info = ((...args: unknown[]) => {
        infoSpy(...args);
        orig(...args);
      }) as typeof req.log.info;
    });
  });

  afterAll(async () => {
    await app.close();
    if (prevSecret === undefined) delete process.env.WEBHOOK_SIGNING_SECRET;
    else process.env.WEBHOOK_SIGNING_SECRET = prevSecret;
  });

  it("does not pass raw body or secrets to log.info on success", async () => {
    infoSpy.mockClear();
    const secret = loadConfig().WEBHOOK_SIGNING_SECRET!;
    const payload = { superSecretToken: "must-not-appear-in-logs-xyz", nested: { k: 1 } };
    const rawBody = canonicalWebhookPayload(payload);
    const ts = Math.floor(Date.now() / 1000).toString();
    const sig = buildFvControlSignatureHeader(secret, ts, rawBody);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks/inbound",
      headers: {
        "content-type": "application/json",
        "x-fvcontrol-signature": sig,
        "x-fvcontrol-timestamp": ts,
      },
      payload: rawBody,
    });
    expect(res.statusCode).toBe(202);

    const combined = JSON.stringify(infoSpy.mock.calls);
    expect(combined).not.toContain("must-not-appear-in-logs-xyz");
    expect(combined).not.toContain(secret);
  });
});
