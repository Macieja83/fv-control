import type { FastifyPluginAsync } from "fastify";
import { assertCanMutate } from "../lib/roles.js";
import { parseOrThrow } from "../lib/validate.js";
import {
  contractorCreateSchema,
  contractorUpdateSchema,
} from "../modules/contractors/contractor.schema.js";
import * as contractorService from "../modules/contractors/contractor.service.js";

const contractorsRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/contractors",
    { preHandler: [app.authenticate], schema: { tags: ["Contractors"], summary: "List contractors" } },
    async (request) => {
      const tenantId = request.authUser!.tenantId;
      return contractorService.listContractors(app.prisma, tenantId);
    },
  );

  app.post(
    "/contractors",
    {
      preHandler: [app.authenticate, app.checkIdempotency],
      schema: { tags: ["Contractors"], summary: "Create contractor" },
    },
    async (request, reply) => {
      assertCanMutate(request.authUser!.role);
      const body = parseOrThrow(contractorCreateSchema, request.body);
      const row = await contractorService.createContractor(app.prisma, request.authUser!.tenantId, body);
      return reply.status(201).send(row);
    },
  );

  app.get(
    "/contractors/:id",
    { preHandler: [app.authenticate], schema: { tags: ["Contractors"], summary: "Get contractor" } },
    async (request) => {
      return contractorService.getContractor(
        app.prisma,
        request.authUser!.tenantId,
        (request.params as { id: string }).id,
      );
    },
  );

  app.patch(
    "/contractors/:id",
    {
      preHandler: [app.authenticate, app.checkIdempotency],
      schema: { tags: ["Contractors"], summary: "Update contractor" },
    },
    async (request) => {
      assertCanMutate(request.authUser!.role);
      const { id } = request.params as { id: string };
      const body = parseOrThrow(contractorUpdateSchema, request.body);
      return contractorService.updateContractor(app.prisma, request.authUser!.tenantId, id, body);
    },
  );

  app.delete(
    "/contractors/:id",
    { preHandler: [app.authenticate], schema: { tags: ["Contractors"], summary: "Soft-delete contractor" } },
    async (request, reply) => {
      assertCanMutate(request.authUser!.role);
      const { id } = request.params as { id: string };
      await contractorService.softDeleteContractor(app.prisma, request.authUser!.tenantId, id);
      return reply.status(204).send();
    },
  );
};

export default contractorsRoutes;
