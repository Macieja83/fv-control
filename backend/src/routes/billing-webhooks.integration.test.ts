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

  it("creates one self-invoice for recurring Stripe invoice.paid using stripe invoice id", async () => {
    const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(-8);
    const selfTenant = await prisma.tenant.create({
      data: { name: `Self Invoice Tenant ${suffix}`, nip: `83${suffix}`.slice(0, 10).padEnd(10, "0") },
    });
    const customerTenant = await prisma.tenant.create({
      data: { name: `Card Customer ${suffix}`, nip: `72${suffix}`.slice(0, 10).padEnd(10, "0") },
    });
    await prisma.user.create({
      data: {
        tenantId: selfTenant.id,
        email: `self-${suffix}@example.test`,
        role: "OWNER",
        emailVerified: true,
        isActive: true,
      },
    });
    await prisma.tenantSetting.create({
      data: {
        tenantId: customerTenant.id,
        key: "billing_company_data",
        valueJson: {
          legalName: `Card Customer ${suffix} Sp. z o.o.`,
          nip: customerTenant.nip,
          address: "Testowa 1, 00-001 Warszawa",
          invoiceEmail: `billing-${suffix}@example.test`,
        },
      },
    });
    const sub = await prisma.subscription.create({
      data: {
        tenantId: customerTenant.id,
        status: "TRIALING",
        provider: "STRIPE",
        planCode: "pro",
        providerCustomerId: `cus_card_${suffix}`,
        providerSubscriptionId: `sub_card_${suffix}`,
      },
    });
    const prevSelfTenant = process.env.BILLING_SELF_INVOICE_TENANT_ID;
    process.env.BILLING_SELF_INVOICE_TENANT_ID = selfTenant.id;
    try {
      const nowSec = Math.floor(Date.now() / 1000);
      const stripeInvoiceId = `in_card_${suffix}`;
      const object = {
        id: stripeInvoiceId,
        customer: `cus_card_${suffix}`,
        subscription: `sub_card_${suffix}`,
        status: "paid",
        currency: "pln",
        amount_paid: 6700,
        status_transitions: { paid_at: nowSec },
        period_start: nowSec,
        period_end: nowSec + 30 * 24 * 60 * 60,
        metadata: { tenantId: customerTenant.id },
      };
      const firstPayload = {
        id: `evt_invoice_paid_${suffix}_1`,
        type: "invoice.paid",
        data: { object },
      };
      const firstRaw = JSON.stringify(firstPayload);
      const firstSig = stripeSig(process.env.STRIPE_BILLING_WEBHOOK_SECRET!, firstRaw);
      const first = await app.inject({
        method: "POST",
        url: "/api/v1/billing/webhooks/stripe",
        headers: { "content-type": "application/json", "stripe-signature": firstSig },
        payload: firstRaw,
      });
      expect(first.statusCode).toBe(202);

      const secondPayload = {
        id: `evt_invoice_paid_${suffix}_2`,
        type: "invoice.paid",
        data: { object },
      };
      const secondRaw = JSON.stringify(secondPayload);
      const secondSig = stripeSig(process.env.STRIPE_BILLING_WEBHOOK_SECRET!, secondRaw);
      const second = await app.inject({
        method: "POST",
        url: "/api/v1/billing/webhooks/stripe",
        headers: { "content-type": "application/json", "stripe-signature": secondSig },
        payload: secondRaw,
      });
      expect(second.statusCode).toBe(202);

      const invoices = await prisma.invoice.findMany({
        where: { tenantId: selfTenant.id, ingestionKind: "RESTA_API", sourceExternalId: stripeInvoiceId },
        include: { items: true },
      });
      expect(invoices).toHaveLength(1);
      expect(invoices[0]!.status).toBe("PAID");
      expect(invoices[0]!.ksefRequired).toBe(true);
      expect(invoices[0]!.ksefStatus).toBe("PENDING");
      expect(Number(invoices[0]!.grossTotal)).toBe(67);
      expect(invoices[0]!.items[0]!.name).toContain("karta");

      const updatedSub = await prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } });
      expect(updatedSub.billingKind).toBe("STRIPE_RECURRING");
    } finally {
      if (prevSelfTenant === undefined) delete process.env.BILLING_SELF_INVOICE_TENANT_ID;
      else process.env.BILLING_SELF_INVOICE_TENANT_ID = prevSelfTenant;
      await prisma.tenant.deleteMany({ where: { id: { in: [selfTenant.id, customerTenant.id] } } });
    }
  });
});

