import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { assertCanManageIntegrations } from "../lib/roles.js";
import { parseOrThrow } from "../lib/validate.js";
import { createBillingPortalSession, createCheckoutSession, getCurrentSubscription } from "../modules/billing/subscription.service.js";

const checkoutSchema = z.object({
  provider: z.enum(["STRIPE", "P24"]).default("STRIPE"),
  planCode: z.enum(["starter", "pro"]),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
});

const portalSchema = z.object({
  returnUrl: z.string().url(),
});

const billingRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/billing/subscription",
    { preHandler: [app.authenticate], schema: { tags: ["Billing"], summary: "Current tenant subscription" } },
    async (request) => {
      const row = await getCurrentSubscription(app.prisma, request.authUser!.tenantId);
      return { data: row };
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
};

export default billingRoutes;
