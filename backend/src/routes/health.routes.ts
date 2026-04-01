import type { FastifyPluginAsync } from "fastify";
import { loadConfig } from "../config.js";
import { pingRedis } from "../lib/redis-connection.js";

const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/health",
    {
      schema: {
        tags: ["System"],
        summary: "Liveness (process up)",
        response: {
          200: {
            type: "object",
            properties: {
              status: { type: "string" },
            },
          },
        },
      },
    },
    async (_request, reply) => reply.send({ status: "ok" }),
  );

  app.get(
    "/ready",
    {
      schema: {
        tags: ["System"],
        summary: "Readiness (Postgres + Redis)",
        response: {
          200: {
            type: "object",
            properties: {
              status: { type: "string" },
              database: { type: "string" },
              redis: { type: "string" },
            },
          },
          503: {
            type: "object",
            properties: {
              status: { type: "string" },
              database: { type: "string" },
              redis: { type: "string" },
            },
          },
        },
      },
    },
    async (_request, reply) => {
      let database: "ok" | "down" = "ok";
      try {
        await app.prisma.$queryRaw`SELECT 1`;
      } catch {
        database = "down";
      }
      const redis = (await pingRedis()) ? "ok" : "down";
      const ok = database === "ok" && redis === "ok";
      const body = { status: ok ? "ok" : "degraded", database, redis };
      return ok ? reply.send(body) : reply.status(503).send(body);
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
