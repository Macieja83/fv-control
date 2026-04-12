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
      const credentialsOk = Boolean(cfg.KSEF_TOKEN && cfg.KSEF_NIP);
      const issuanceLiveReady =
        cfg.KSEF_ISSUANCE_MODE === "live" && cfg.KSEF_ENV !== "mock" && credentialsOk;
      return {
        environment: cfg.KSEF_ENV,
        configured: credentialsOk,
        /** Role MF w `query/metadata` (zakres domyślny: Subject2 + Subject1). */
        syncSubjectTypes: cfg.KSEF_SYNC_SUBJECT_TYPES,
        nip: cfg.KSEF_NIP ?? null,
        issuanceMode: cfg.KSEF_ISSUANCE_MODE,
        /** `true` gdy `POST /invoices/:id/send-to-ksef` wyśle FA do API MF (nie tylko stub w bazie). */
        issuanceLiveReady,
        autoSyncIntervalMs: cfg.KSEF_AUTO_SYNC_INTERVAL_MS,
        lastSyncHwmDate: hwmDate,
        lastSyncAt: source?.updatedAt ?? null,
        invoiceCount: ksefInvoiceCount,
      };
    },
  );

  app.post<{
    Body: { force?: boolean; fromDate?: string };
  }>(
    "/connectors/ksef/sync",
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ["KSeF"],
        summary: "Trigger manual KSeF sync",
        body: {
          type: "object",
          properties: {
            force: { type: "boolean", description: "Re-download XMLs for existing invoices and store in S3" },
            fromDate: { type: "string", description: "ISO date to sync from (overrides high-water mark)" },
          },
        },
      },
    },
    async (request, reply) => {
      assertCanMutate(request.authUser!.role);
      const cfg = loadConfig();
      if (cfg.KSEF_ENV === "mock" || !cfg.KSEF_TOKEN || !cfg.KSEF_NIP) {
        return reply.status(400).send({
          error: { message: "KSeF not configured. Set KSEF_ENV, KSEF_TOKEN, and KSEF_NIP." },
        });
      }
      const body = (request.body as { force?: boolean; fromDate?: string }) ?? {};
      const result = await enqueueKsefSync({
        tenantId: request.authUser!.tenantId,
        forceRefetchFiles: body.force === true,
        fromDate: body.fromDate,
      });
      return reply.status(202).send({ queued: true, jobId: result.jobId });
    },
  );
};

export default ksefRoutes;
