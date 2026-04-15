import type { PrismaClient } from "@prisma/client";
import { loadConfig } from "../../config.js";

export type KsefApiEnv = "sandbox" | "production" | "mock";

/** Etykieta źródła ingestu KSeF — spójna z `ksef-sync.service`. */
export const KSEF_INGESTION_SOURCE_LABEL = "KSeF API";

export function readKsefEnvOverrideFromMetadata(metadata: unknown): "sandbox" | "production" | null {
  if (!metadata || typeof metadata !== "object") return null;
  const o = (metadata as Record<string, unknown>).ksefEnv;
  if (o === "sandbox" || o === "production") return o;
  return null;
}

/**
 * Środowisko API KSeF dla tenanta: nadpisanie w `IngestionSource.metadata.ksefEnv`,
 * w przeciwnym razie `KSEF_ENV` z konfiguracji serwera (mock → brak realnego API).
 */
export async function getEffectiveKsefApiEnv(prisma: PrismaClient, tenantId: string): Promise<KsefApiEnv> {
  const cfg = loadConfig();
  const source = await prisma.ingestionSource.findFirst({
    where: { tenantId, kind: "KSEF" },
    orderBy: { updatedAt: "desc" },
    select: { metadata: true },
  });
  const override = readKsefEnvOverrideFromMetadata(source?.metadata ?? null);
  if (override) return override;
  if (cfg.KSEF_ENV === "sandbox" || cfg.KSEF_ENV === "production") return cfg.KSEF_ENV;
  return "mock";
}
