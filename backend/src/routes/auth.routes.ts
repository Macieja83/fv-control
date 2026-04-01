import type { FastifyPluginAsync } from "fastify";
import { loadConfig } from "../config.js";
import { parseOrThrow } from "../lib/validate.js";
import {
  loginSchema,
  logoutBodySchema,
  refreshSchema,
  registerSchema,
} from "../modules/auth/auth.schema.js";
import * as authService from "../modules/auth/auth.service.js";

const authRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    "/auth/register",
    {
      schema: {
        tags: ["Auth"],
        summary: "Bootstrap first tenant + owner",
        body: {
          type: "object",
          required: ["tenantName", "email", "password"],
          properties: {
            tenantName: { type: "string" },
            tenantNip: { type: "string", nullable: true },
            email: { type: "string", format: "email" },
            password: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const body = parseOrThrow(registerSchema, request.body);
      const result = await authService.registerBootstrap(app.prisma, body);
      return reply.status(201).send(result);
    },
  );

  app.post(
    "/auth/login",
    {
      config: {
        rateLimit: {
          max: loadConfig().RATE_LIMIT_LOGIN_MAX,
          timeWindow: loadConfig().RATE_LIMIT_LOGIN_WINDOW_MS,
        },
      },
      schema: {
        tags: ["Auth"],
        summary: "Login",
        body: {
          type: "object",
          required: ["email", "password"],
          properties: {
            email: { type: "string", format: "email" },
            password: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const body = parseOrThrow(loginSchema, request.body);
      const result = await authService.login(app.prisma, body);
      return reply.send(result);
    },
  );

  app.post(
    "/auth/refresh",
    {
      schema: {
        tags: ["Auth"],
        summary: "Rotate refresh token",
        body: {
          type: "object",
          required: ["refreshToken"],
          properties: { refreshToken: { type: "string" } },
        },
      },
    },
    async (request, reply) => {
      const body = parseOrThrow(refreshSchema, request.body);
      const result = await authService.refreshSession(app.prisma, body.refreshToken);
      return reply.send(result);
    },
  );

  app.post(
    "/auth/logout",
    { preHandler: [app.authenticate], schema: { tags: ["Auth"], summary: "Logout (revoke refresh)" } },
    async (request, reply) => {
      const userId = request.authUser!.id;
      const parsed = parseOrThrow(logoutBodySchema, request.body ?? {});
      await authService.logout(app.prisma, userId, parsed.refreshToken);
      return reply.status(204).send();
    },
  );

  app.get(
    "/auth/me",
    { preHandler: [app.authenticate], schema: { tags: ["Auth"], summary: "Current user" } },
    async (request) => {
      return authService.getMe(app.prisma, request.authUser!.id);
    },
  );
};

export default authRoutes;
