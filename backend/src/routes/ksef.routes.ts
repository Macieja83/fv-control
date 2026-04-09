import type { FastifyPluginAsync } from "fastify";
import { loadConfig } from "../config.js";
import { assertCanMutate } from "../lib/roles.js";
import { enqueueKsefSync } from "../lib/ksef-sync-queue.js";

const ksefRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/connectors/ksef/status",
    {
      preHandler: [app.authenticate],
      schema: { tags: ["KSeF"], summary: "KSeF integration status" },
    },
    async (request) => {
      const cfg = loadConfig();
      const tenantId = request.authUser!.tenantId;
      const source = await app.prisma.ingestionSource.findFirst({
        where: { tenantId, kind: "KSEF" },
        select: { metadata: true, updatedAt: true },
      });
      const hwmDate = source?.metadata
        ? (source.metadata as Record<string, unknown>).hwmDate ?? null
        : null;
      const ksefInvoiceCount = await app.prisma.invoice.count({
        where: { tenantId, intakeSourceType: "KSEF_API" },
      });
      return {
        environment: cfg.KSEF_ENV,
        configured: !!(cfg.KSEF_TOKEN && cfg.KSEF_NIP),
        nip: cfg.KSEF_NIP ?? null,
        autoSyncIntervalMs: cfg.KSEF_AUTO_SYNC_INTERVAL_MS,
        lastSyncHwmDate: hwmDate,
        lastSyncAt: source?.updatedAt ?? null,
        invoiceCount: ksefInvoiceCount,
      };
    },
  );

  app.post(
    "/connectors/ksef/sync",
    {
      preHandler: [app.authenticate],
      schema: { tags: ["KSeF"], summary: "Trigger manual KSeF sync" },
    },
    async (request, reply) => {
      assertCanMutate(request.authUser!.role);
      const cfg = loadConfig();
      if (cfg.KSEF_ENV === "mock" || !cfg.KSEF_TOKEN || !cfg.KSEF_NIP) {
        return reply.status(400).send({
          error: { message: "KSeF not configured. Set KSEF_ENV, KSEF_TOKEN, and KSEF_NIP." },
        });
      }
      const result = await enqueueKsefSync({ tenantId: request.authUser!.tenantId });
      return reply.status(202).send({ queued: true, jobId: result.jobId });
    },
  );
};

export default ksefRoutes;
