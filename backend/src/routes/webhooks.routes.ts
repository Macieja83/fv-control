import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { loadConfig } from "../config.js";
import { assertCanManageIntegrations } from "../lib/roles.js";
import { stableStringify } from "../lib/stable-json.js";
import { verifyFvControlWebhookSignature } from "../lib/webhook-signature-verify.js";

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function legacyInboundBodyString(body: unknown): string {
  return JSON.stringify(body ?? {});
}

function verifyLegacySignature(secret: string, body: unknown, sig: string): boolean {
  const expected = createHmac("sha256", secret).update(legacyInboundBodyString(body)).digest("hex");
  return safeEqual(sig, expected);
}

const webhooksRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/webhooks/outbox",
    { preHandler: [app.authenticate], schema: { tags: ["Webhooks"], summary: "Outbound webhook deliveries" } },
    async (request) => {
      assertCanManageIntegrations(request.authUser!.role);
      const rows = await app.prisma.webhookOutbox.findMany({
        where: { tenantId: request.authUser!.tenantId },
        orderBy: { createdAt: "desc" },
        take: 100,
      });
      return { data: rows };
    },
  );

  await app.register(async (scope) => {
    scope.addContentTypeParser(
      "application/json",
      { parseAs: "buffer" },
      (req, body, done) => {
        try {
          const raw = body.toString("utf8");
          (req as FastifyRequest).rawBody = raw;
          const json: unknown = raw.length === 0 ? {} : JSON.parse(raw);
          done(null, json);
        } catch (e) {
          done(e as Error);
        }
      },
    );

    scope.post(
      "/webhooks/inbound",
      {
        config: {
          rateLimit: {
            max: loadConfig().RATE_LIMIT_WEBHOOK_MAX,
            timeWindow: loadConfig().RATE_LIMIT_WEBHOOK_WINDOW_MS,
          },
        },
        schema: {
          tags: ["Webhooks"],
          summary: "Inbound hook for n8n / automation (signed)",
          body: { type: "object" },
        },
      },
      async (request, reply) => {
        const cfg = loadConfig();
        const fvSig = request.headers["x-fvcontrol-signature"] as string | undefined;
        const fvTs = request.headers["x-fvcontrol-timestamp"] as string | undefined;
        const legacySig = request.headers["x-signature"] as string | undefined;

        if (cfg.WEBHOOK_SIGNING_SECRET) {
          if (fvSig && fvTs) {
            const rawBody = request.rawBody ?? stableStringify(request.body ?? {});
            const v = verifyFvControlWebhookSignature({
              secret: cfg.WEBHOOK_SIGNING_SECRET,
              rawBody,
              signatureHeader: fvSig,
              timestampHeader: fvTs,
              maxSkewSeconds: cfg.WEBHOOK_MAX_SKEW_SECONDS,
            });
            if (!v.ok) {
              request.log.warn(
                { msg: "inbound_webhook_verify", result: v.reason, requestId: request.requestId },
                "inbound signature failed",
              );
              return reply.status(401).send({
                error: { code: "UNAUTHORIZED", message: "Bad or stale webhook signature" },
              });
            }
          } else if (legacySig) {
            if (!verifyLegacySignature(cfg.WEBHOOK_SIGNING_SECRET, request.body, legacySig)) {
              request.log.warn({ msg: "inbound_webhook_verify", mode: "legacy", requestId: request.requestId }, "bad legacy signature");
              return reply.status(401).send({
                error: { code: "UNAUTHORIZED", message: "Bad signature" },
              });
            }
          } else {
            return reply.status(401).send({ error: { code: "UNAUTHORIZED", message: "Missing signature" } });
          }
        }

        request.log.info({
          msg: "inbound_webhook_accepted",
          requestId: request.requestId,
        });

        return reply.status(202).send({ accepted: true, requestId: request.requestId });
      },
    );
  });
};

export default webhooksRoutes;
