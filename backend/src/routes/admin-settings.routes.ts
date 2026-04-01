import type { FastifyPluginAsync } from "fastify";
import { assertCanManageIntegrations } from "../lib/roles.js";

const adminSettingsRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/admin/settings",
    { preHandler: [app.authenticate], schema: { tags: ["Admin"], summary: "Tenant settings keys (no secret values)" } },
    async (request) => {
      assertCanManageIntegrations(request.authUser!.role);
      const rows = await app.prisma.tenantSetting.findMany({
        where: { tenantId: request.authUser!.tenantId },
        select: { id: true, key: true, updatedAt: true },
      });
      return { data: rows };
    },
  );

  app.get(
    "/admin/credentials",
    { preHandler: [app.authenticate], schema: { tags: ["Admin"], summary: "Integration credentials metadata" } },
    async (request) => {
      assertCanManageIntegrations(request.authUser!.role);
      const rows = await app.prisma.integrationCredential.findMany({
        where: { tenantId: request.authUser!.tenantId },
        select: {
          id: true,
          connector: true,
          kind: true,
          label: true,
          isActive: true,
          rotatedAt: true,
          expiresAt: true,
          createdAt: true,
        },
      });
      return { data: rows };
    },
  );
};

export default adminSettingsRoutes;
