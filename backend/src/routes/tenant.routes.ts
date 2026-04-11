import type { FastifyPluginAsync } from "fastify";
import { assertCanManageIntegrations, assertCanMutate } from "../lib/roles.js";
import { parseOrThrow } from "../lib/validate.js";
import {
  portalIntegrationsPatchSchema,
  tenantUpdateSchema,
} from "../modules/tenant/tenant.schema.js";
import * as tenantService from "../modules/tenant/tenant.service.js";

const tenantRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/tenant",
    { preHandler: [app.authenticate], schema: { tags: ["Tenant"], summary: "Company profile + portal state" } },
    async (request) => {
      return tenantService.getTenantProfile(app.prisma, request.authUser!.tenantId);
    },
  );

  app.patch(
    "/tenant",
    {
      preHandler: [app.authenticate, app.checkIdempotency],
      schema: { tags: ["Tenant"], summary: "Update company profile" },
    },
    async (request) => {
      assertCanMutate(request.authUser!.role);
      const body = parseOrThrow(tenantUpdateSchema, request.body);
      const row = await tenantService.updateTenantProfile(app.prisma, request.authUser!.tenantId, body);
      await app.prisma.auditLog.create({
        data: {
          tenantId: request.authUser!.tenantId,
          actorId: request.authUser!.id,
          action: "TENANT_PROFILE_UPDATED",
          entityType: "TENANT",
          entityId: row.id,
          metadata: { name: row.name, nip: row.nip } as object,
        },
      });
      return row;
    },
  );

  app.get(
    "/tenant/integrations",
    { preHandler: [app.authenticate], schema: { tags: ["Tenant"], summary: "Portal integration flags" } },
    async (request) => {
      return tenantService.getPortalIntegrations(app.prisma, request.authUser!.tenantId);
    },
  );

  app.patch(
    "/tenant/integrations",
    {
      preHandler: [app.authenticate, app.checkIdempotency],
      schema: { tags: ["Tenant"], summary: "Update bank / KSeF self-service flags" },
    },
    async (request) => {
      assertCanManageIntegrations(request.authUser!.role);
      const body = parseOrThrow(portalIntegrationsPatchSchema, request.body);
      return tenantService.patchPortalIntegrations(
        app.prisma,
        request.authUser!.tenantId,
        request.authUser!.id,
        body,
      );
    },
  );
};

export default tenantRoutes;
