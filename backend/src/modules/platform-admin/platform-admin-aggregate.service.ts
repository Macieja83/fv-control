import type { PrismaClient } from "@prisma/client";

export async function getWebhookDlqPlatformSummary(prisma: PrismaClient, limit: number) {
  const take = Math.min(Math.max(limit, 1), 200);
  const [totalDeadLetter, recent] = await prisma.$transaction([
    prisma.webhookOutbox.count({ where: { status: "DEAD_LETTER" } }),
    prisma.webhookOutbox.findMany({
      where: { status: "DEAD_LETTER" },
      orderBy: { updatedAt: "desc" },
      take,
      select: {
        id: true,
        tenantId: true,
        eventType: true,
        attemptCount: true,
        lastError: true,
        updatedAt: true,
        tenant: { select: { name: true, nip: true } },
      },
    }),
  ]);
  return { totalDeadLetter, recent };
}

function countIds(rows: { tenantId: string }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    m.set(r.tenantId, (m.get(r.tenantId) ?? 0) + 1);
  }
  return m;
}

export async function getConnectorsPlatformSummary(prisma: PrismaClient) {
  const [ingestionRows, credentialRows, posRows] = await prisma.$transaction([
    prisma.ingestionSource.findMany({ select: { tenantId: true } }),
    prisma.integrationCredential.findMany({ where: { isActive: true }, select: { tenantId: true } }),
    prisma.integrationPos.findMany({ where: { isActive: true }, select: { tenantId: true } }),
  ]);

  const ingestionByTenant = countIds(ingestionRows);
  const credentialsByTenant = countIds(credentialRows);
  const posByTenant = countIds(posRows);

  const tenantIds = new Set<string>();
  for (const id of ingestionByTenant.keys()) tenantIds.add(id);
  for (const id of credentialsByTenant.keys()) tenantIds.add(id);
  for (const id of posByTenant.keys()) tenantIds.add(id);

  const tenants =
    tenantIds.size === 0
      ? []
      : await prisma.tenant.findMany({
          where: { id: { in: [...tenantIds] } },
          select: { id: true, name: true, nip: true },
        });
  const nameById = new Map(tenants.map((t) => [t.id, t]));

  const merged = new Map<
    string,
    {
      tenantId: string;
      ingestionSources: number;
      integrationCredentials: number;
      integrationPos: number;
    }
  >();

  function bump(
    tenantId: string,
    field: "ingestionSources" | "integrationCredentials" | "integrationPos",
    n: number,
  ) {
    const cur = merged.get(tenantId) ?? {
      tenantId,
      ingestionSources: 0,
      integrationCredentials: 0,
      integrationPos: 0,
    };
    merged.set(tenantId, { ...cur, [field]: n });
  }

  for (const [tenantId, n] of ingestionByTenant) bump(tenantId, "ingestionSources", n);
  for (const [tenantId, n] of credentialsByTenant) bump(tenantId, "integrationCredentials", n);
  for (const [tenantId, n] of posByTenant) bump(tenantId, "integrationPos", n);

  const rows = [...merged.values()]
    .map((row) => {
      const t = nameById.get(row.tenantId);
      return {
        ...row,
        tenantName: t?.name ?? null,
        tenantNip: t?.nip ?? null,
        totalConnectors: row.ingestionSources + row.integrationCredentials + row.integrationPos,
      };
    })
    .sort((a, b) => b.totalConnectors - a.totalConnectors);

  return { rows };
}
