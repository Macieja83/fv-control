import fp from "fastify-plugin";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import type { Prisma } from "@prisma/client";
import { loadConfig } from "../config.js";
import { AppError } from "../lib/errors.js";
import { claimOrResolveIdempotency } from "../lib/idempotency-claim.js";
import { idempotencyStoredTotal } from "../lib/metrics.js";
import { buildIdempotencyRouteKey, hashIdempotencyPayload } from "../lib/idempotency-route.js";

function parsePayloadForStorage(payload: string | Buffer, statusCode: number): Prisma.InputJsonValue {
  if (statusCode === 204) {
    return {};
  }
  const s = typeof payload === "string" ? payload : payload.toString("utf8");
  if (!s || s.length === 0) {
    return {};
  }
  try {
    return JSON.parse(s) as Prisma.InputJsonValue;
  } catch {
    return { _raw: s } as Prisma.InputJsonValue;
  }
}

const idempotencyPlugin: FastifyPluginAsync = async (app) => {
  app.decorate(
    "checkIdempotency",
    async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      const method = request.method.toUpperCase();
      if (method !== "POST" && method !== "PATCH") {
        return;
      }

      const rawKey = request.headers["idempotency-key"];
      if (rawKey === undefined || rawKey === "") {
        return;
      }
      const idempotencyKey = Array.isArray(rawKey) ? rawKey[0]! : rawKey;
      if (!idempotencyKey || idempotencyKey.length > 128) {
        throw AppError.validation("Invalid Idempotency-Key header");
      }

      const tenantId = request.authUser?.tenantId;
      if (!tenantId) {
        return;
      }

      const routeFingerprint = buildIdempotencyRouteKey(request);
      const requestHash = hashIdempotencyPayload(method, routeFingerprint, request.body);

      const resolved = await claimOrResolveIdempotency(app.prisma, {
        tenantId,
        idempotencyKey,
        routeFingerprint,
        requestHash,
      });

      if (resolved.action === "conflict") {
        throw AppError.conflict("Idempotency-Key was already used with a different request payload");
      }

      if (resolved.action === "replay") {
        if (resolved.statusCode === 204) {
          return reply.code(204).send();
        }
        return reply.code(resolved.statusCode).send(resolved.body);
      }

      request.idempotencyCtx = {
        idempotencyKey,
        routeFingerprint,
        requestHash,
        slotId: resolved.slotId,
      };
    },
  );

  app.addHook("onError", async (request, _reply, _err) => {
    const ctx = request.idempotencyCtx;
    if (!ctx?.slotId || !request.authUser?.tenantId) {
      return;
    }
    try {
      await app.prisma.idempotencyKey.deleteMany({
        where: {
          id: ctx.slotId,
          tenantId: request.authUser.tenantId,
          lifecycle: "IN_FLIGHT",
        },
      });
    } catch (e) {
      request.log.warn({ err: e }, "idempotency in-flight cleanup failed");
    }
  });

  app.addHook("onResponse", async (request, reply) => {
    const ctx = request.idempotencyCtx;
    if (!ctx?.slotId || !request.authUser?.tenantId) {
      return;
    }
    const code = reply.statusCode;
    if (code >= 200 && code < 300) {
      return;
    }
    try {
      await app.prisma.idempotencyKey.deleteMany({
        where: {
          id: ctx.slotId,
          tenantId: request.authUser.tenantId,
          lifecycle: "IN_FLIGHT",
        },
      });
    } catch (e) {
      request.log.warn({ err: e }, "idempotency non-success cleanup failed");
    }
  });

  app.addHook(
    "onSend",
    async (request: FastifyRequest, reply: FastifyReply, payload: string | Buffer) => {
      const ctx = request.idempotencyCtx;
      if (!ctx?.slotId || !request.authUser) {
        return payload;
      }

      const status = reply.statusCode;
      if (status < 200 || status >= 300) {
        return payload;
      }

      const cfg = loadConfig();
      const expiresAt = new Date(Date.now() + cfg.IDEMPOTENCY_TTL_HOURS * 60 * 60 * 1000);
      const bodyJson = parsePayloadForStorage(payload, status);

      try {
        await app.prisma.idempotencyKey.update({
          where: { id: ctx.slotId },
          data: {
            lifecycle: "COMPLETED",
            requestHash: ctx.requestHash,
            responseStatus: status,
            responseBody: bodyJson,
            expiresAt,
          },
        });
        idempotencyStoredTotal.inc();
      } catch (err) {
        request.log.warn({ err }, "idempotency store failed");
      }

      return payload;
    },
  );
};

export default fp(idempotencyPlugin, {
  name: "idempotency",
  dependencies: ["prisma"],
});
