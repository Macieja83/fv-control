import type { PrismaClient, SubscriptionBillingKind, SubscriptionStatus } from "@prisma/client";
import { AppError } from "../../lib/errors.js";
import { PRO_PLAN_PRICE_PLN } from "./billing-constants.js";

/** Plan Free: łączna liczba faktur + umów (bez PRO). */
export const FREE_WORKSPACE_SLOT_LIMIT = 15;

/** Stabilny marker komunikatu limitu Free — uzywany w tresci bledu ORAZ do
 *  odfiltrowania nieaktualnych wpisow retry po upgrade do PRO (stale-error UX). */
export const FREE_PLAN_LIMIT_MESSAGE_MARKER = "Limit planu Free został osiągnięty";

export const BILLING_PLANS = {
  free: {
    code: "free",
    name: "Free",
    workspaceSlotLimit: FREE_WORKSPACE_SLOT_LIMIT,
  },
  pro: {
    code: "pro",
    name: "Pro",
    workspaceSlotLimit: null as number | null,
  },
} as const;

export type BillingPlanCode = keyof typeof BILLING_PLANS;

const PRO_SUBSCRIPTION_STATUSES = new Set<SubscriptionStatus>(["ACTIVE", "TRIALING", "PAST_DUE"]);

/**
 * PRO: cykliczna subskrypcja Stripe (karta) albo prepaid BLIK z ważnym currentPeriodEnd.
 * billingKind null = zachowanie jak dotąd (subskrypcja Stripe).
 */
export function subscriptionGrantsProAccess(sub: {
  planCode: string | null | undefined;
  status: SubscriptionStatus;
  billingKind: SubscriptionBillingKind | null;
  currentPeriodEnd: Date | null;
}): boolean {
  if (sub.planCode !== "pro") return false;
  if (sub.billingKind === "STRIPE_PREPAID_BLIK") {
    if (sub.status !== "ACTIVE" && sub.status !== "TRIALING") return false;
    if (!sub.currentPeriodEnd) return false;
    return sub.currentPeriodEnd.getTime() > Date.now();
  }
  return PRO_SUBSCRIPTION_STATUSES.has(sub.status);
}

export async function countWorkspaceSlots(prisma: PrismaClient, tenantId: string): Promise<number> {
  const [invoiceCount, agreementCount] = await Promise.all([
    prisma.invoice.count({ where: { tenantId } }),
    prisma.agreement.count({ where: { tenantId } }),
  ]);
  return invoiceCount + agreementCount;
}

export async function getWorkspaceUsage(prisma: PrismaClient, tenantId: string) {
  const sub = await prisma.subscription.findFirst({
    where: { tenantId },
    orderBy: { updatedAt: "desc" },
    select: { planCode: true, status: true, billingKind: true, currentPeriodEnd: true },
  });

  const used = await countWorkspaceSlots(prisma, tenantId);
  const pro = sub ? subscriptionGrantsProAccess(sub) : false;
  const limit = pro ? null : FREE_WORKSPACE_SLOT_LIMIT;

  return {
    used,
    limit,
    planCode: pro ? "pro" : "free",
    hasProEntitlement: pro,
  };
}

/**
 * Blokuje tworzenie nowej faktury (dowolna ścieżka), gdy Free ma już 15 slotów (faktury + umowy).
 * Brak wiersza subskrypcji = Free.
 */
export async function assertInvoiceCreationAllowed(prisma: PrismaClient, tenantId: string): Promise<void> {
  const sub = await prisma.subscription.findFirst({
    where: { tenantId },
    orderBy: { updatedAt: "desc" },
    select: { planCode: true, status: true, billingKind: true, currentPeriodEnd: true },
  });

  if (sub && subscriptionGrantsProAccess(sub)) return;

  const used = await countWorkspaceSlots(prisma, tenantId);
  if (used >= FREE_WORKSPACE_SLOT_LIMIT) {
    throw AppError.forbidden(
      `${FREE_PLAN_LIMIT_MESSAGE_MARKER} (${FREE_WORKSPACE_SLOT_LIMIT} dokumentów: faktury + umowy). Wykup PRO (${PRO_PLAN_PRICE_PLN} zł / mies.), aby mieć nielimitowany dostęp.`,
    );
  }
}

/** Nowa umowa = +1 slot w limicie Free. */
export async function assertAgreementCreationAllowed(prisma: PrismaClient, tenantId: string): Promise<void> {
  await assertInvoiceCreationAllowed(prisma, tenantId);
}


/** Czy komunikat pochodzi z limitu planu Free (po upgrade do PRO = nieaktualny). */
export function isFreePlanLimitMessage(msg: string | null | undefined): boolean {
  return typeof msg === "string" && msg.includes(FREE_PLAN_LIMIT_MESSAGE_MARKER);
}

/**
 * Usuwa z agregatu/preview bledow (separator " | ") segmenty limitu Free.
 * Stosowane TYLKO przy odczycie statusu dla tenanta z aktywnym PRO — wpisy
 * retry zostaly zamrozone gdy tenant byl Free; przy kolejnym sync same sie
 * wyczyszcza (PRO => ingest przejdzie). Zwraca null gdy nic nie zostaje.
 */
export function stripFreePlanLimitErrors(preview: string | null | undefined): string | null {
  if (preview == null || preview === "") return null;
  const kept = preview
    .split(" | ")
    .filter((part) => !isFreePlanLimitMessage(part));
  const cleaned = kept.join(" | ").trim();
  return cleaned.length > 0 ? cleaned : null;
}
