import fp from "fastify-plugin";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import type { FastifyPluginAsync } from "fastify";
import { loadConfig } from "../config.js";

const swaggerPlugin: FastifyPluginAsync = async (app) => {
  const cfg = loadConfig();
  await app.register(swagger, {
    openapi: {
      openapi: "3.1.0",
      info: {
        title: cfg.APP_NAME,
        version: cfg.APP_VERSION,
        description:
          "FVControl — multi-source invoice ingestion, deduplication, workflows, webhooks (filter for Resta / standalone UI).",
      },
      servers: [{ url: "/api/v1" }],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT",
          },
        },
      },
    },
  });

  await app.register(swaggerUi, {
    routePrefix: "/docs",
    uiConfig: { docExpansion: "list", deepLinking: true },
    staticCSP: true,
  });
};

export default fp(swaggerPlugin, { name: "swagger" });
