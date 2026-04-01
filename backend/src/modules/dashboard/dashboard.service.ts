import type { PrismaClient } from "@prisma/client";

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export async function getOperationalDashboard(prisma: PrismaClient, tenantId: string) {
  const today = startOfUtcDay(new Date());
  const tomorrow = new Date(today);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

  const [
    ingestedToday,
    failedJobs,
    duplicatesOpen,
    queuePending,
    invoicesByStatus,
    mailboxes,
    ingestionSources,
  ] = await Promise.all([
    prisma.document.count({
      where: { tenantId, createdAt: { gte: today, lt: tomorrow }, deletedAt: null },
    }),
    prisma.processingJob.count({
      where: { tenantId, status: { in: ["FAILED", "DEAD_LETTER"] } },
    }),
    prisma.invoiceDuplicate.count({
      where: { tenantId, resolution: "OPEN" },
    }),
    prisma.processingJob.count({
      where: { tenantId, status: { in: ["PENDING", "RUNNING"] } },
    }),
    prisma.invoice.groupBy({
      by: ["status"],
      where: { tenantId },
      _count: { _all: true },
    }),
    prisma.mailbox.findMany({
      where: { tenantId },
      include: { syncState: true, credential: { select: { id: true, connector: true, label: true, isActive: true } } },
    }),
    prisma.ingestionSource.findMany({ where: { tenantId } }),
  ]);

  return {
    kpi: {
      documentsIngestedToday: ingestedToday,
      failedOrDlqJobs: failedJobs,
      duplicatesOpen,
      queueDepthActive: queuePending,
    },
    invoicesByStatus: Object.fromEntries(invoicesByStatus.map((r) => [r.status, r._count._all])) as Record<
      string,
      number
    >,
    connectors: {
      mailboxes: mailboxes.map((m) => ({
        id: m.id,
        label: m.label,
        provider: m.provider,
        isActive: m.isActive,
        sync: m.syncState
          ? {
              historyId: m.syncState.historyId,
              uidValidity: m.syncState.uidValidity,
              uidNext: m.syncState.uidNext,
              lastSyncedAt: m.syncState.lastSyncedAt,
              lastError: m.syncState.lastError,
            }
          : null,
      })),
      ingestionSources: ingestionSources.map((s) => ({
        id: s.id,
        kind: s.kind,
        label: s.label,
        isEnabled: s.isEnabled,
      })),
    },
  };
}

export async function listReviewQueue(prisma: PrismaClient, tenantId: string, limit: number) {
  return prisma.invoice.findMany({
    where: {
      tenantId,
      status: { in: ["FAILED_NEEDS_REVIEW", "PENDING_REVIEW"] },
    },
    orderBy: { updatedAt: "desc" },
    take: limit,
    include: {
      contractor: { select: { id: true, name: true, nip: true } },
      primaryDoc: { select: { id: true, sha256: true, mimeType: true } },
    },
  });
}
