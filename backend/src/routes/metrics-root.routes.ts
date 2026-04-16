import type { FastifyPluginAsync } from "fastify";
import { loadConfig } from "../config.js";
import { getMetricsRegistry } from "../lib/metrics.js";

/** Prometheus scrape endpoint (outside /api/v1 — typical for k8s ServiceMonitor). */
const metricsRootRoutes: FastifyPluginAsync = async (app) => {
  app.get("/metrics", async (request, reply) => {
    const token = loadConfig().METRICS_BEARER_TOKEN;
    if (token) {
      const auth = request.headers.authorization;
      const expected = `Bearer ${token}`;
      if (auth !== expected) {
        return reply.status(401).send({ error: { code: "UNAUTHORIZED", message: "Missing or invalid metrics token" } });
      }
    }
    reply.header("Content-Type", getMetricsRegistry().contentType);
    return reply.send(await getMetricsRegistry().metrics());
  });
};

export default metricsRootRoutes;
