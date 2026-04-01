import type { FastifyPluginAsync } from "fastify";
import { loadConfig } from "../config.js";

const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/health",
    {
      schema: {
        tags: ["System"],
        summary: "Liveness/readiness",
        response: {
          200: {
            type: "object",
            properties: {
              status: { type: "string" },
              database: { type: "string" },
            },
          },
          503: {
            type: "object",
            properties: {
              status: { type: "string" },
              database: { type: "string" },
            },
          },
        },
      },
    },
    async (_request, reply) => {
      try {
        await app.prisma.$queryRaw`SELECT 1`;
        return reply.send({ status: "ok", database: "ok" });
      } catch {
        return reply.status(503).send({ status: "degraded", database: "down" });
      }
    },
  );

  app.get(
    "/version",
    {
      schema: {
        tags: ["System"],
        summary: "Application version",
        response: {
          200: {
            type: "object",
            properties: {
              name: { type: "string" },
              version: { type: "string" },
            },
          },
        },
      },
    },
    async () => {
      const cfg = loadConfig();
      return { name: cfg.APP_NAME, version: cfg.APP_VERSION };
    },
  );
};

export default healthRoutes;
