import type { UserRole } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import type { FastifyReply } from "fastify";

export type AuthUser = {
  id: string;
  tenantId: string;
  email: string;
  role: UserRole;
};

export type IdempotencyContext = {
  idempotencyKey: string;
  routeFingerprint: string;
  requestHash: string;
  slotId: string;
};

declare module "fastify" {
  interface FastifyInstance {
    prisma: PrismaClient;
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    checkIdempotency: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }

  interface FastifyRequest {
    requestId: string;
    authUser?: AuthUser;
    idempotencyCtx?: IdempotencyContext;
    /** Raw UTF-8 body for signed inbound webhooks (when parser attached). */
    rawBody?: string;
  }
}
