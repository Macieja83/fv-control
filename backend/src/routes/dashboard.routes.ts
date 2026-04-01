import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { parseOrThrow } from "../lib/validate.js";
import * as dashboardService from "../modules/dashboard/dashboard.service.js";

const reviewQuery = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
});

const dashboardRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/dashboard/summary",
    { preHandler: [app.authenticate], schema: { tags: ["Dashboard"], summary: "KPI + connector snapshot" } },
    async (request) => {
      const tenantId = request.authUser!.tenantId;
      return dashboardService.getOperationalDashboard(app.prisma, tenantId);
    },
  );

  app.get(
    "/dashboard/review-queue",
    { preHandler: [app.authenticate], schema: { tags: ["Dashboard"], summary: "Invoices needing manual review" } },
    async (request) => {
      const q = parseOrThrow(reviewQuery, request.query);
      const tenantId = request.authUser!.tenantId;
      const rows = await dashboardService.listReviewQueue(app.prisma, tenantId, q.limit ?? 50);
      return { data: rows };
    },
  );
};

export default dashboardRoutes;
