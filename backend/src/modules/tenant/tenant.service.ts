import type { PrismaClient } from "@prisma/client";
import { AppError } from "../../lib/errors.js";
import type { PortalIntegrationsPatchInput, TenantUpdateInput } from "./tenant.schema.js";

const PORTAL_INTEGRATIONS_KEY = "portal.integrations";

export type PortalIntegrationsState = {
  bankConnected: boolean;
  bankLabel: string | null;
  ksefConfigured: boolean;
  ksefClientNote: string | null;
  updatedAt: string | null;
};

const defaultPortalState: PortalIntegrationsState = {
  bankConnected: false,
  bankLabel: null,
  ksefConfigured: false,
  ksefClientNote: null,
  updatedAt: null,
};

function parsePortalJson(raw: unknown): PortalIntegrationsState {
  if (!raw || typeof raw !== "object") return { ...defaultPortalState };
  const o = raw as Record<string, unknown>;
  return {
    bankConnected: typeof o.bankConnected === "boolean" ? o.bankConnected : false,
    bankLabel: typeof o.bankLabel === "string" ? o.bankLabel : null,
    ksefConfigured: typeof o.ksefConfigured === "boolean" ? o.ksefConfigured : false,
    ksefClientNote: typeof o.ksefClientNote === "string" ? o.ksefClientNote : null,
    updatedAt: typeof o.updatedAt === "string" ? o.updatedAt : null,
  };
}

export async function getTenantProfile(prisma: PrismaClient, tenantId: string) {
  const t = await prisma.tenant.findFirst({
    where: { id: tenantId, deletedAt: null },
  });
  if (!t) throw AppError.notFound("Tenant not found");
  const setting = await prisma.tenantSetting.findUnique({
    where: { tenantId_key: { tenantId, key: PORTAL_INTEGRATIONS_KEY } },
  });
  const portal = parsePortalJson(setting?.valueJson);
  return {
    id: t.id,
    name: t.name,
    nip: t.nip,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    portalIntegrations: portal,
  };
}

export async function updateTenantProfile(
  prisma: PrismaClient,
  tenantId: string,
  input: TenantUpdateInput,
) {
  await prisma.tenant.findFirstOrThrow({
    where: { id: tenantId, deletedAt: null },
  });
  try {
    return await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.nip !== undefined ? { nip: input.nip } : {}),
      },
    });
  } catch (e: unknown) {
    if (typeof e === "object" && e !== null && "code" in e && (e as { code: string }).code === "P2002") {
      throw AppError.conflict("Ten numer NIP jest już przypisany do innej firmy w systemie.");
    }
    throw e;
  }
}

export async function getPortalIntegrations(prisma: PrismaClient, tenantId: string) {
  const setting = await prisma.tenantSetting.findUnique({
    where: { tenantId_key: { tenantId, key: PORTAL_INTEGRATIONS_KEY } },
  });
  return parsePortalJson(setting?.valueJson);
}

export async function patchPortalIntegrations(
  prisma: PrismaClient,
  tenantId: string,
  userId: string,
  input: PortalIntegrationsPatchInput,
) {
  const prevRow = await prisma.tenantSetting.findUnique({
    where: { tenantId_key: { tenantId, key: PORTAL_INTEGRATIONS_KEY } },
  });
  const prev = parsePortalJson(prevRow?.valueJson);
  const next: PortalIntegrationsState = {
    bankConnected: input.bankConnected ?? prev.bankConnected,
    bankLabel: input.bankLabel !== undefined ? input.bankLabel : prev.bankLabel,
    ksefConfigured: input.ksefConfigured ?? prev.ksefConfigured,
    ksefClientNote: input.ksefClientNote !== undefined ? input.ksefClientNote : prev.ksefClientNote,
    updatedAt: new Date().toISOString(),
  };
  await prisma.tenantSetting.upsert({
    where: { tenantId_key: { tenantId, key: PORTAL_INTEGRATIONS_KEY } },
    create: {
      tenantId,
      key: PORTAL_INTEGRATIONS_KEY,
      valueJson: next as object,
      updatedById: userId,
    },
    update: { valueJson: next as object, updatedById: userId },
  });
  await prisma.auditLog.create({
    data: {
      tenantId,
      actorId: userId,
      action: "PORTAL_INTEGRATIONS_UPDATED",
      entityType: "SETTINGS",
      entityId: tenantId,
      metadata: { patch: input } as object,
    },
  });
  return next;
}
