import type { Prisma } from "@prisma/client";
import type { FastifyPluginAsync } from "fastify";
import { AppError } from "../lib/errors.js";
import { assertCanManageIntegrations } from "../lib/roles.js";

function decodeCursor(raw: string | undefined): { updatedAt: Date; id: string } | null {
  if (!raw) return null;
  try {
    const j = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as {
      u?: string;
      i?: string;
    };
    if (!j.u || !j.i) return null;
    return { updatedAt: new Date(j.u), id: j.i };
  } catch {
    return null;
  }
}

function encodeCursor(updatedAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ u: updatedAt.toISOString(), i: id }), "utf8").toString("base64url");
}

const adminWebhooksRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Params: { deliveryId: string } }>(
    "/admin/webhooks/:deliveryId/retry",
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ["Admin"],
        summary: "Re-queue a failed or dead-letter webhook delivery",
        params: { type: "object", required: ["deliveryId"], properties: { deliveryId: { type: "string", format: "uuid" } } },
      },
    },
    async (request, reply) => {
      assertCanManageIntegrations(request.authUser!.role);
      const tenantId = request.authUser!.tenantId;
      const { deliveryId } = request.params;

      const res = await app.prisma.webhookOutbox.updateMany({
        where: {
          id: deliveryId,
          tenantId,
          status: { in: ["FAILED_RETRYABLE", "DEAD_LETTER"] },
        },
        data: {
          status: "PENDING",
          lastError: null,
          attemptCount: 0,
        },
      });

      if (res.count === 0) {
        throw AppError.notFound("Delivery not found or not retryable");
      }

      request.log.info({
        msg: "admin_webhook_retry",
        deliveryId,
        tenantId,
      });

      return reply.status(202).send({ ok: true, deliveryId });
    },
  );

  app.get<{
    Querystring: { limit?: string; cursor?: string; eventType?: string };
  }>(
    "/admin/webhooks/dlq",
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ["Admin"],
        summary: "List dead-letter webhook deliveries (paginated)",
        querystring: {
          type: "object",
          properties: {
            limit: { type: "string" },
            cursor: { type: "string" },
            eventType: { type: "string" },
          },
        },
      },
    },
    async (request) => {
      assertCanManageIntegrations(request.authUser!.role);
      const tenantId = request.authUser!.tenantId;
      const limit = Math.min(Math.max(Number(request.query.limit) || 20, 1), 100);
      const cursor = decodeCursor(request.query.cursor);
      const eventType = request.query.eventType?.trim();

      const where: Prisma.WebhookOutboxWhereInput = {
        tenantId,
        status: "DEAD_LETTER",
        ...(eventType ? { eventType } : {}),
        ...(cursor
          ? {
              OR: [
                { updatedAt: { lt: cursor.updatedAt } },
                { AND: [{ updatedAt: cursor.updatedAt }, { id: { lt: cursor.id } }] },
              ],
            }
          : {}),
      };

      const rows = await app.prisma.webhookOutbox.findMany({
        where,
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: limit + 1,
        select: {
          id: true,
          eventType: true,
          url: true,
          status: true,
          attemptCount: true,
          lastError: true,
          idempotencyKey: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      const page = rows.slice(0, limit);
      const next =
        rows.length > limit
          ? encodeCursor(page[page.length - 1]!.updatedAt, page[page.length - 1]!.id)
          : null;

      return {
        data: page,
        nextCursor: next,
      };
    },
  );
};

export default adminWebhooksRoutes;
