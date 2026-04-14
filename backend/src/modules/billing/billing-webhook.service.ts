import type { PrismaClient, SubscriptionStatus } from "@prisma/client";
import { AppError } from "../../lib/errors.js";
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

export async function handleStripeWebhookEvent(prisma: PrismaClient, payload: Record<string, unknown>) {
  const eventType = typeof payload.type === "string" ? payload.type : "unknown";
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

export async function handleP24SubscriptionWebhook(prisma: PrismaClient, payload: Record<string, unknown>) {
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
