import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { loadConfig } from "../config.js";
import { AppError } from "../lib/errors.js";
import { consumeKsefManualSyncRateToken } from "../lib/ksef-manual-sync-rate-limit.js";
import { assertCanManageIntegrations, assertCanMutate } from "../lib/roles.js";
import { parseOrThrow } from "../lib/validate.js";
import { enqueueKsefSync, getKsefQueueSnapshotForTenant } from "../lib/ksef-sync-queue.js";
import { getEffectiveKsefApiEnv, readKsefEnvOverrideFromMetadata } from "../modules/ksef/ksef-effective-env.js";
import { setTenantKsefApiEnvOverride } from "../modules/ksef/ksef-ingestion-settings.service.js";
import { loadKsefClientForTenant, resolveKsefCredentialSource } from "../modules/ksef/ksef-tenant-credentials.service.js";

const ksefEnvPatchSchema = z.object({
  /** `null` — usuń nadpisanie, użyj KSEF_ENV serwera. */
  ksefApiEnv: z.enum(["sandbox", "production"]).nullable(),
});

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
      const meta = source?.metadata && typeof source.metadata === "object"
        ? (source.metadata as Record<string, unknown>)
        : null;
      const hwmDate = meta ? (meta.hwmDate ?? null) : null;
      const ksefInvoiceCount = await app.prisma.invoice.count({
        where: { tenantId, intakeSourceType: "KSEF_API" },
      });
      const effective = await getEffectiveKsefApiEnv(app.prisma, tenantId);
      const { source: credentialSource, client } = await resolveKsefCredentialSource(app.prisma, tenantId);
      const credentialsOk = client !== null;
      const issuanceLiveReady = cfg.KSEF_ISSUANCE_MODE === "live" && effective !== "mock" && credentialsOk;

      let queueLive: Awaited<ReturnType<typeof getKsefQueueSnapshotForTenant>> | null = null;
      try {
        queueLive = await getKsefQueueSnapshotForTenant(tenantId);
      } catch (err) {
        app.log.warn({ err, tenantId }, "KSeF queue snapshot unavailable (Redis?)");
      }

      const ksefEnvOverride = readKsefEnvOverrideFromMetadata(meta);

      return {
        /** Rzeczywiste środowisko API dla tego tenanta (nadpisanie lub KSEF_ENV). */
        environment: effective,
        serverEnvironment: cfg.KSEF_ENV,
        ksefEnvOverride,
        configured: credentialsOk,
        credentialSource,
        /** Role MF w `query/metadata` (zakres domyślny: Subject2 + Subject1). */
        syncSubjectTypes: cfg.KSEF_SYNC_SUBJECT_TYPES,
        /** Typy dat w zapytaniu (domyślnie PermanentStorage + Issue). */
        syncDateTypes: cfg.KSEF_SYNC_DATE_TYPES,
        /** Ile dni wstecz od „teraz” minimalnie nakładamy na okno przy hwmDate. */
        syncHwmOverlapDays: cfg.KSEF_SYNC_HWN_OVERLAP_DAYS,
        nip: cfg.KSEF_NIP ?? null,
        issuanceMode: cfg.KSEF_ISSUANCE_MODE,
        /** `true` gdy `POST /invoices/:id/send-to-ksef` wyśle FA do API MF (nie tylko stub w bazie). */
        issuanceLiveReady,
        autoSyncIntervalMs: cfg.KSEF_AUTO_SYNC_INTERVAL_MS,
        lastSyncHwmDate: hwmDate,
        /** Czas ostatniej aktualizacji rekordu źródła (np. po sync). */
        lastSyncAt: source?.updatedAt ?? null,
        lastSyncRunAt: meta && typeof meta.lastSyncRunAt === "string" ? meta.lastSyncRunAt : null,
        lastSyncOk: meta && typeof meta.lastSyncOk === "boolean" ? meta.lastSyncOk : null,
        lastSyncPhase: meta && typeof meta.lastSyncPhase === "string" ? meta.lastSyncPhase : null,
        lastSyncSkippedReason:
          meta && typeof meta.lastSyncSkippedReason === "string" ? meta.lastSyncSkippedReason : null,
        lastSyncStats:
          meta && meta.lastSyncStats !== null && typeof meta.lastSyncStats === "object"
            ? (meta.lastSyncStats as Record<string, unknown>)
            : null,
        lastSyncErrorPreview:
          meta && typeof meta.lastSyncErrorPreview === "string" ? meta.lastSyncErrorPreview : null,
        invoiceCount: ksefInvoiceCount,
        queue: {
          redisAvailable: queueLive !== null,
          autoDedupeJobId: queueLive?.autoDedupeJobId ?? `auto-ksef-${tenantId}`,
          autoJobState: queueLive?.autoJobState ?? null,
          pendingOrActiveOtherJobs: queueLive?.pendingOrActiveOtherJobs ?? 0,
          lastJobId: meta && typeof meta.lastQueueJobId === "string" ? meta.lastQueueJobId : null,
          lastJobState:
            meta &&
            (meta.lastQueueJobState === "completed" ||
              meta.lastQueueJobState === "failed" ||
              meta.lastQueueJobState === "retrying")
              ? meta.lastQueueJobState
              : null,
          lastJobFinishedAt:
            meta && typeof meta.lastQueueFinishedAt === "string" ? meta.lastQueueFinishedAt : null,
          lastJobError: meta && typeof meta.lastQueueError === "string" ? meta.lastQueueError : null,
          lastJobAttempts: meta && typeof meta.lastQueueAttempts === "number" ? meta.lastQueueAttempts : null,
          lastJobMaxAttempts:
            meta && typeof meta.lastQueueMaxAttempts === "number" ? meta.lastQueueMaxAttempts : null,
          lastJobFinalFailure:
            meta && typeof meta.lastQueueFinalFailure === "boolean" ? meta.lastQueueFinalFailure : null,
        },
      };
    },
  );

  app.patch<{
    Body: { ksefApiEnv?: "sandbox" | "production" | null };
  }>(
    "/connectors/ksef/settings",
    {
      preHandler: [app.authenticate, app.checkIdempotency],
      schema: {
        tags: ["KSeF"],
        summary: "Ustaw środowisko API KSeF (sandbox/produkcja) dla tenanta",
        body: {
          type: "object",
          required: ["ksefApiEnv"],
          properties: {
            ksefApiEnv: {
              type: ["string", "null"],
              enum: ["sandbox", "production", null],
              description: "null = zgodnie z KSEF_ENV serwera",
            },
          },
        },
      },
    },
    async (request, reply) => {
      assertCanManageIntegrations(request.authUser!.role);
      const body = parseOrThrow(ksefEnvPatchSchema, request.body);
      const tenantId = request.authUser!.tenantId;
      await setTenantKsefApiEnvOverride(app.prisma, tenantId, body.ksefApiEnv);
      await app.prisma.auditLog.create({
        data: {
          tenantId,
          actorId: request.authUser!.id,
          action: "KSEF_API_ENV_UPDATED",
          entityType: "INTEGRATION",
          entityId: tenantId,
          metadata: { ksefApiEnv: body.ksefApiEnv } as object,
        },
      });
      return reply.send({ ok: true });
    },
  );

  app.post<{
    Body: { force?: boolean; fromDate?: string; toDate?: string };
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
            toDate: {
              type: "string",
              description:
                "ISO upper bound for dateType=Issue metadata only (portal issue date). PermanentStorage still queries to now. When set, hwmDate is not updated.",
            },
          },
        },
      },
    },
    async (request, reply) => {
      assertCanMutate(request.authUser!.role);
      const cfg = loadConfig();
      const tenantId = request.authUser!.tenantId;
      const rl = await consumeKsefManualSyncRateToken(
        tenantId,
        cfg.RATE_LIMIT_KSEF_SYNC_MAX,
        cfg.RATE_LIMIT_KSEF_SYNC_WINDOW_MS,
      );
      if (!rl.ok) {
        void reply.header("Retry-After", String(rl.retryAfterSec));
        throw AppError.tooManyRequests(
          `Zbyt częste uruchamianie synchronizacji KSeF. Spróbuj ponownie za ok. ${rl.retryAfterSec} s.`,
          { retryAfterSec: rl.retryAfterSec },
        );
      }
      const effective = await getEffectiveKsefApiEnv(app.prisma, tenantId);
      if (effective === "mock") {
        return reply.status(400).send({
          error: {
            message:
              "KSeF bez realnego API: ustaw środowisko sandbox lub produkcja w ustawieniach KSeF albo zmień KSEF_ENV na serwerze.",
          },
        });
      }
      const client = await loadKsefClientForTenant(app.prisma, tenantId);
      if (!client) {
        return reply.status(400).send({
          error: {
            message:
              "KSeF nie jest skonfigurowany: zapisz poświadczenia w Ustawieniach (sekcja KSeF) lub ustaw KSEF_TOKEN i KSEF_NIP w .env serwera.",
          },
        });
      }
      const body = (request.body as { force?: boolean; fromDate?: string; toDate?: string }) ?? {};
      const result = await enqueueKsefSync({
        tenantId,
        forceRefetchFiles: body.force === true,
        fromDate: body.fromDate,
        toDate: body.toDate,
      });
      return reply.status(202).send({
        queued: true,
        jobId: result.jobId,
        dedupeSkipped: result.skipped === true,
      });
    },
  );
};

export default ksefRoutes;
