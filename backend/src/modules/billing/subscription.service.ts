import type { PrismaClient } from "@prisma/client";
import { loadConfig } from "../../config.js";
import { AppError } from "../../lib/errors.js";

type CheckoutProvider = "STRIPE" | "P24";

function resolveStripePriceId(planCode: string): string {
  const cfg = loadConfig();
  if (planCode === "starter") {
    if (!cfg.STRIPE_PRICE_ID_STARTER) throw AppError.unavailable("Missing STRIPE_PRICE_ID_STARTER");
    return cfg.STRIPE_PRICE_ID_STARTER;
  }
  if (planCode === "pro") {
    if (!cfg.STRIPE_PRICE_ID_PRO) throw AppError.unavailable("Missing STRIPE_PRICE_ID_PRO");
    return cfg.STRIPE_PRICE_ID_PRO;
  }
  throw AppError.validation("Unsupported planCode");
}

export async function getCurrentSubscription(prisma: PrismaClient, tenantId: string) {
  const row = await prisma.subscription.findFirst({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
  });
  return row;
}

export async function createCheckoutSession(
  prisma: PrismaClient,
  tenantId: string,
  input: { provider: CheckoutProvider; planCode: string; successUrl: string; cancelUrl: string },
) {
  if (input.provider === "P24") {
    throw AppError.unavailable("P24 checkout session endpoint is not configured yet");
  }

  const cfg = loadConfig();
  if (!cfg.STRIPE_SECRET_KEY) throw AppError.unavailable("Missing STRIPE_SECRET_KEY");

  const priceId = resolveStripePriceId(input.planCode);
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw AppError.notFound("Tenant not found");

  const current = await prisma.subscription.findFirst({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
  });

  const params = new URLSearchParams({
    mode: "subscription",
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": "1",
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    "metadata[tenantId]": tenantId,
    "subscription_data[metadata][tenantId]": tenantId,
    "client_reference_id": tenantId,
  });
  if (current?.providerCustomerId) params.set("customer", current.providerCustomerId);
  if (tenant.nip) params.set("customer_email", `${tenantId.slice(0, 8)}+${tenant.nip}@example.invalid`);

  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });
  const body = (await res.json()) as { id?: string; url?: string; customer?: string; error?: { message?: string } };
  if (!res.ok || !body.id || !body.url) {
    throw AppError.unavailable(body.error?.message ?? "Stripe checkout session failed");
  }

  if (current) {
    await prisma.subscription.update({
      where: { id: current.id },
      data: {
        provider: "STRIPE",
        planCode: input.planCode,
        status: current.status,
        providerCustomerId: typeof body.customer === "string" ? body.customer : current.providerCustomerId,
      },
    });
  } else {
    await prisma.subscription.create({
      data: {
        tenantId,
        provider: "STRIPE",
        planCode: input.planCode,
        status: "TRIALING",
        providerCustomerId: typeof body.customer === "string" ? body.customer : null,
        currentPeriodStart: new Date(),
      },
    });
  }

  return { checkoutUrl: body.url, sessionId: body.id };
}

export async function createBillingPortalSession(
  prisma: PrismaClient,
  tenantId: string,
  input: { returnUrl: string },
) {
  const cfg = loadConfig();
  if (!cfg.STRIPE_SECRET_KEY) throw AppError.unavailable("Missing STRIPE_SECRET_KEY");

  const current = await prisma.subscription.findFirst({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
  });
  if (!current?.providerCustomerId) {
    throw AppError.validation("No Stripe customer assigned for this tenant yet");
  }

  const params = new URLSearchParams({
    customer: current.providerCustomerId,
    return_url: input.returnUrl,
  });
  const res = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });
  const body = (await res.json()) as { url?: string; error?: { message?: string } };
  if (!res.ok || !body.url) {
    throw AppError.unavailable(body.error?.message ?? "Stripe billing portal failed");
  }
  return { portalUrl: body.url };
}
