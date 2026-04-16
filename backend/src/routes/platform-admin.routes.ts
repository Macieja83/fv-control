import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { AppError } from "../lib/errors.js";
import { parseOrThrow } from "../lib/validate.js";
import {
  issueTenantImpersonationAccessToken,
  listTenantsForSuperAdmin,
} from "../modules/auth/auth.service.js";
import {
  getConnectorsPlatformSummary,
} from "../modules/platform-admin/platform-admin-aggregate.service.js";
import { listKsefOverviewForPlatformAdmin } from "../modules/ksef/ksef-platform-admin.service.js";

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

const impersonateSchema = z.object({
  tenantId: z.string().uuid(),
});

const platformAdminRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/platform-admin/tenants",
    { preHandler: [app.authenticate], schema: { tags: ["PlatformAdmin"], summary: "List SaaS tenants" } },
    async (request) => {
      if (!request.authUser?.isPlatformAdmin) throw AppError.forbidden("Platform admin required");
      const q = parseOrThrow(listQuerySchema, request.query ?? {});
      return { data: await listTenantsForSuperAdmin(app.prisma, q.limit) };
    },
  );

  app.get(
    "/platform-admin/ksef-overview",
    {
      preHandler: [app.authenticate],
      schema: { tags: ["PlatformAdmin"], summary: "KSeF status per tenant (no secrets)" },
    },
    async (request) => {
      if (!request.authUser?.isPlatformAdmin) throw AppError.forbidden("Platform admin required");
      const q = parseOrThrow(listQuerySchema, request.query ?? {});
      return { data: await listKsefOverviewForPlatformAdmin(app.prisma, q.limit) };
    },
  );

  app.post(
    "/platform-admin/impersonate",
    { preHandler: [app.authenticate], schema: { tags: ["PlatformAdmin"], summary: "Issue tenant impersonation token" } },
    async (request) => {
      if (!request.authUser?.isPlatformAdmin) throw AppError.forbidden("Platform admin required");
      const body = parseOrThrow(impersonateSchema, request.body);
      return issueTenantImpersonationAccessToken(app.prisma, request.authUser.id, body.tenantId);
    },
  );

  app.get(
    "/platform-admin/connectors-summary",
    {
      preHandler: [app.authenticate],
      schema: { tags: ["PlatformAdmin"], summary: "Ingestion + integration connectors per tenant" },
    },
    async (request) => {
      if (!request.authUser?.isPlatformAdmin) throw AppError.forbidden("Platform admin required");
      return { data: await getConnectorsPlatformSummary(app.prisma) };
    },
  );
};

export default platformAdminRoutes;
