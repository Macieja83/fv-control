import { Prisma } from "@prisma/client";
import type { PrismaClient, SubscriptionStatus } from "@prisma/client";
import { AppError } from "../../lib/errors.js";
import { PRO_PREPAID_PERIOD_DAYS } from "./billing-constants.js";

const inMemoryWebhookDedup = new Set<string>();
let canUseBillingWebhookTable: boolean | null = null;

async function detectBillingWebhookTable(prisma: PrismaClient): Promise<boolean> {
  if (canUseBillingWebhookTable != null) return canUseBillingWebhookTable;
  try {
    const rows = await prisma.$queryRaw<Array<{ exists: boolean }>>(
      Prisma.sql`SELECT to_regclass('public.billing_webhook_events') IS NOT NULL AS "exists"`,
    );
    canUseBillingWebhookTable = rows[0]?.exists === true;
  } catch {
    canUseBillingWebhookTable = false;
  }
  return canUseBillingWebhookTable;
}
function mapStripeSubscriptionStatus(raw: unknown): SubscriptionStatus | null {
  if (typeof raw !== "string") return null;
  switch (raw) {
    case "trialing":
      return "TRIALING";
    case "active":
      return "ACTIVE";
    case "past_due":
    case "unpaid":
      return "PAST_DUE";
    case "canceled":
      return "CANCELED";
    default:
      return null;
  }
}

function parseUnixSecDate(v: unknown): Date | null {
  if (typeof v === "number" && Number.isFinite(v)) return new Date(v * 1000);
  if (typeof v === "string" && /^\d+$/.test(v)) return new Date(Number(v) * 1000);
  return null;
}

async function claimWebhookEvent(
  prisma: PrismaClient,
  provider: "STRIPE" | "P24",
  eventId: string,
  payload: Record<string, unknown>,
) {
  const hasTable = await detectBillingWebhookTable(prisma);
  if (!hasTable) {
    const key = `${provider}:${eventId}`;
    if (inMemoryWebhookDedup.has(key)) return false;
    inMemoryWebhookDedup.add(key);
    return true;
  }
  try {
    const payloadJson = JSON.stringify(payload);
    const inserted = await prisma.$executeRaw(
      Prisma.sql`
        INSERT INTO "billing_webhook_events" ("provider", "eventId", "payload")
        VALUES (${provider}::"BillingWebhookProvider", ${eventId}, ${payloadJson}::jsonb)
        ON CONFLICT ("provider", "eventId") DO NOTHING
      `,
    );
    canUseBillingWebhookTable = true;
    return inserted > 0;
  } catch {
    canUseBillingWebhookTable = false;
    // Fallback dla środowisk bez najnowszej migracji (np. lokalne test DB):
    // deduplikacja tylko per-process.
    const key = `${provider}:${eventId}`;
    if (inMemoryWebhookDedup.has(key)) return false;
    inMemoryWebhookDedup.add(key);
    return true;
  }
}

export async function handleStripeWebhookEvent(prisma: PrismaClient, payload: Record<string, unknown>, eventId: string) {
  const eventType = typeof payload.type === "string" ? payload.type : "unknown";
  if (eventType === "checkout.session.completed") {
    return handleStripeCheckoutSessionCompleted(prisma, payload, eventId);
  }

  const claimed = await claimWebhookEvent(prisma, "STRIPE", eventId, payload);
  if (!claimed) {
    return { accepted: true, duplicated: true as const, updated: false };
  }
  const dataObj =
    payload.data && typeof payload.data === "object"
      ? ((payload.data as { object?: unknown }).object as Record<string, unknown> | undefined)
      : undefined;
  if (!dataObj) return { accepted: true, eventType, updated: false, reason: "missing_data_object" as const };

  const providerCustomerIdRaw =
    typeof dataObj.customer === "string" && dataObj.customer.trim() ? dataObj.customer.trim() : null;
  const providerSubscriptionIdRaw =
    typeof dataObj.id === "string" && dataObj.id.trim() ? dataObj.id.trim() : null;
  const invoiceSub =
    typeof dataObj.subscription === "string" && dataObj.subscription.trim() ? dataObj.subscription.trim() : null;
  const providerSubscriptionId =
    eventType.startsWith("customer.subscription.") ? providerSubscriptionIdRaw : invoiceSub;
  const providerCustomerId = providerCustomerIdRaw;
  const metadata =
    dataObj.metadata && typeof dataObj.metadata === "object"
      ? (dataObj.metadata as Record<string, unknown>)
      : null;
  const tenantId =
    metadata && typeof metadata.tenantId === "string" && metadata.tenantId.trim()
      ? metadata.tenantId.trim()
      : null;

  const status =
    eventType === "invoice.payment_failed"
      ? "PAST_DUE"
      : eventType === "invoice.paid"
        ? "ACTIVE"
        : eventType === "customer.subscription.deleted"
          ? "CANCELED"
          : mapStripeSubscriptionStatus(dataObj.status);
  if (!status) return { accepted: true, eventType, updated: false, reason: "unknown_status" as const };

  let row =
    providerSubscriptionId == null
      ? null
      : await prisma.subscription.findFirst({
          where: { provider: "STRIPE", providerSubscriptionId },
        });

  if (!row && providerCustomerId) {
    row = await prisma.subscription.findFirst({
      where: { provider: "STRIPE", providerCustomerId },
    });
  }

  if (!row && tenantId) {
    row = await prisma.subscription.findFirst({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
    });
  }

  if (!row) return { accepted: true, eventType, updated: false, reason: "subscription_not_found" as const };

  const currentPeriodEnd = parseUnixSecDate(dataObj.current_period_end);
  const currentPeriodStart = parseUnixSecDate(dataObj.current_period_start);
  const trialEndsAt = parseUnixSecDate(dataObj.trial_end);

  await prisma.subscription.update({
    where: { id: row.id },
    data: {
      status,
      provider: "STRIPE",
      providerCustomerId: providerCustomerId ?? row.providerCustomerId,
      providerSubscriptionId: providerSubscriptionId ?? row.providerSubscriptionId,
      ...(currentPeriodStart ? { currentPeriodStart } : {}),
      ...(currentPeriodEnd ? { currentPeriodEnd } : {}),
      ...(trialEndsAt ? { trialEndsAt } : {}),
    },
  });

  return { accepted: true, eventType, updated: true };
}

/** Jednorazowa płatność BLIK (Checkout mode=payment) — przedłużenie PRO o PRO_PREPAID_PERIOD_DAYS dni. */
export async function handleStripeCheckoutSessionCompleted(
  prisma: PrismaClient,
  payload: Record<string, unknown>,
  eventId: string,
) {
  const claimed = await claimWebhookEvent(prisma, "STRIPE", eventId, payload);
  if (!claimed) {
    return { accepted: true, duplicated: true as const, updated: false };
  }

  const session =
    payload.data && typeof payload.data === "object"
      ? ((payload.data as { object?: unknown }).object as Record<string, unknown> | undefined)
      : undefined;
  if (!session) {
    return { accepted: true, eventType: "checkout.session.completed", updated: false, reason: "missing_session" as const };
  }

  const mode = session.mode;
  const paymentStatus = session.payment_status;
  const meta =
    session.metadata && typeof session.metadata === "object" ? (session.metadata as Record<string, unknown>) : null;
  const tenantId = meta && typeof meta.tenantId === "string" ? meta.tenantId.trim() : "";
  const purpose = meta && typeof meta.purpose === "string" ? meta.purpose.trim() : "";

  if (mode !== "payment" || paymentStatus !== "paid" || purpose !== "pro_prepaid_month" || !tenantId) {
    return {
      accepted: true,
      eventType: "checkout.session.completed",
      updated: false,
      reason: "not_pro_prepaid" as const,
    };
  }

  const customerId = typeof session.customer === "string" && session.customer ? session.customer : null;

  const existing = await prisma.subscription.findFirst({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
  });

  const now = new Date();
  const base =
    existing?.currentPeriodEnd && existing.currentPeriodEnd.getTime() > now.getTime()
      ? existing.currentPeriodEnd
      : now;
  const newEnd = new Date(base.getTime());
  newEnd.setUTCDate(newEnd.getUTCDate() + PRO_PREPAID_PERIOD_DAYS);

  if (existing) {
    await prisma.subscription.update({
      where: { id: existing.id },
      data: {
        planCode: "pro",
        status: "ACTIVE",
        provider: "STRIPE",
        billingKind: "STRIPE_PREPAID_BLIK",
        currentPeriodStart: now,
        currentPeriodEnd: newEnd,
        providerSubscriptionId: null,
        trialEndsAt: null,
        ...(customerId ? { providerCustomerId: customerId } : {}),
      },
    });
  } else {
    await prisma.subscription.create({
      data: {
        tenantId,
        planCode: "pro",
        status: "ACTIVE",
        provider: "STRIPE",
        billingKind: "STRIPE_PREPAID_BLIK",
        currentPeriodStart: now,
        currentPeriodEnd: newEnd,
        providerCustomerId: customerId,
        providerSubscriptionId: null,
      },
    });
  }

  return { accepted: true, eventType: "checkout.session.completed", updated: true };
}

function mapP24Status(raw: unknown): SubscriptionStatus | null {
  if (typeof raw !== "string") return null;
  switch (raw.toUpperCase()) {
    case "PAID":
    case "SUCCESS":
    case "COMPLETED":
      return "ACTIVE";
    case "FAILED":
    case "DECLINED":
      return "PAST_DUE";
    case "CANCELED":
      return "CANCELED";
    default:
      return null;
  }
}

export async function handleP24SubscriptionWebhook(prisma: PrismaClient, payload: Record<string, unknown>, eventId: string) {
  const claimed = await claimWebhookEvent(prisma, "P24", eventId, payload);
  if (!claimed) {
    return { accepted: true, duplicated: true as const, updated: false };
  }
  const tenantId = typeof payload.tenantId === "string" ? payload.tenantId.trim() : "";
  if (!tenantId) throw AppError.validation("Missing tenantId");
  const status = mapP24Status(payload.status);
  if (!status) throw AppError.validation("Unsupported P24 subscription status");
  const planCode =
    typeof payload.planCode === "string" && payload.planCode.trim() ? payload.planCode.trim() : undefined;

  const existing = await prisma.subscription.findFirst({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
  });

  if (!existing) {
    await prisma.subscription.create({
      data: {
        tenantId,
        status,
        provider: "MANUAL",
        planCode: planCode ?? "starter",
        currentPeriodStart: new Date(),
      },
    });
    return { accepted: true, updated: true, created: true };
  }

  await prisma.subscription.update({
    where: { id: existing.id },
    data: {
      status,
      ...(planCode ? { planCode } : {}),
      ...(status === "ACTIVE" ? { currentPeriodStart: new Date() } : {}),
    },
  });

  return { accepted: true, updated: true, created: false };
}
