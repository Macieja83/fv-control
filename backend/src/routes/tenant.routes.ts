import type { FastifyPluginAsync } from "fastify";
import { assertCanManageIntegrations, assertCanMutate } from "../lib/roles.js";
import { parseOrThrow } from "../lib/validate.js";
import {
  portalIntegrationsPatchSchema,
  tenantKsefUpsertSchema,
  tenantUpdateSchema,
} from "../modules/tenant/tenant.schema.js";
import * as tenantService from "../modules/tenant/tenant.service.js";
import {
  deleteTenantKsefCredentials,
  getTenantKsefCredentialsPublic,
  testTenantKsefConnection,
  upsertTenantKsefCredentials,
} from "../modules/ksef/ksef-tenant-credentials.service.js";

const tenantRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/tenant",
    { preHandler: [app.authenticate], schema: { tags: ["Tenant"], summary: "Company profile + portal state" } },
    async (request) => {
      return tenantService.getTenantProfile(app.prisma, request.authUser!.tenantId);
    },
  );

  app.patch(
    "/tenant",
    {
      preHandler: [app.authenticate, app.checkIdempotency],
      schema: { tags: ["Tenant"], summary: "Update company profile" },
    },
    async (request) => {
      assertCanMutate(request.authUser!.role);
      const body = parseOrThrow(tenantUpdateSchema, request.body);
      const row = await tenantService.updateTenantProfile(app.prisma, request.authUser!.tenantId, body);
      await app.prisma.auditLog.create({
        data: {
          tenantId: request.authUser!.tenantId,
          actorId: request.authUser!.id,
          action: "TENANT_PROFILE_UPDATED",
          entityType: "TENANT",
          entityId: row.id,
          metadata: { name: row.name, nip: row.nip } as object,
        },
      });
      return row;
    },
  );

  app.get(
    "/tenant/integrations",
    { preHandler: [app.authenticate], schema: { tags: ["Tenant"], summary: "Portal integration flags" } },
    async (request) => {
      return tenantService.getPortalIntegrations(app.prisma, request.authUser!.tenantId);
    },
  );

  app.patch(
    "/tenant/integrations",
    {
      preHandler: [app.authenticate, app.checkIdempotency],
      schema: { tags: ["Tenant"], summary: "Update bank / KSeF self-service flags" },
    },
    async (request) => {
      assertCanManageIntegrations(request.authUser!.role);
      const body = parseOrThrow(portalIntegrationsPatchSchema, request.body);
      return tenantService.patchPortalIntegrations(
        app.prisma,
        request.authUser!.tenantId,
        request.authUser!.id,
        body,
      );
    },
  );

  app.get(
    "/tenant/ksef-credentials",
    { preHandler: [app.authenticate], schema: { tags: ["Tenant"], summary: "KSeF credential state (no secrets)" } },
    async (request) => {
      return getTenantKsefCredentialsPublic(app.prisma, request.authUser!.tenantId);
    },
  );

  app.put(
    "/tenant/ksef-credentials",
    { preHandler: [app.authenticate], schema: { tags: ["Tenant"], summary: "Save tenant KSeF credentials (encrypted)" } },
    async (request) => {
      assertCanManageIntegrations(request.authUser!.role);
      const body = parseOrThrow(tenantKsefUpsertSchema, request.body);
      await upsertTenantKsefCredentials(app.prisma, request.authUser!.tenantId, request.authUser!.id, body);
      return { ok: true };
    },
  );

  app.delete(
    "/tenant/ksef-credentials",
    { preHandler: [app.authenticate], schema: { tags: ["Tenant"], summary: "Remove tenant KSeF credentials" } },
    async (request) => {
      assertCanManageIntegrations(request.authUser!.role);
      await deleteTenantKsefCredentials(app.prisma, request.authUser!.tenantId, request.authUser!.id);
      return { ok: true };
    },
  );

  app.post(
    "/tenant/ksef-credentials/test",
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ["Tenant"],
        summary: "Test KSeF authentication (saved credentials, or draft body without persisting)",
        body: {
          type: "object",
          additionalProperties: true,
          properties: {
            ksefTokenOrEncryptedBlob: { type: "string" },
            tokenPassword: { type: "string", nullable: true },
            certPemOrDerBase64: { type: "string", nullable: true },
          },
        },
      },
    },
    async (request) => {
      assertCanManageIntegrations(request.authUser!.role);
      const raw = request.body as Record<string, unknown> | undefined;
      const blob =
        raw && typeof raw.ksefTokenOrEncryptedBlob === "string" ? raw.ksefTokenOrEncryptedBlob.trim() : "";
      if (blob.length > 0) {
        const body = parseOrThrow(tenantKsefUpsertSchema, raw);
        return testTenantKsefConnection(app.prisma, request.authUser!.tenantId, body);
      }
      return testTenantKsefConnection(app.prisma, request.authUser!.tenantId);
    },
  );
};

export default tenantRoutes;
