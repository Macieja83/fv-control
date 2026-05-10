import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { AppError } from "../lib/errors.js";
import { parseOrThrow } from "../lib/validate.js";
import * as documentService from "../modules/documents/document.service.js";

const listQuery = z
  .object({
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
  })
  .transform((v) => ({ page: v.page ?? 1, limit: Math.min(v.limit ?? 20, 100) }));

const documentsRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/documents",
    { preHandler: [app.authenticate], schema: { tags: ["Documents"], summary: "List documents" } },
    async (request) => {
      const q = parseOrThrow(listQuery, request.query);
      return documentService.listDocuments(app.prisma, request.authUser!.tenantId, q.page, q.limit);
    },
  );

  app.get(
    "/documents/:id",
    { preHandler: [app.authenticate], schema: { tags: ["Documents"], summary: "Document detail" } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const doc = await documentService.getDocument(app.prisma, request.authUser!.tenantId, id);
      if (!doc) throw AppError.notFound("Nie znaleziono dokumentu.");
      return reply.send(doc);
    },
  );
};

export default documentsRoutes;
