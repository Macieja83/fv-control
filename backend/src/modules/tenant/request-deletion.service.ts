import type { PrismaClient } from "@prisma/client";
import { AppError } from "../../lib/errors.js";

/**
 * RODO art. 17 — prawo do bycia zapomnianym.
 *
 * Flow:
 * 1. Klient (OWNER/ADMIN) wywołuje POST /tenant/request-deletion
 * 2. Soft delete: Tenant.deletedAt = now, wszystkie users tego tenanta dostają isActive=false
 * 3. Grace period 30 dni: deletion_grace_until = now + 30d (w TenantSetting JSON)
 * 4. W grace period klient może wywołać POST /tenant/cancel-deletion → un-delete
 * 5. Po grace cron `prisma:hard-delete-tenants` (spec poniżej) trwale kasuje rekordy
 *
 * Compliance:
 * - Eksport danych (X1 /tenant/data-export) jest dostępny przed deletion request (klient powinien wykonać go zanim)
 * - Audit log "TENANT_DELETION_REQUESTED" + "TENANT_DELETION_CANCELED" + "TENANT_HARD_DELETED" — wymagane przez RODO art. 30
 * - Aktywna subskrypcja blokuje request → najpierw anuluj subskrypcję (Stripe portal)
 *
 * Hard delete cron (FUTURE — osobny skrypt scripts/hard-delete-expired-tenants.ts):
 *   SELECT id FROM tenants WHERE deletedAt IS NOT NULL AND <grace_until> < NOW()
 *   FOR EACH: prisma.tenant.delete({where: {id}}) — kaskada przez onDelete: Cascade w schema
 *   Audit log w osobnej tabeli "tenant_deletion_history" (bo audit_logs same kaskaduja sie z tenantem)
 *   Email "Konto zostalo trwale usuniete" do byłych adminów
 */

const GRACE_PERIOD_DAYS = 30;
const DELETION_GRACE_KEY = "deletion_grace_until";

export type DeletionStatus = {
  isDeletionPending: boolean;
  graceUntil: string | null;
  daysRemaining: number | null;
};

export async function getDeletionStatus(
  prisma: PrismaClient,
  tenantId: string,
): Promise<DeletionStatus> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { deletedAt: true },
  });
  if (!tenant) {
    throw AppError.notFound("Nie znaleziono firmy (tenant).");
  }
  if (!tenant.deletedAt) {
    return { isDeletionPending: false, graceUntil: null, daysRemaining: null };
  }
  const setting = await prisma.tenantSetting.findUnique({
    where: { tenantId_key: { tenantId, key: DELETION_GRACE_KEY } },
    select: { valueJson: true },
  });
  const graceUntilIso = (setting?.valueJson as { until?: string } | null)?.until ?? null;
  if (!graceUntilIso) {
    return { isDeletionPending: true, graceUntil: null, daysRemaining: null };
  }
  const graceUntil = new Date(graceUntilIso);
  const msRemaining = graceUntil.getTime() - Date.now();
  const daysRemaining = Math.max(0, Math.ceil(msRemaining / (1000 * 60 * 60 * 24)));
  return {
    isDeletionPending: true,
    graceUntil: graceUntilIso,
    daysRemaining,
  };
}

export async function requestTenantDeletion(
  prisma: PrismaClient,
  tenantId: string,
  actorId: string,
): Promise<{ graceUntil: string; daysRemaining: number; adminEmails: string[] }> {
  // 1. Tenant musi istnieć i nie być już skasowany
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, deletedAt: true },
  });
  if (!tenant) {
    throw AppError.notFound("Nie znaleziono firmy (tenant).");
  }
  if (tenant.deletedAt) {
    throw AppError.conflict(
      "Konto jest już w trakcie usuwania. Możesz anulować przez POST /tenant/cancel-deletion w okresie 30-dniowej karencji.",
    );
  }

  // 2. Aktywna subskrypcja blokuje deletion — najpierw anuluj w Stripe portal
  const activeSub = await prisma.subscription.findFirst({
    where: {
      tenantId,
      status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] },
    },
    select: { id: true, status: true },
  });
  if (activeSub) {
    throw AppError.conflict(
      `Najpierw anuluj aktywną subskrypcję (status: ${activeSub.status}) w panelu rozliczeniowym, potem zgłoś usunięcie konta.`,
    );
  }

  // 3. Wyznacz grace period + zapisz w TenantSetting
  const graceUntil = new Date(Date.now() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);

  // 4. Transakcja: soft delete tenant + deactivate users + zapisz grace
  const adminUsers = await prisma.user.findMany({
    where: { tenantId, role: { in: ["OWNER", "ADMIN"] }, isActive: true },
    select: { email: true },
  });

  await prisma.$transaction([
    prisma.tenant.update({
      where: { id: tenantId },
      data: { deletedAt: new Date() },
    }),
    prisma.user.updateMany({
      where: { tenantId },
      data: { isActive: false },
    }),
    prisma.tenantSetting.upsert({
      where: { tenantId_key: { tenantId, key: DELETION_GRACE_KEY } },
      create: {
        tenantId,
        key: DELETION_GRACE_KEY,
        valueJson: { until: graceUntil.toISOString(), requestedBy: actorId },
      },
      update: {
        valueJson: { until: graceUntil.toISOString(), requestedBy: actorId },
      },
    }),
  ]);

  return {
    graceUntil: graceUntil.toISOString(),
    daysRemaining: GRACE_PERIOD_DAYS,
    adminEmails: adminUsers.map((u) => u.email),
  };
}

export async function cancelTenantDeletion(
  prisma: PrismaClient,
  tenantId: string,
): Promise<{ adminEmails: string[] }> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, deletedAt: true },
  });
  if (!tenant) {
    throw AppError.notFound("Nie znaleziono firmy (tenant).");
  }
  if (!tenant.deletedAt) {
    throw AppError.conflict("Konto nie jest w trakcie usuwania — nie ma co anulować.");
  }

  // Sprawdź czy grace period jeszcze trwa
  const setting = await prisma.tenantSetting.findUnique({
    where: { tenantId_key: { tenantId, key: DELETION_GRACE_KEY } },
    select: { valueJson: true },
  });
  const graceUntilIso = (setting?.valueJson as { until?: string } | null)?.until;
  if (graceUntilIso) {
    const graceUntil = new Date(graceUntilIso);
    if (graceUntil.getTime() < Date.now()) {
      throw AppError.forbidden(
        "Okres karencji (30 dni) minął — konto zostało trwale usunięte i nie można go już przywrócić. Zarejestruj nowe konto.",
      );
    }
  }

  const adminEmails = await prisma.user.findMany({
    where: { tenantId, role: { in: ["OWNER", "ADMIN"] } },
    select: { email: true },
  });

  await prisma.$transaction([
    prisma.tenant.update({
      where: { id: tenantId },
      data: { deletedAt: null },
    }),
    prisma.user.updateMany({
      where: { tenantId },
      data: { isActive: true },
    }),
    prisma.tenantSetting.delete({
      where: { tenantId_key: { tenantId, key: DELETION_GRACE_KEY } },
    }),
  ]);

  return { adminEmails: adminEmails.map((u) => u.email) };
}
