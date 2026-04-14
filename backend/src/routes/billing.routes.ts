import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { loadConfig } from "../config.js";
import { AppError } from "../lib/errors.js";
import { assertCanManageIntegrations } from "../lib/roles.js";
import { parseOrThrow } from "../lib/validate.js";
import {
  createBillingPortalSession,
  createCheckoutSession,
  getCurrentSubscription,
  switchToFreePlan,
} from "../modules/billing/subscription.service.js";
import { getWorkspaceUsage } from "../modules/billing/subscription-plans.js";

const checkoutSchema = z.object({
  provider: z.enum(["STRIPE", "P24"]).default("STRIPE"),
  planCode: z.enum(["free", "pro"]),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
  paymentMethod: z.enum(["CARD", "GOOGLE_PAY", "APPLE_PAY"]).optional(),
});

const portalSchema = z.object({
  returnUrl: z.string().url(),
});

const switchPlanSchema = z.object({
  planCode: z.enum(["free"]),
});

const billingRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/billing/stripe-public",
    {
      preHandler: [app.authenticate],
      schema: { tags: ["Billing"], summary: "Stripe mode for subscription checkout only (no secrets)" },
    },
    async () => {
      const cfg = loadConfig();
      const sk = cfg.STRIPE_SECRET_KEY ?? "";
      const mode: "live" | "test" | "unset" = sk.startsWith("sk_live")
        ? "live"
        : sk.startsWith("sk_test")
          ? "test"
          : "unset";
      return {
        data: {
          mode,
          /** Płatności za faktury nie idą przez Stripe — tylko subskrypcja PRO. */
          subscriptionCheckoutUsesTestData: mode === "test",
        },
      };
    },
  );

  app.get(
    "/billing/subscription",
    { preHandler: [app.authenticate], schema: { tags: ["Billing"], summary: "Current tenant subscription" } },
    async (request) => {
      const tenantId = request.authUser!.tenantId;
      const row = await getCurrentSubscription(app.prisma, tenantId);
      const workspace = await getWorkspaceUsage(app.prisma, tenantId);
      return { data: { subscription: row, workspace } };
    },
  );

  app.post(
    "/billing/subscription/checkout",
    {
      preHandler: [app.authenticate, app.checkIdempotency],
      schema: { tags: ["Billing"], summary: "Create checkout session for subscription" },
    },
    async (request) => {
      assertCanManageIntegrations(request.authUser!.role);
      const body = parseOrThrow(checkoutSchema, request.body);
      return createCheckoutSession(app.prisma, request.authUser!.tenantId, body);
    },
  );

  app.post(
    "/billing/subscription/portal",
    {
      preHandler: [app.authenticate, app.checkIdempotency],
      schema: { tags: ["Billing"], summary: "Create Stripe billing portal session" },
    },
    async (request) => {
      assertCanManageIntegrations(request.authUser!.role);
      const body = parseOrThrow(portalSchema, request.body);
      return createBillingPortalSession(app.prisma, request.authUser!.tenantId, body);
    },
  );

  app.post(
    "/billing/subscription/switch-plan",
    {
      preHandler: [app.authenticate, app.checkIdempotency],
      schema: { tags: ["Billing"], summary: "Switch subscription to free plan" },
    },
    async (request) => {
      assertCanManageIntegrations(request.authUser!.role);
      const body = parseOrThrow(switchPlanSchema, request.body);
      if (body.planCode !== "free") {
        throw AppError.validation("Unsupported plan switch");
      }
      return { data: await switchToFreePlan(app.prisma, request.authUser!.tenantId) };
    },
  );
};

export default billingRoutes;
