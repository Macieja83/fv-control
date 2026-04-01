import type { FastifyPluginAsync } from "fastify";
import { DuplicateResolution } from "@prisma/client";
import { z } from "zod";
import { assertCanMutate } from "../lib/roles.js";
import { parseOrThrow } from "../lib/validate.js";
import * as duplicatesService from "../modules/deduplication/duplicates.service.js";

const listQuery = z
  .object({
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
  })
  .transform((v) => ({ page: v.page ?? 1, limit: Math.min(v.limit ?? 20, 100) }));

const resolveBody = z.object({
  resolution: z.enum([DuplicateResolution.MERGED, DuplicateResolution.IGNORED, DuplicateResolution.FALSE_POSITIVE]),
});

const duplicatesRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/duplicates",
    { preHandler: [app.authenticate], schema: { tags: ["Duplicates"], summary: "List duplicate pairs" } },
    async (request) => {
      const q = parseOrThrow(listQuery, request.query);
      return duplicatesService.listDuplicates(
        app.prisma,
        request.authUser!.tenantId,
        q.page,
        q.limit,
      );
    },
  );

  app.patch(
    "/duplicates/:id/resolve",
    {
      preHandler: [app.authenticate, app.checkIdempotency],
      schema: { tags: ["Duplicates"], summary: "Merge / ignore duplicate" },
    },
    async (request, reply) => {
      assertCanMutate(request.authUser!.role);
      const { id } = request.params as { id: string };
      const body = parseOrThrow(resolveBody, request.body);
      const result = await duplicatesService.resolveDuplicate(
        app.prisma,
        request.authUser!.tenantId,
        request.authUser!.id,
        id,
        body.resolution,
      );
      return reply.send(result);
    },
  );
};

export default duplicatesRoutes;
