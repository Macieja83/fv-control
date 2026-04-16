import fp from "fastify-plugin";
import type { FastifyPluginAsync } from "fastify";
import { isPlatformAdminEmail, loadConfig } from "../config.js";
import { AppError } from "../lib/errors.js";
import { verifyAccessToken } from "../lib/jwt.js";

const authPlugin: FastifyPluginAsync = async (app) => {
  app.decorate(
    "authenticate",
    async (request): Promise<void> => {
      const auth = request.headers.authorization;
      if (!auth?.startsWith("Bearer ")) {
        throw AppError.unauthorized("Missing bearer token");
      }
      const token = auth.slice("Bearer ".length).trim();
      if (!token) {
        throw AppError.unauthorized("Missing bearer token");
      }
      const cfg = loadConfig();
      const payload = verifyAccessToken(token, cfg.JWT_ACCESS_SECRET);
      const user = await app.prisma.user.findFirst({
        where: { id: payload.sub, isActive: true },
        select: { id: true, tenantId: true, email: true, role: true },
      });
      if (!user) {
        throw AppError.unauthorized("User not found or inactive");
      }
      const isPlatformAdmin = isPlatformAdminEmail(user.email);
      if (payload.typ === "impersonation" && !isPlatformAdmin) {
        throw AppError.unauthorized("Impersonation token requires platform admin");
      }
      if (payload.tid !== user.tenantId && !isPlatformAdmin) {
        throw AppError.unauthorized("Invalid tenant context");
      }
      if (!isPlatformAdmin) {
        const latestSub = await app.prisma.subscription.findFirst({
          where: { tenantId: payload.tid },
          orderBy: { updatedAt: "desc" },
          select: { status: true },
        });
        if (latestSub && latestSub.status !== "ACTIVE" && latestSub.status !== "TRIALING") {
          throw AppError.forbidden("Subscription inactive");
        }
      }
      if (user.role !== payload.role) {
        throw AppError.unauthorized("Token stale — please login again");
      }
      request.authUser = {
        ...user,
        tenantId: payload.tid,
        isPlatformAdmin,
        ...(payload.impBy ? { impersonatedByUserId: payload.impBy } : {}),
      };
    },
  );
};

export default fp(authPlugin, { name: "auth", dependencies: ["prisma"] });
