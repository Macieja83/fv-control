import type { FastifyPluginAsync } from "fastify";
import { getMetricsRegistry } from "../lib/metrics.js";

/** Prometheus scrape endpoint (outside /api/v1 — typical for k8s ServiceMonitor). */
const metricsRootRoutes: FastifyPluginAsync = async (app) => {
  app.get("/metrics", async (_request, reply) => {
    reply.header("Content-Type", getMetricsRegistry().contentType);
    return reply.send(await getMetricsRegistry().metrics());
  });
};

export default metricsRootRoutes;
