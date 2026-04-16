import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../app.js";

const prisma = new PrismaClient();

function stripeSig(secret: string, rawBody: string): string {
  const ts = Math.floor(Date.now() / 1000).toString();
  const signedPayload = `${ts}.${rawBody}`;
  const v1 = createHmac("sha256", secret).update(signedPayload).digest("hex");
  return `t=${ts},v1=${v1}`;
}

function hmacHex(secret: string, rawBody: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

describe("billing webhooks idempotency", () => {
  let app: FastifyInstance;
  const prevStripe = process.env.STRIPE_BILLING_WEBHOOK_SECRET;
  const prevP24 = process.env.P24_BILLING_WEBHOOK_SECRET;

  beforeAll(async () => {
    process.env.STRIPE_BILLING_WEBHOOK_SECRET = "stripe-test-secret-1234567890";
    process.env.P24_BILLING_WEBHOOK_SECRET = "p24-test-secret-1234567890";
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
    if (prevStripe === undefined) delete process.env.STRIPE_BILLING_WEBHOOK_SECRET;
    else process.env.STRIPE_BILLING_WEBHOOK_SECRET = prevStripe;
    if (prevP24 === undefined) delete process.env.P24_BILLING_WEBHOOK_SECRET;
    else process.env.P24_BILLING_WEBHOOK_SECRET = prevP24;
  });

  it("deduplicates repeated Stripe event id", async () => {
    const tenant = await prisma.tenant.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
    const sub = await prisma.subscription.create({
      data: {
        tenantId: tenant.id,
        status: "TRIALING",
        provider: "STRIPE",
        planCode: "pro",
        providerCustomerId: "cus_test_dedupe",
        providerSubscriptionId: "sub_test_dedupe",
      },
    });
    const payload = {
      id: `evt_test_dedupe_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      type: "invoice.paid",
      data: {
        object: {
          id: "in_123",
          customer: "cus_test_dedupe",
          subscription: "sub_test_dedupe",
          status: "active",
          current_period_start: Math.floor(Date.now() / 1000),
          current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
          metadata: { tenantId: tenant.id },
        },
      },
    };
    const raw = JSON.stringify(payload);
    const sig = stripeSig(process.env.STRIPE_BILLING_WEBHOOK_SECRET!, raw);

    const first = await app.inject({
      method: "POST",
      url: "/api/v1/billing/webhooks/stripe",
      headers: { "content-type": "application/json", "stripe-signature": sig },
      payload: raw,
    });
    expect(first.statusCode).toBe(202);
    const firstBody = JSON.parse(first.body) as { accepted: boolean; updated: boolean };
    expect(firstBody.accepted).toBe(true);
    expect(firstBody.updated).toBe(true);

    const second = await app.inject({
      method: "POST",
      url: "/api/v1/billing/webhooks/stripe",
      headers: { "content-type": "application/json", "stripe-signature": sig },
      payload: raw,
    });
    expect(second.statusCode).toBe(202);
    const secondBody = JSON.parse(second.body) as { accepted: boolean; updated: boolean; duplicated?: boolean };
    expect(secondBody.accepted).toBe(true);
    expect(secondBody.updated).toBe(false);
    expect(secondBody.duplicated).toBe(true);

    await prisma.subscription.delete({ where: { id: sub.id } });
  });

  it("deduplicates repeated P24 event id", async () => {
    const tenant = await prisma.tenant.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
    const payload = {
      eventId: `p24_evt_dedupe_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      tenantId: tenant.id,
      status: "PAID",
      planCode: "pro",
    };
    const raw = JSON.stringify(payload);
    const sig = hmacHex(process.env.P24_BILLING_WEBHOOK_SECRET!, raw);

    const first = await app.inject({
      method: "POST",
      url: "/api/v1/billing/webhooks/p24",
      headers: { "content-type": "application/json", "x-billing-signature": sig },
      payload: raw,
    });
    expect(first.statusCode).toBe(202);

    const second = await app.inject({
      method: "POST",
      url: "/api/v1/billing/webhooks/p24",
      headers: { "content-type": "application/json", "x-billing-signature": sig },
      payload: raw,
    });
    expect(second.statusCode).toBe(202);
    const secondBody = JSON.parse(second.body) as { duplicated?: boolean; updated: boolean };
    expect(secondBody.updated).toBe(false);
    expect(secondBody.duplicated).toBe(true);
  });
});

