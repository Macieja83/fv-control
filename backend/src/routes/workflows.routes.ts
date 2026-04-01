import type { FastifyPluginAsync } from "fastify";
import { ProcessingJobStatus } from "@prisma/client";
import { z } from "zod";
import { parseOrThrow } from "../lib/validate.js";

const listQuery = z
  .object({
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
    status: z.nativeEnum(ProcessingJobStatus).optional(),
  })
  .transform((v) => ({ page: v.page ?? 1, limit: Math.min(v.limit ?? 20, 100), status: v.status }));

const workflowsRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/workflows/jobs",
    { preHandler: [app.authenticate], schema: { tags: ["Workflows"], summary: "Processing jobs queue (DB mirror)" } },
    async (request) => {
      const q = parseOrThrow(listQuery, request.query);
      const tenantId = request.authUser!.tenantId;
      const where = {
        tenantId,
        ...(q.status ? { status: q.status } : {}),
      };
      const skip = (q.page - 1) * q.limit;
      const [total, rows] = await app.prisma.$transaction([
        app.prisma.processingJob.count({ where }),
        app.prisma.processingJob.findMany({
          where,
          skip,
          take: q.limit,
          orderBy: { createdAt: "desc" },
          include: { attempts: { orderBy: { startedAt: "desc" }, take: 5 } },
        }),
      ]);
      return {
        data: rows,
        meta: { total, page: q.page, limit: q.limit, totalPages: Math.ceil(total / q.limit) },
      };
    },
  );
};

export default workflowsRoutes;
