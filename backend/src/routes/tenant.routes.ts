import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
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
import {
  getBillingCompanyData,
  upsertBillingCompanyData,
} from "../modules/billing/auto-self-invoice.service.js";
import {
  assertExportRateLimit,
  exportTenantDataAsJson,
} from "../modules/tenant/data-export.service.js";

/**
 * Dane firmowe klienta wymagane przed wystawieniem FV VAT za subskrypcję (B15 dogfood).
 * Wymuszane przy upgrade na PRO — gdy któreś pole null, frontend pokazuje modal NIP.
 */
const billingCompanyDataSchema = z.object({
  legalName: z.string().trim().min(3, "min 3 znaki").max(200),
  nip: z
    .string()
    .transform((s) => s.replace(/\D/g, ""))
    .pipe(z.string().length(10, "NIP musi mieć dokładnie 10 cyfr")),
  address: z.string().trim().min(10, "min 10 znaków").max(500),
  invoiceEmail: z.string().trim().toLowerCase().email("nieprawidłowy email"),
});

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

  app.get(
    "/tenant/billing-data",
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ["Tenant"],
        summary: "Get tenant billing company data (for self-invoice PRO subscription)",
      },
    },
    async (request) => {
      const data = await getBillingCompanyData(app.prisma, request.authUser!.tenantId);
      return { data, complete: data !== null };
    },
  );

  app.patch(
    "/tenant/billing-data",
    {
      preHandler: [app.authenticate, app.checkIdempotency],
      schema: {
        tags: ["Tenant"],
        summary: "Upsert tenant billing company data (legalName, nip, address, invoiceEmail) — wymagane przed upgrade PRO",
      },
    },
    async (request) => {
      assertCanMutate(request.authUser!.role);
      const body = parseOrThrow(billingCompanyDataSchema, request.body);
      const saved = await upsertBillingCompanyData(
        app.prisma,
        request.authUser!.tenantId,
        body,
        request.authUser!.id,
      );
      await app.prisma.auditLog.create({
        data: {
          tenantId: request.authUser!.tenantId,
          actorId: request.authUser!.id,
          action: "TENANT_BILLING_DATA_UPDATED",
          entityType: "TENANT",
          entityId: request.authUser!.tenantId,
          metadata: { nip: saved.nip, legalName: saved.legalName } as object,
        },
      });
      return { data: saved, complete: true };
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

  /**
   * RODO art. 20 — prawo do przenoszenia danych.
   * GET /api/v1/tenant/data-export → JSON download attachment.
   * Rate limit: 1× / 24h per tenant (przez audit log lookup). Audit log entry "TENANT_DATA_EXPORTED" tworzony przed wysłaniem.
   * Permission: OWNER/ADMIN/ACCOUNTANT (assertCanMutate) — chroni przed leaking przez wiewer/viewer roles.
   */
  app.get(
    "/tenant/data-export",
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ["Tenant"],
        summary: "RODO art. 20 — eksport danych tenanta (JSON, ZIP w przyszłej iteracji z PDF faktur)",
        description:
          "Pobranie wszystkich danych firmy w formacie JSON UTF-8: tenant + billingCompanyData + users (bez passwordHash) + contractors + agreements + invoices (bez raw XML/OCR) + subscriptions. Limit: 1× / 24h per tenant.",
        response: {
          200: { type: "object", additionalProperties: true },
        },
      },
    },
    async (request, reply) => {
      assertCanMutate(request.authUser!.role);
      const tenantId = request.authUser!.tenantId;
      await assertExportRateLimit(app.prisma, tenantId);

      const data = await exportTenantDataAsJson(app.prisma, tenantId, request.authUser!.email);

      await app.prisma.auditLog.create({
        data: {
          tenantId,
          actorId: request.authUser!.id,
          action: "TENANT_DATA_EXPORTED",
          entityType: "TENANT",
          entityId: tenantId,
          metadata: data.stats as object,
        },
      });

      const filename = `fvcontrol-export-${new Date().toISOString().slice(0, 10)}-${tenantId.slice(0, 8)}.json`;
      reply.header("Content-Type", "application/json; charset=utf-8");
      reply.header("Content-Disposition", `attachment; filename="${filename}"`);
      reply.header("Cache-Control", "no-store");
      return reply.send(data);
    },
  );
};

export default tenantRoutes;
