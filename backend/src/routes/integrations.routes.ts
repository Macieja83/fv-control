import type { FastifyPluginAsync } from "fastify";
import { assertCanManageIntegrations } from "../lib/roles.js";
import { parseOrThrow } from "../lib/validate.js";
import { posTestConnectionSchema } from "../modules/integrations/pos.schema.js";
import * as posService from "../modules/integrations/pos.service.js";

const integrationsRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/integrations/pos/status",
    { preHandler: [app.authenticate], schema: { tags: ["Integrations"], summary: "POS integration status" } },
    async (request) => {
      return posService.getPosStatus(app.prisma, request.authUser!.tenantId);
    },
  );

  app.post(
    "/integrations/pos/test-connection",
    { preHandler: [app.authenticate], schema: { tags: ["Integrations"], summary: "Test POS connectivity" } },
    async (request) => {
      assertCanManageIntegrations(request.authUser!.role);
      const body = parseOrThrow(posTestConnectionSchema, request.body ?? {});
      return posService.testPosConnection(app.prisma, request.authUser!.tenantId, body);
    },
  );

  app.post(
    "/integrations/pos/sync-contractors",
    { preHandler: [app.authenticate], schema: { tags: ["Integrations"], summary: "Sync contractors from POS (stub)" } },
    async (request) => {
      assertCanManageIntegrations(request.authUser!.role);
      return posService.syncPosContractors(app.prisma, request.authUser!.tenantId);
    },
  );
};

export default integrationsRoutes;
