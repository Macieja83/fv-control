import type { PrismaClient } from "@prisma/client";
import { AppError } from "../../lib/errors.js";

/**
 * RODO art. 20 — prawo do przenoszenia danych.
 * Klient ma prawo otrzymać swoje dane w "ustrukturyzowanym, powszechnie używanym
 * formacie nadającym się do odczytu maszynowego". JSON spełnia wymóg.
 *
 * Eksport NIE zawiera:
 * - passwordHash, refresh tokens, MFA secrets (security)
 * - zaszyfrowane KSeF credentials (klient zna własny token z portalu MF)
 * - raw XML / OCR rawPayload (large, internal)
 * - audit logs z innymi tenantami (cross-tenant leak)
 * - settings z prefixem `_internal:` (admin-only config)
 */

const RATE_LIMIT_HOURS = 24;

export type TenantDataExport = {
  meta: {
    exportedAt: string;
    exportedBy: string;
    tenantId: string;
    version: string;
    note: string;
  };
  tenant: Record<string, unknown>;
  billingCompanyData: Record<string, unknown> | null;
  users: Array<Record<string, unknown>>;
  contractors: Array<Record<string, unknown>>;
  agreements: Array<Record<string, unknown>>;
  invoices: Array<Record<string, unknown>>;
  subscriptions: Array<Record<string, unknown>>;
  stats: {
    usersCount: number;
    contractorsCount: number;
    agreementsCount: number;
    invoicesCount: number;
    subscriptionsCount: number;
  };
};

/**
 * Sprawdza czy ten tenant nie eksportował danych w ostatnich 24h.
 * Throw 429 (RATE_LIMITED) jeśli tak. Cap przez audit log lookup —
 * prosciej niz konfiguracja @fastify/rate-limit per-route, plus daje
 * audit trail "kto i kiedy" zgodnie z RODO art. 30.
 */
export async function assertExportRateLimit(
  prisma: PrismaClient,
  tenantId: string,
): Promise<void> {
  const since = new Date(Date.now() - RATE_LIMIT_HOURS * 60 * 60 * 1000);
  const recent = await prisma.auditLog.findFirst({
    where: {
      tenantId,
      action: "TENANT_DATA_EXPORTED",
      createdAt: { gte: since },
    },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (recent) {
    const nextAt = new Date(recent.createdAt.getTime() + RATE_LIMIT_HOURS * 60 * 60 * 1000);
    throw AppError.tooManyRequests(
      `Eksport danych jest dostępny raz na ${RATE_LIMIT_HOURS} godzin. Spróbuj ponownie po ${nextAt.toISOString().slice(0, 19).replace("T", " ")} UTC.`,
    );
  }
}

export async function exportTenantDataAsJson(
  prisma: PrismaClient,
  tenantId: string,
  actorEmail: string,
): Promise<TenantDataExport> {
  const tenant = await prisma.tenant.findFirst({
    where: { id: tenantId, deletedAt: null },
    select: { id: true, name: true, nip: true, createdAt: true, updatedAt: true },
  });
  if (!tenant) {
    throw AppError.notFound("Nie znaleziono firmy (tenant).");
  }

  const [users, contractors, agreements, invoices, subscriptions, billingSetting] = await Promise.all([
    prisma.user.findMany({
      where: { tenantId },
      select: {
        id: true,
        email: true,
        role: true,
        isActive: true,
        emailVerified: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.contractor.findMany({
      where: { tenantId, deletedAt: null },
      select: {
        id: true,
        name: true,
        nip: true,
        address: true,
        email: true,
        phone: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { name: "asc" },
    }),
    prisma.agreement.findMany({
      where: { tenantId },
      select: {
        id: true,
        title: true,
        subject: true,
        contractorId: true,
        counterpartyName: true,
        counterpartyNip: true,
        signedAt: true,
        validUntil: true,
        status: true,
        notes: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.invoice.findMany({
      where: { tenantId },
      select: {
        id: true,
        number: true,
        contractorId: true,
        issueDate: true,
        saleDate: true,
        dueDate: true,
        currency: true,
        netTotal: true,
        vatTotal: true,
        grossTotal: true,
        status: true,
        source: true,
        ingestionKind: true,
        sourceExternalId: true,
        notes: true,
        ledgerKind: true,
        intakeSourceType: true,
        documentKind: true,
        legalChannel: true,
        ksefRequired: true,
        ksefStatus: true,
        ksefNumber: true,
        reviewStatus: true,
        accountingStatus: true,
        reportCategory: true,
        createdAt: true,
        updatedAt: true,
        items: {
          select: {
            id: true,
            name: true,
            quantity: true,
            unit: true,
            netPrice: true,
            vatRate: true,
            netValue: true,
            grossValue: true,
          },
        },
      },
      orderBy: [{ issueDate: "desc" }, { number: "asc" }],
    }),
    prisma.subscription.findMany({
      where: { tenantId },
      select: {
        id: true,
        status: true,
        provider: true,
        planCode: true,
        billingKind: true,
        currentPeriodStart: true,
        currentPeriodEnd: true,
        trialEndsAt: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.tenantSetting.findUnique({
      where: { tenantId_key: { tenantId, key: "billing_company_data" } },
      select: { valueJson: true, updatedAt: true },
    }),
  ]);

  return {
    meta: {
      exportedAt: new Date().toISOString(),
      exportedBy: actorEmail,
      tenantId,
      version: "1.0",
      note: "Eksport danych zgodnie z art. 20 RODO. Format: JSON UTF-8. Nie zawiera passwordHash, tokenów KSeF, raw OCR ani audit logów cross-tenant.",
    },
    tenant,
    billingCompanyData: billingSetting
      ? { ...(billingSetting.valueJson as Record<string, unknown>), updatedAt: billingSetting.updatedAt }
      : null,
    users,
    contractors,
    agreements,
    invoices,
    subscriptions,
    stats: {
      usersCount: users.length,
      contractorsCount: contractors.length,
      agreementsCount: agreements.length,
      invoicesCount: invoices.length,
      subscriptionsCount: subscriptions.length,
    },
  };
}
