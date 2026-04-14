import type { PrismaClient, SubscriptionStatus } from "@prisma/client";
import { AppError } from "../../lib/errors.js";

export const BILLING_PLANS = {
  free: {
    code: "free",
    name: "Free",
    monthlyInvoiceLimit: 15,
  },
  pro: {
    code: "pro",
    name: "Pro",
    monthlyInvoiceLimit: null,
  },
} as const;

export type BillingPlanCode = keyof typeof BILLING_PLANS;

const CAPPED_PLAN_CODES = new Set<string>(["free", "starter"]);
const ACTIVE_SUBSCRIPTION_STATUSES = new Set<SubscriptionStatus>(["ACTIVE", "TRIALING"]);

export function getMonthlyInvoiceLimitForPlan(planCode: string | null | undefined): number | null {
  if (!planCode) return BILLING_PLANS.free.monthlyInvoiceLimit;
  if (planCode === "pro") return BILLING_PLANS.pro.monthlyInvoiceLimit;
  if (CAPPED_PLAN_CODES.has(planCode)) return BILLING_PLANS.free.monthlyInvoiceLimit;
  return BILLING_PLANS.free.monthlyInvoiceLimit;
}

export async function assertInvoiceCreationAllowed(prisma: PrismaClient, tenantId: string): Promise<void> {
  const sub = await prisma.subscription.findFirst({
    where: { tenantId },
    orderBy: { updatedAt: "desc" },
    select: { planCode: true, status: true },
  });

  if (!sub) return;
  if (!ACTIVE_SUBSCRIPTION_STATUSES.has(sub.status)) {
    throw AppError.forbidden("Subscription inactive");
  }

  const monthlyLimit = getMonthlyInvoiceLimitForPlan(sub.planCode);
  if (monthlyLimit == null) return;

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  const nextMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));

  const count = await prisma.invoice.count({
    where: {
      tenantId,
      createdAt: {
        gte: monthStart,
        lt: nextMonthStart,
      },
    },
  });

  if (count >= monthlyLimit) {
    throw AppError.forbidden(
      `Limit planu FREE został osiągnięty (${monthlyLimit} faktur w tym miesiącu). Przejdź na plan PRO, aby dodać kolejne faktury.`,
    );
  }
}
