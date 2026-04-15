import type { Prisma, PrismaClient } from "@prisma/client";
import { KSEF_INGESTION_SOURCE_LABEL } from "./ksef-effective-env.js";

/**
 * Ustawia lub czyści `metadata.ksefEnv` (`sandbox` | `production`) na źródle KSEF.
 * Tworzy rekord źródła, jeśli jeszcze nie istnieje (jak sync / telemetria).
 */
export async function setTenantKsefApiEnvOverride(
  prisma: PrismaClient,
  tenantId: string,
  ksefEnv: "sandbox" | "production" | null,
): Promise<void> {
  const source = await prisma.ingestionSource.findFirst({
    where: { tenantId, kind: "KSEF" },
    orderBy: { updatedAt: "desc" },
    select: { id: true, metadata: true },
  });
  const base =
    source?.metadata && typeof source.metadata === "object"
      ? ({ ...(source.metadata as Record<string, unknown>) } as Record<string, unknown>)
      : {};
  if (ksefEnv === null) {
    delete base.ksefEnv;
  } else {
    base.ksefEnv = ksefEnv;
  }
  const metadata = base as Prisma.InputJsonObject;

  if (source) {
    await prisma.ingestionSource.update({ where: { id: source.id }, data: { metadata } });
    return;
  }
  await prisma.ingestionSource.create({
    data: {
      tenantId,
      kind: "KSEF",
      label: KSEF_INGESTION_SOURCE_LABEL,
      isEnabled: true,
      metadata: {
        hwmDate: null,
        retryKsefNumbers: [],
        ...base,
      },
    },
  });
}
