import type { FastifyPluginAsync } from "fastify";
import { loadConfig } from "../config.js";
import { parseOrThrow } from "../lib/validate.js";
import {
  googleCallbackSchema,
  googleStartSchema,
  loginSchema,
  logoutBodySchema,
  refreshSchema,
  registerSchema,
  verifyEmailSchema,
} from "../modules/auth/auth.schema.js";
import * as authService from "../modules/auth/auth.service.js";

const authRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    "/auth/register",
    {
      schema: {
        tags: ["Auth"],
        summary: "Register tenant account (owner)",
        body: {
          type: "object",
          required: ["tenantName", "email", "password"],
          properties: {
            tenantName: { type: "string" },
            tenantNip: { type: "string", nullable: true },
            email: { type: "string", format: "email" },
            password: { type: "string" },
            planCode: { type: "string", enum: ["free", "pro"] },
          },
        },
      },
    },
    async (request, reply) => {
      const body = parseOrThrow(registerSchema, request.body);
      const result = await authService.registerTenantAccount(app.prisma, body);
      return reply.status(201).send(result);
    },
  );

  app.post(
    "/auth/verify-email",
    {
      schema: { tags: ["Auth"], summary: "Verify email with token" },
    },
    async (request, reply) => {
      const body = parseOrThrow(verifyEmailSchema, request.body);
      const result = await authService.verifyEmail(app.prisma, body.token);
      return reply.send(result);
    },
  );

  app.post(
    "/auth/resend-verification",
    {
      schema: { tags: ["Auth"], summary: "Resend email verification token" },
    },
    async (request, reply) => {
      const body = parseOrThrow(loginSchema.pick({ email: true }), request.body);
      const result = await authService.resendEmailVerification(app.prisma, body.email);
      return reply.send(result);
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
    "/auth/google/start",
    { schema: { tags: ["Auth"], summary: "Google OAuth start" } },
    async (request) => {
      const q = parseOrThrow(googleStartSchema, request.query ?? {});
      return { url: authService.buildGoogleAuthUrl(q.mode) };
    },
  );

  app.get(
    "/auth/google/callback",
    { schema: { tags: ["Auth"], summary: "Google OAuth callback" } },
    async (request) => {
      const q = parseOrThrow(googleCallbackSchema, request.query ?? {});
      return authService.loginWithGoogleCode(app.prisma, q.code, q.state);
    },
  );

  app.get(
    "/auth/me",
    { preHandler: [app.authenticate], schema: { tags: ["Auth"], summary: "Current user" } },
    async (request) => {
      const u = request.authUser!;
      return authService.getMe(app.prisma, {
        id: u.id,
        tenantId: u.tenantId,
        impersonatedByUserId: u.impersonatedByUserId,
      });
    },
  );
};

export default authRoutes;
