/**
 * B18 customer chat widget — REST + SSE.
 * Klient (auth, tenant-scoped z JWT): tworzenie/lista/detal/wiadomość + SSE stream.
 * Internal (Discord bot bearer = SUPPORT_ADMIN_BEARER_TOKEN): reply/severity/status.
 */
import { timingSafeEqual } from "node:crypto";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { parseOrThrow } from "../lib/validate.js";
import { AppError } from "../lib/errors.js";
import { loadConfig } from "../config.js";
import { verifyAccessToken } from "../lib/jwt.js";
import { consumeSupportRateToken } from "../lib/support-rate-limit.js";
import { subscribeSupportEvents } from "../modules/support/support.events.js";
import * as support from "../modules/support/support.service.js";

const createTicketSchema = z.object({
  subject: z.string().min(1).max(200),
  message: z.string().min(1).max(5000),
});
const addMessageSchema = z.object({ content: z.string().min(1).max(5000) });
const replySchema = z.object({
  content: z.string().min(1).max(5000),
  authorLabel: z.string().max(100).optional(),
});
const severitySchema = z.object({ severity: z.enum(["P0", "P1", "P2"]) });
const statusSchema = z.object({
  status: z.enum(["OPEN", "IN_PROGRESS", "WAITING_USER", "RESOLVED", "CLOSED"]),
});
const idParam = z.object({ id: z.string().uuid() });

function assertInternalBearer(request: FastifyRequest): void {
  const cfg = loadConfig();
  const expected = cfg.SUPPORT_ADMIN_BEARER_TOKEN;
  if (!expected) {
    throw AppError.unavailable("Support internal API niedostępne (brak SUPPORT_ADMIN_BEARER_TOKEN).");
  }
  const auth = request.headers.authorization;
  const got = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw AppError.unauthorized("Nieprawidłowy token internal.");
  }
}

const supportRoutes: FastifyPluginAsync = async (app) => {
  // ---- Klient (auth + tenant scoping) ----

  app.post(
    "/support/tickets",
    { preHandler: [app.authenticate], schema: { tags: ["Support"], summary: "Utwórz zgłoszenie" } },
    async (request, reply) => {
      const cfg = loadConfig();
      const tenantId = request.authUser!.tenantId;
      const rl = await consumeSupportRateToken(
        "ticket",
        tenantId,
        cfg.RATE_LIMIT_SUPPORT_TICKET_MAX,
        cfg.RATE_LIMIT_SUPPORT_TICKET_WINDOW_MS,
      );
      if (!rl.ok) {
        throw AppError.tooManyRequests("Zbyt wiele zgłoszeń — spróbuj później.", {
          retryAfterSec: rl.retryAfterSec,
        });
      }
      const body = parseOrThrow(createTicketSchema, request.body);
      const ticket = await support.createTicket(app.prisma, tenantId, request.authUser!.id, body);
      return reply.code(201).send(ticket);
    },
  );

  app.get(
    "/support/tickets",
    { preHandler: [app.authenticate], schema: { tags: ["Support"], summary: "Lista zgłoszeń (tenant)" } },
    async (request) => {
      const q = parseOrThrow(z.object({ limit: z.coerce.number().int().positive().max(100).optional() }), request.query);
      return support.listTickets(app.prisma, request.authUser!.tenantId, q.limit ?? 30);
    },
  );

  app.get(
    "/support/tickets/:id",
    { preHandler: [app.authenticate], schema: { tags: ["Support"], summary: "Detal zgłoszenia + historia" } },
    async (request) => {
      const { id } = parseOrThrow(idParam, request.params);
      return support.getTicket(app.prisma, request.authUser!.tenantId, id);
    },
  );

  app.post(
    "/support/tickets/:id/messages",
    { preHandler: [app.authenticate], schema: { tags: ["Support"], summary: "Dodaj wiadomość klienta" } },
    async (request, reply) => {
      const cfg = loadConfig();
      const { id } = parseOrThrow(idParam, request.params);
      const rl = await consumeSupportRateToken(
        "message",
        id,
        cfg.RATE_LIMIT_SUPPORT_MESSAGE_MAX,
        cfg.RATE_LIMIT_SUPPORT_MESSAGE_WINDOW_MS,
      );
      if (!rl.ok) {
        throw AppError.tooManyRequests("Zbyt wiele wiadomości — spróbuj później.", {
          retryAfterSec: rl.retryAfterSec,
        });
      }
      const body = parseOrThrow(addMessageSchema, request.body);
      const msg = await support.addClientMessage(
        app.prisma,
        request.authUser!.tenantId,
        id,
        request.authUser!.id,
        body.content,
      );
      return reply.code(201).send(msg);
    },
  );

  // ---- SSE stream (EventSource nie ustawia nagłówków -> token w query) ----

  app.get(
    "/support/tickets/:id/stream",
    { schema: { tags: ["Support"], summary: "SSE: nowe wiadomości STAFF + zmiany statusu" } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = parseOrThrow(idParam, request.params);
      const q = parseOrThrow(z.object({ access_token: z.string().min(1) }), request.query);

      const cfg = loadConfig();
      let tenantId: string;
      try {
        const payload = verifyAccessToken(q.access_token, cfg.JWT_ACCESS_SECRET);
        const user = await app.prisma.user.findFirst({
          where: { id: payload.sub, isActive: true },
          select: { tenantId: true },
        });
        if (!user || payload.tid !== user.tenantId) {
          throw AppError.unauthorized("Nieprawidłowy token SSE.");
        }
        tenantId = payload.tid;
      } catch {
        throw AppError.unauthorized("Nieprawidłowy token SSE.");
      }

      // Tenant scoping: rzuci notFound jeśli ticket nie należy do tenanta.
      await support.getTicket(app.prisma, tenantId, id);

      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      reply.raw.write("retry: 5000\n\n");
      reply.hijack();

      const send = (evt: unknown): void => {
        reply.raw.write(`data: ${JSON.stringify(evt)}\n\n`);
      };
      const unsubscribe = subscribeSupportEvents(id, send);
      const heartbeat = setInterval(() => {
        reply.raw.write(": ping\n\n");
      }, 25_000);

      const cleanup = (): void => {
        clearInterval(heartbeat);
        unsubscribe();
        if (!reply.raw.writableEnded) reply.raw.end();
      };
      request.raw.on("close", cleanup);
      request.raw.on("error", cleanup);
    },
  );

  // ---- Internal / admin (Discord bot bearer) ----

  app.post(
    "/support/internal/tickets/:id/reply",
    { schema: { tags: ["Support"], summary: "Internal: odpowiedź STAFF (Discord forwarding)" } },
    async (request, reply) => {
      assertInternalBearer(request);
      const { id } = parseOrThrow(idParam, request.params);
      const body = parseOrThrow(replySchema, request.body);
      const msg = await support.adminReply(app.prisma, id, body);
      return reply.code(201).send(msg);
    },
  );

  app.post(
    "/support/internal/tickets/:id/severity",
    { schema: { tags: ["Support"], summary: "Internal: override severity (LLM/Marcin)" } },
    async (request) => {
      assertInternalBearer(request);
      const { id } = parseOrThrow(idParam, request.params);
      const body = parseOrThrow(severitySchema, request.body);
      return support.adminSetSeverity(app.prisma, id, body.severity);
    },
  );

  app.post(
    "/support/internal/tickets/:id/status",
    { schema: { tags: ["Support"], summary: "Internal: zmiana statusu" } },
    async (request) => {
      assertInternalBearer(request);
      const { id } = parseOrThrow(idParam, request.params);
      const body = parseOrThrow(statusSchema, request.body);
      return support.adminSetStatus(app.prisma, id, body.status);
    },
  );
};

export default supportRoutes;
