import type { PrismaClient } from "@prisma/client";
import { loadConfig } from "../../config.js";
import { getEffectiveKsefApiEnv, readKsefEnvOverrideFromMetadata, type KsefApiEnv } from "./ksef-effective-env.js";
import { resolveKsefCredentialSource, type KsefCredentialSource } from "./ksef-tenant-credentials.service.js";

export type PlatformAdminKsefTenantRow = {
  tenantId: string;
  name: string;
  nip: string | null;
  effectiveKsefEnv: KsefApiEnv;
  serverKsefEnv: string;
  ksefEnvOverride: "sandbox" | "production" | null;
  credentialSource: KsefCredentialSource;
  ksefInvoiceCount: number;
  lastSyncHwmDate: unknown;
  lastSyncRunAt: string | null;
  lastSyncOk: boolean | null;
  lastSyncPhase: string | null;
  lastSyncErrorPreview: string | null;
  lastQueueFinalFailure: boolean | null;
  lastQueueError: string | null;
  ingestionUpdatedAt: string | null;
};

export async function listKsefOverviewForPlatformAdmin(
  prisma: PrismaClient,
  limit: number,
): Promise<PlatformAdminKsefTenantRow[]> {
  const cfg = loadConfig();
  const take = Math.min(500, Math.max(1, limit));
  const tenants = await prisma.tenant.findMany({
    take,
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, nip: true },
  });

  const out: PlatformAdminKsefTenantRow[] = [];
  for (const t of tenants) {
    const source = await prisma.ingestionSource.findFirst({
      where: { tenantId: t.id, kind: "KSEF" },
      orderBy: { updatedAt: "desc" },
      select: { metadata: true, updatedAt: true },
    });
    const meta =
      source?.metadata && typeof source.metadata === "object"
        ? (source.metadata as Record<string, unknown>)
        : null;
    const { source: credentialSource } = await resolveKsefCredentialSource(prisma, t.id);
    const effective = await getEffectiveKsefApiEnv(prisma, t.id);
    const ksefInvoiceCount = await prisma.invoice.count({
      where: { tenantId: t.id, intakeSourceType: "KSEF_API" },
    });
    out.push({
      tenantId: t.id,
      name: t.name,
      nip: t.nip,
      effectiveKsefEnv: effective,
      serverKsefEnv: cfg.KSEF_ENV,
      ksefEnvOverride: readKsefEnvOverrideFromMetadata(source?.metadata ?? null),
      credentialSource,
      ksefInvoiceCount,
      lastSyncHwmDate: meta ? (meta.hwmDate ?? null) : null,
      lastSyncRunAt: meta && typeof meta.lastSyncRunAt === "string" ? meta.lastSyncRunAt : null,
      lastSyncOk: meta && typeof meta.lastSyncOk === "boolean" ? meta.lastSyncOk : null,
      lastSyncPhase: meta && typeof meta.lastSyncPhase === "string" ? meta.lastSyncPhase : null,
      lastSyncErrorPreview:
        meta && typeof meta.lastSyncErrorPreview === "string" ? meta.lastSyncErrorPreview : null,
      lastQueueFinalFailure:
        meta && typeof meta.lastQueueFinalFailure === "boolean" ? meta.lastQueueFinalFailure : null,
      lastQueueError: meta && typeof meta.lastQueueError === "string" ? meta.lastQueueError : null,
      ingestionUpdatedAt: source?.updatedAt ? source.updatedAt.toISOString() : null,
    });
  }
  return out;
}
