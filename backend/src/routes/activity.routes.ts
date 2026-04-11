import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { parseOrThrow } from "../lib/validate.js";
import * as activityService from "../modules/activity/activity.service.js";

const querySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).optional(),
});

const activityRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/activity",
    { preHandler: [app.authenticate], schema: { tags: ["Activity"], summary: "Recent events (notifications feed)" } },
    async (request) => {
      const q = parseOrThrow(querySchema, request.query);
      return activityService.listActivity(app.prisma, request.authUser!.tenantId, q.limit ?? 50);
    },
  );
};

export default activityRoutes;
