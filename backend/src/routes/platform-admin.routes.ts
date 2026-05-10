import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { AppError } from "../lib/errors.js";
import { parseOrThrow } from "../lib/validate.js";
import {
  archiveTenantByPlatformAdmin,
  issueTenantImpersonationAccessToken,
  listTenantsForSuperAdmin,
  setTenantManualProSubscription,
  setTenantUsersActiveStateByPlatformAdmin,
  unarchiveTenantByPlatformAdmin,
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

const tenantParamSchema = z.object({
  tenantId: z.string().uuid(),
});

const platformAdminRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/platform-admin/tenants",
    { preHandler: [app.authenticate], schema: { tags: ["PlatformAdmin"], summary: "List SaaS tenants" } },
    async (request) => {
      if (!request.authUser?.isPlatformAdmin) throw AppError.forbidden("Wymagane uprawnienia administratora platformy.");
      const q = parseOrThrow(listQuerySchema, request.query ?? {});
      return { data: await listTenantsForSuperAdmin(app.prisma, q.limit) };
    },
  );

  app.post(
    "/platform-admin/tenants/:tenantId/subscription/manual-pro",
    { preHandler: [app.authenticate], schema: { tags: ["PlatformAdmin"], summary: "Set tenant subscription to MANUAL PRO" } },
    async (request, reply) => {
      if (!request.authUser?.isPlatformAdmin) throw AppError.forbidden("Wymagane uprawnienia administratora platformy.");
      const p = parseOrThrow(tenantParamSchema, request.params);
      await setTenantManualProSubscription(app.prisma, request.authUser.id, p.tenantId);
      return reply.status(204).send();
    },
  );

  app.post(
    "/platform-admin/tenants/:tenantId/archive",
    { preHandler: [app.authenticate], schema: { tags: ["PlatformAdmin"], summary: "Archive tenant" } },
    async (request, reply) => {
      if (!request.authUser?.isPlatformAdmin) throw AppError.forbidden("Wymagane uprawnienia administratora platformy.");
      const p = parseOrThrow(tenantParamSchema, request.params);
      await archiveTenantByPlatformAdmin(app.prisma, request.authUser.id, p.tenantId);
      return reply.status(204).send();
    },
  );

  app.post(
    "/platform-admin/tenants/:tenantId/unarchive",
    { preHandler: [app.authenticate], schema: { tags: ["PlatformAdmin"], summary: "Unarchive tenant" } },
    async (request, reply) => {
      if (!request.authUser?.isPlatformAdmin) throw AppError.forbidden("Wymagane uprawnienia administratora platformy.");
      const p = parseOrThrow(tenantParamSchema, request.params);
      await unarchiveTenantByPlatformAdmin(app.prisma, request.authUser.id, p.tenantId);
      return reply.status(204).send();
    },
  );

  app.post(
    "/platform-admin/tenants/:tenantId/deactivate",
    { preHandler: [app.authenticate], schema: { tags: ["PlatformAdmin"], summary: "Deactivate all tenant users" } },
    async (request, reply) => {
      if (!request.authUser?.isPlatformAdmin) throw AppError.forbidden("Wymagane uprawnienia administratora platformy.");
      const p = parseOrThrow(tenantParamSchema, request.params);
      await setTenantUsersActiveStateByPlatformAdmin(app.prisma, request.authUser.id, p.tenantId, false);
      return reply.status(204).send();
    },
  );

  app.post(
    "/platform-admin/tenants/:tenantId/activate",
    { preHandler: [app.authenticate], schema: { tags: ["PlatformAdmin"], summary: "Activate all tenant users" } },
    async (request, reply) => {
      if (!request.authUser?.isPlatformAdmin) throw AppError.forbidden("Wymagane uprawnienia administratora platformy.");
      const p = parseOrThrow(tenantParamSchema, request.params);
      await setTenantUsersActiveStateByPlatformAdmin(app.prisma, request.authUser.id, p.tenantId, true);
      return reply.status(204).send();
    },
  );

  app.get(
    "/platform-admin/ksef-overview",
    {
      preHandler: [app.authenticate],
      schema: { tags: ["PlatformAdmin"], summary: "KSeF status per tenant (no secrets)" },
    },
    async (request) => {
      if (!request.authUser?.isPlatformAdmin) throw AppError.forbidden("Wymagane uprawnienia administratora platformy.");
      const q = parseOrThrow(listQuerySchema, request.query ?? {});
      return { data: await listKsefOverviewForPlatformAdmin(app.prisma, q.limit) };
    },
  );

  app.post(
    "/platform-admin/impersonate",
    { preHandler: [app.authenticate], schema: { tags: ["PlatformAdmin"], summary: "Issue tenant impersonation token" } },
    async (request) => {
      if (!request.authUser?.isPlatformAdmin) throw AppError.forbidden("Wymagane uprawnienia administratora platformy.");
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
      if (!request.authUser?.isPlatformAdmin) throw AppError.forbidden("Wymagane uprawnienia administratora platformy.");
      return { data: await getConnectorsPlatformSummary(app.prisma) };
    },
  );
};

export default platformAdminRoutes;
