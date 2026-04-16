import type { FastifyPluginAsync } from "fastify";
import { parseOrThrow } from "../lib/validate.js";
import { getCategoryBreakdown } from "../modules/reports/category-breakdown.service.js";
import { categoryBreakdownQuerySchema } from "../modules/reports/reports.schema.js";

const reportsRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/reports/category-breakdown",
    { preHandler: [app.authenticate], schema: { tags: ["Reports"], summary: "Sumy brutto wg kategorii" } },
    async (request) => {
      const q = parseOrThrow(categoryBreakdownQuerySchema, request.query);
      return getCategoryBreakdown(app.prisma, request.authUser!.tenantId, q);
    },
  );
};

export default reportsRoutes;
