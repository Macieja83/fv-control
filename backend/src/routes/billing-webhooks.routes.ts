import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { loadConfig } from "../config.js";
import { AppError } from "../lib/errors.js";
import { handleP24SubscriptionWebhook, handleStripeWebhookEvent } from "../modules/billing/billing-webhook.service.js";

function verifyHmacSha256(secret: string, body: string, signatureHex: string): boolean {
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHex);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function verifyStripeSignatureHeader(secret: string, rawBody: string, header: string): boolean {
  // Format: t=timestamp,v1=signature[,v1=...]
  const parts = header
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  let timestamp: string | null = null;
  const sigs: string[] = [];
  for (const p of parts) {
    const idx = p.indexOf("=");
    if (idx <= 0) continue;
    const key = p.slice(0, idx);
    const value = p.slice(idx + 1);
    if (key === "t") timestamp = value;
    if (key === "v1") sigs.push(value);
  }
  if (!timestamp || sigs.length === 0) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  const tsNum = Number(timestamp);
  if (!Number.isFinite(tsNum)) return false;
  // 5 min tolerance like Stripe default
  if (Math.abs(nowSec - tsNum) > 300) return false;
  const signedPayload = `${timestamp}.${rawBody}`;
  const expected = createHmac("sha256", secret).update(signedPayload).digest("hex");
  return sigs.some((sig) => {
    const a = Buffer.from(expected);
    const b = Buffer.from(sig);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  });
}

const billingWebhooksRoutes: FastifyPluginAsync = async (app) => {
  await app.register(async (scope) => {
    scope.addContentTypeParser(
      "application/json",
      { parseAs: "buffer" },
      (req, body, done) => {
        try {
          const raw = body.toString("utf8");
          (req as FastifyRequest).rawBody = raw;
          const json: unknown = raw.length === 0 ? {} : JSON.parse(raw);
          done(null, json);
        } catch (e) {
          done(e as Error);
        }
      },
    );

    scope.post(
      "/billing/webhooks/stripe",
      { schema: { tags: ["Billing"], summary: "Stripe billing webhook" } },
      async (request, reply) => {
        const cfg = loadConfig();
        if (!cfg.STRIPE_BILLING_WEBHOOK_SECRET) throw AppError.unavailable("Stripe webhook secret is not configured");
        const sig =
          (request.headers["stripe-signature"] as string | undefined)?.trim() ??
          (request.headers["x-billing-signature"] as string | undefined)?.trim();
        if (!sig) return reply.status(401).send({ error: { code: "UNAUTHORIZED", message: "Missing signature" } });
        const raw = request.rawBody ?? "";
        const ok = sig.includes("t=")
          ? verifyStripeSignatureHeader(cfg.STRIPE_BILLING_WEBHOOK_SECRET, raw, sig)
          : verifyHmacSha256(cfg.STRIPE_BILLING_WEBHOOK_SECRET, raw, sig);
        if (!ok) {
          return reply.status(401).send({ error: { code: "UNAUTHORIZED", message: "Bad signature" } });
        }
        const payload = (request.body ?? {}) as Record<string, unknown>;
        const eventId =
          typeof payload.id === "string" && payload.id.trim().length > 0
            ? payload.id.trim()
            : `rawsha:${createHash("sha256").update(raw).digest("hex")}`;
        const result = await handleStripeWebhookEvent(app.prisma, payload, eventId);
        return reply.status(202).send(result);
      },
    );

    scope.post(
      "/billing/webhooks/p24",
      { schema: { tags: ["Billing"], summary: "Przelewy24 subscription webhook" } },
      async (request, reply) => {
        const cfg = loadConfig();
        if (!cfg.P24_BILLING_WEBHOOK_SECRET) throw AppError.unavailable("P24 webhook secret is not configured");
        const sig = (request.headers["x-billing-signature"] as string | undefined)?.trim();
        if (!sig) return reply.status(401).send({ error: { code: "UNAUTHORIZED", message: "Missing signature" } });
        const raw = request.rawBody ?? "";
        if (!verifyHmacSha256(cfg.P24_BILLING_WEBHOOK_SECRET, raw, sig)) {
          return reply.status(401).send({ error: { code: "UNAUTHORIZED", message: "Bad signature" } });
        }
        const payload = (request.body ?? {}) as Record<string, unknown>;
        const eventId =
          (typeof payload.eventId === "string" && payload.eventId.trim().length > 0
            ? payload.eventId.trim()
            : null) ??
          (typeof payload.orderId === "string" && payload.orderId.trim().length > 0 ? payload.orderId.trim() : null) ??
          (typeof payload.sessionId === "string" && payload.sessionId.trim().length > 0 ? payload.sessionId.trim() : null) ??
          `rawsha:${createHash("sha256").update(raw).digest("hex")}`;
        const result = await handleP24SubscriptionWebhook(app.prisma, payload, eventId);
        return reply.status(202).send(result);
      },
    );
  });
};

export default billingWebhooksRoutes;
