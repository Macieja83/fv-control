import type { AuditEntityType, PrismaClient } from "@prisma/client";

function titleForAction(action: string): string {
  switch (action) {
    case "PIPELINE_COMPLETED":
      return "Faktura przetworzona";
    case "INVOICE_INTAKE":
      return "Nowa faktura (upload)";
    case "AGREEMENT_UPLOADED":
      return "Dodano umowę (plik)";
    case "AGREEMENT_EXTRACTED":
      return "Odczytano dane z umowy";
    case "AGREEMENT_EXTRACT_FAILED":
      return "Błąd odczytu umowy";
    case "PORTAL_INTEGRATIONS_UPDATED":
      return "Zaktualizowano integracje";
    case "TENANT_PROFILE_UPDATED":
      return "Zaktualizowano dane firmy";
    case "KSEF_API_ENV_UPDATED":
      return "Zmieniono środowisko API KSeF";
    case "KSEF_SYNC_JOB_EXHAUSTED":
      return "KSeF sync — wyczerpane ponowienia (kolejka)";
    case "KSEF_SYNC_RUN_FAILED":
      return "KSeF sync — błąd przebiegu";
    case "PLATFORM_ADMIN_IMPERSONATION":
      return "Wejście operatora (impersonacja)";
    default:
      return action.replace(/_/g, " ");
  }
}

export async function listActivity(prisma: PrismaClient, tenantId: string, limit: number) {
  const rows = await prisma.auditLog.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 200),
    include: {
      actor: { select: { email: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt,
    action: r.action,
    title: titleForAction(r.action),
    entityType: r.entityType as AuditEntityType,
    entityId: r.entityId,
    actorEmail: r.actor?.email ?? null,
    metadata: r.metadata,
  }));
}
