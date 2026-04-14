import type { PrismaClient, SubscriptionStatus } from "@prisma/client";
import { AppError } from "../../lib/errors.js";

/** Plan Free: łączna liczba faktur + umów (bez PRO). */
export const FREE_WORKSPACE_SLOT_LIMIT = 15;

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

export function tenantHasProEntitlement(planCode: string | null | undefined, status: SubscriptionStatus): boolean {
  if (planCode !== "pro") return false;
  return PRO_SUBSCRIPTION_STATUSES.has(status);
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
    select: { planCode: true, status: true },
  });

  const used = await countWorkspaceSlots(prisma, tenantId);
  const pro = sub ? tenantHasProEntitlement(sub.planCode, sub.status) : false;
  const limit = pro ? null : FREE_WORKSPACE_SLOT_LIMIT;

  return {
    used,
    limit,
    planCode: sub?.planCode ?? "free",
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
    select: { planCode: true, status: true },
  });

  if (sub && tenantHasProEntitlement(sub.planCode, sub.status)) return;

  const used = await countWorkspaceSlots(prisma, tenantId);
  if (used >= FREE_WORKSPACE_SLOT_LIMIT) {
    throw AppError.forbidden(
      `Limit planu Free został osiągnięty (${FREE_WORKSPACE_SLOT_LIMIT} dokumentów: faktury + umowy). Wykup PRO (99 zł / mies.), aby mieć nielimitowany dostęp.`,
    );
  }
}

/** Nowa umowa = +1 slot w limicie Free. */
export async function assertAgreementCreationAllowed(prisma: PrismaClient, tenantId: string): Promise<void> {
  await assertInvoiceCreationAllowed(prisma, tenantId);
}
