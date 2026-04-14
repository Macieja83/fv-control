import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { AppError } from "../lib/errors.js";
import { parseOrThrow } from "../lib/validate.js";
import {
  issueTenantImpersonationAccessToken,
  listTenantsForSuperAdmin,
} from "../modules/auth/auth.service.js";

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
      if (!request.authUser?.isSuperAdmin) throw AppError.forbidden("Super admin required");
      const q = parseOrThrow(listQuerySchema, request.query ?? {});
      return { data: await listTenantsForSuperAdmin(app.prisma, q.limit) };
    },
  );

  app.post(
    "/platform-admin/impersonate",
    { preHandler: [app.authenticate], schema: { tags: ["PlatformAdmin"], summary: "Issue tenant impersonation token" } },
    async (request) => {
      if (!request.authUser?.isSuperAdmin) throw AppError.forbidden("Super admin required");
      const body = parseOrThrow(impersonateSchema, request.body);
      return issueTenantImpersonationAccessToken(app.prisma, request.authUser.id, body.tenantId);
    },
  );
};

export default platformAdminRoutes;
