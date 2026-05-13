import type { PrismaClient } from "@prisma/client";
import { loadConfig } from "../../config.js";
import { AppError } from "../../lib/errors.js";
import { PRO_PLAN_PRICE_PLN, PRO_PREPAID_PERIOD_DAYS } from "./billing-constants.js";

/** PRO w Stripe: MVP uses prepaid BLIK/P24 until card recurring dogfood invoicing is implemented. */

type CheckoutProvider = "STRIPE" | "P24";
type CheckoutPaymentMethod = "CARD" | "BLIK" | "P24" | "GOOGLE_PAY" | "APPLE_PAY";

/** Mapowanie z naszego paymentMethod na Stripe API `payment_method_types[]` value. */
function stripePaymentMethodType(method: "blik"): string {
  return method; // Stripe używa lower-case identyfikatorów — `blik`, `p24`. Mapowanie 1:1 dla MVP.
}

export async function getCurrentSubscription(prisma: PrismaClient, tenantId: string) {
  const row = await prisma.subscription.findFirst({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
  });
  return row;
}

/**
 * Generyczny Stripe Checkout dla prepaid 30-day (jednorazowa płatność 67 zł, dostęp PRO 30 dni).
 * Wspiera BLIK i P24 — oba są single-payment methods w Stripe (nie wspierają recurring billing).
 * Subscription.billingKind = STRIPE_PREPAID_BLIK (legacy enum value, semantyka rozszerzona na P24).
 * Konkretna metoda (BLIK vs P24) trafia do Stripe metadata[paymentMethod] do śledzenia w webhook + UI.
 */
async function createStripePrepaid30dSession(
  prisma: PrismaClient,
  tenantId: string,
  method: "blik",
  input: { successUrl: string; cancelUrl: string },
) {
  const cfg = loadConfig();
  if (!cfg.STRIPE_SECRET_KEY) throw AppError.unavailable("Płatności są tymczasowo niedostępne (brak konfiguracji Stripe). Spróbuj za chwilę.");

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw AppError.notFound("Nie znaleziono firmy (tenant).");

  const current = await prisma.subscription.findFirst({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
  });

  const unitAmount = PRO_PLAN_PRICE_PLN * 100;
  const methodLabel = "BLIK";
  const params = new URLSearchParams({
    mode: "payment",
    locale: "pl",
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    "metadata[tenantId]": tenantId,
    "metadata[purpose]": "pro_prepaid_month",
    "metadata[paymentMethod]": method,
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "pln",
    "line_items[0][price_data][unit_amount]": String(unitAmount),
    "line_items[0][price_data][product_data][name]": `FV Control PRO (${PRO_PREPAID_PERIOD_DAYS} dni, ${methodLabel})`,
  });
  params.append("payment_method_types[]", stripePaymentMethodType(method));
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
    throw AppError.unavailable(body.error?.message ?? `Stripe ${methodLabel} checkout session failed`);
  }

  return { checkoutUrl: body.url, sessionId: body.id };
}

export async function createCheckoutSession(
  prisma: PrismaClient,
  tenantId: string,
  input: {
    provider: CheckoutProvider;
    planCode: string;
    successUrl: string;
    cancelUrl: string;
    paymentMethod?: CheckoutPaymentMethod;
  },
) {
  if (input.planCode !== "pro") {
    throw AppError.validation("Sesja Checkout jest dostępna tylko dla planu PRO.");
  }
  // Provider "P24" historycznie zarezerwowane dla bezpośredniej integracji P24.pl (osobny gateway).
  // Decyzja 2026-05-10 (research/sales-ready-p24.md): używamy P24 jako Stripe payment method (Ścieżka A
  // z research) — jeden gateway, koszt 2.4%+1.50zł, MVP-friendly. Bezpośrednia integracja P24 dopiero
  // przy >100 klientów/mc gdy 1% prowizji ma znaczenie.
  if (input.provider === "P24") {
    throw AppError.unavailable(
      "P24 wybierany teraz jako Stripe payment method (provider=STRIPE, paymentMethod=P24). Bezpośrednia integracja P24.pl nie jest skonfigurowana.",
    );
  }

  if (input.paymentMethod === "BLIK") {
    return createStripePrepaid30dSession(prisma, tenantId, "blik", {
      successUrl: input.successUrl,
      cancelUrl: input.cancelUrl,
    });
  }

  if (input.paymentMethod === "P24") {
    // 2026-05-10: P24 jako Stripe payment method (Ścieżka A z research/sales-ready-p24.md).
    // Stripe nie wspiera recurring billing dla P24 → traktujemy jak prepaid 30-day (analogicznie BLIK).
    throw AppError.unavailable("Przelewy24 jest wylaczone w Sprint 1. Wybierz BLIK - daje dostep PRO na 30 dni.");
  }

  throw AppError.unavailable(
    "Płatność kartą jest tymczasowo wyłączona w MVP. Wybierz BLIK — daje dostęp PRO na 30 dni i jest zgodny z aktualnym flow faktury VAT.",
  );
}

export async function switchToFreePlan(prisma: PrismaClient, tenantId: string) {
  const current = await prisma.subscription.findFirst({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
  });

  if (current) {
    return prisma.subscription.update({
      where: { id: current.id },
      data: {
        provider: "MANUAL",
        planCode: "free",
        status: "ACTIVE",
        billingKind: null,
        trialEndsAt: null,
        currentPeriodStart: new Date(),
        currentPeriodEnd: null,
        providerSubscriptionId: null,
      },
    });
  }

  return prisma.subscription.create({
    data: {
      tenantId,
      provider: "MANUAL",
      planCode: "free",
      status: "ACTIVE",
      currentPeriodStart: new Date(),
      trialEndsAt: null,
    },
  });
}

export async function createBillingPortalSession(
  prisma: PrismaClient,
  tenantId: string,
  input: { returnUrl: string },
) {
  const cfg = loadConfig();
  if (!cfg.STRIPE_SECRET_KEY) throw AppError.unavailable("Płatności są tymczasowo niedostępne (brak konfiguracji Stripe). Spróbuj za chwilę.");

  const current = await prisma.subscription.findFirst({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
  });
  if (!current?.providerCustomerId) {
    throw AppError.validation("Ta firma nie ma jeszcze przypisanego klienta Stripe — najpierw przejdź przez Checkout.");
  }
  if (current.billingKind === "STRIPE_PREPAID_BLIK") {
    throw AppError.validation(
      "Portal Stripe dotyczy subskrypcji z kartą. Przy PRO prepaid przedłuż dostęp płatnością BLIK.",
    );
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
