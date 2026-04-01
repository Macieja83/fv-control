import type { UserRole } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";

export type AuthUser = {
  id: string;
  tenantId: string;
  email: string;
  role: UserRole;
};

declare module "fastify" {
  interface FastifyInstance {
    prisma: PrismaClient;
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }

  interface FastifyRequest {
    requestId: string;
    authUser?: AuthUser;
  }
}
