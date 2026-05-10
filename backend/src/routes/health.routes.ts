import type { FastifyPluginAsync } from "fastify";
import { isGoogleOAuthConfigured, isSmtpConfigured, loadConfig } from "../config.js";
import { pingRedis } from "../lib/redis-connection.js";

type DeepCheckStatus = "ok" | "down" | "configured" | "unconfigured" | "disabled" | "mock";

type DeepCheck = {
  status: DeepCheckStatus;
  durationMs?: number;
  detail?: string;
  error?: string;
};

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
              googleOAuthConfigured: { type: "boolean" },
            },
          },
          503: {
            type: "object",
            properties: {
              status: { type: "string" },
              database: { type: "string" },
              redis: { type: "string" },
              googleOAuthConfigured: { type: "boolean" },
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
      const cfg = loadConfig();
      const googleOAuthConfigured = isGoogleOAuthConfigured(cfg);
      const body = { status: ok ? "ok" : "degraded", database, redis, googleOAuthConfigured };
      return ok ? reply.send(body) : reply.status(503).send(body);
    },
  );

  app.get(
    "/health/deep",
    {
      schema: {
        tags: ["System"],
        summary: "Deep healthcheck per subsystem (DB, Redis, S3, KSeF, SMTP, Stripe, billing-dogfood)",
        description:
          "Dla zewnętrznego monitoringu (UptimeRobot, Healthchecks.io, Prometheus). Krytyczne (DB+Redis) decydują o 200/503. Reszta = informacyjna konfiguracja, nie wywołuje live API żeby nie spamować dostawców (MF KSeF, Stripe).",
        response: {
          200: {
            type: "object",
            additionalProperties: true,
            properties: {
              status: { type: "string", enum: ["ok", "degraded"] },
              checkedAt: { type: "string" },
              checks: {
                type: "object",
                additionalProperties: true,
              },
            },
          },
          503: {
            type: "object",
            additionalProperties: true,
            properties: {
              status: { type: "string", enum: ["ok", "degraded"] },
              checkedAt: { type: "string" },
              checks: {
                type: "object",
                additionalProperties: true,
              },
            },
          },
        },
      },
    },
    async (_request, reply) => {
      const cfg = loadConfig();
      const checks: Record<string, DeepCheck> = {};

      // 1. Database (Prisma) — CRITICAL
      {
        const t0 = Date.now();
        try {
          await app.prisma.$queryRaw`SELECT 1`;
          checks.db = { status: "ok", durationMs: Date.now() - t0 };
        } catch (err) {
          checks.db = {
            status: "down",
            durationMs: Date.now() - t0,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }

      // 2. Redis (BullMQ + cache) — CRITICAL
      {
        const t0 = Date.now();
        try {
          const ok = await pingRedis();
          checks.redis = { status: ok ? "ok" : "down", durationMs: Date.now() - t0 };
        } catch (err) {
          checks.redis = {
            status: "down",
            durationMs: Date.now() - t0,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }

      // 3. Storage (S3/MinIO/local) — INFORMATIONAL
      if (cfg.STORAGE_DRIVER === "s3") {
        const hasCreds = Boolean(cfg.S3_ENDPOINT && cfg.S3_ACCESS_KEY && cfg.S3_SECRET_KEY);
        checks.storage = {
          status: hasCreds ? "configured" : "unconfigured",
          detail: `driver=s3 bucket=${cfg.S3_BUCKET} region=${cfg.S3_REGION}`,
        };
      } else {
        checks.storage = {
          status: "configured",
          detail: `driver=local dir=${cfg.UPLOAD_DIR}`,
        };
      }

      // 4. KSeF — INFORMATIONAL (config only, no live MF API call)
      {
        const hasToken = Boolean(cfg.KSEF_TOKEN && cfg.KSEF_NIP);
        let status: DeepCheckStatus;
        if (cfg.KSEF_ENV === "mock") status = "mock";
        else if (hasToken) status = "configured";
        else status = "unconfigured";
        checks.ksef = {
          status,
          detail: `env=${cfg.KSEF_ENV} hasToken=${hasToken}`,
        };
      }

      // 5. SMTP — INFORMATIONAL (config only, no test send)
      checks.smtp = {
        status: isSmtpConfigured(cfg) ? "configured" : "unconfigured",
        detail: cfg.SMTP_HOST
          ? `host=${cfg.SMTP_HOST}:${cfg.SMTP_PORT} secure=${cfg.SMTP_SECURE}`
          : "no SMTP_HOST",
      };

      // 6. Stripe — INFORMATIONAL
      {
        const hasKey = Boolean(cfg.STRIPE_SECRET_KEY);
        const hasWebhook = Boolean(cfg.STRIPE_BILLING_WEBHOOK_SECRET);
        checks.stripe = {
          status: hasKey && hasWebhook ? "configured" : "unconfigured",
          detail: `secretKey=${hasKey} webhookSecret=${hasWebhook}`,
        };
      }

      // 7. Billing dogfood (B15)
      checks.billingDogfood = {
        status: cfg.BILLING_SELF_INVOICE_TENANT_ID ? "configured" : "disabled",
        detail: cfg.BILLING_SELF_INVOICE_TENANT_ID
          ? `tenantId=${cfg.BILLING_SELF_INVOICE_TENANT_ID.substring(0, 8)}...`
          : "BILLING_SELF_INVOICE_TENANT_ID not set",
      };

      // 8. Google OAuth — INFORMATIONAL
      checks.googleOAuth = {
        status: isGoogleOAuthConfigured(cfg) ? "configured" : "unconfigured",
      };

      const critical = checks.db.status === "ok" && checks.redis.status === "ok";
      const body = {
        status: critical ? ("ok" as const) : ("degraded" as const),
        checkedAt: new Date().toISOString(),
        checks,
      };
      return critical ? reply.send(body) : reply.status(503).send(body);
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
