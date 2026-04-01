import type { FastifyPluginAsync } from "fastify";
import { AppError } from "../lib/errors.js";
import { assertCanMutate } from "../lib/roles.js";
import * as fileService from "../modules/files/file.service.js";

const invoiceFilesRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/invoices/:id/files",
    { preHandler: [app.authenticate], schema: { tags: ["Files"], summary: "List invoice files" } },
    async (request) => {
      const { id } = request.params as { id: string };
      return fileService.listInvoiceFiles(app.prisma, request.authUser!.tenantId, id);
    },
  );

  app.post(
    "/invoices/:id/files",
    { preHandler: [app.authenticate], schema: { tags: ["Files"], summary: "Upload invoice file (multipart)" } },
    async (request, reply) => {
      assertCanMutate(request.authUser!.role);
      const { id } = request.params as { id: string };
      const data = await request.file();
      if (!data) {
        throw AppError.validation("Missing file field");
      }
      const row = await fileService.saveInvoiceFile(
        app.prisma,
        request.authUser!.tenantId,
        request.authUser!.id,
        id,
        data,
      );
      return reply.status(201).send(row);
    },
  );

  app.delete(
    "/invoices/:id/files/:fileId",
    { preHandler: [app.authenticate], schema: { tags: ["Files"], summary: "Remove invoice file" } },
    async (request, reply) => {
      assertCanMutate(request.authUser!.role);
      const { id, fileId } = request.params as { id: string; fileId: string };
      await fileService.deleteInvoiceFile(
        app.prisma,
        request.authUser!.tenantId,
        request.authUser!.id,
        id,
        fileId,
      );
      return reply.status(204).send();
    },
  );
};

export default invoiceFilesRoutes;
