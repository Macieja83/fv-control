/**
 * Liczy faktury w zakresie `issueDate` (tak samo jak lista w API / FV Control po Od–Do).
 * Przydatne przy porównaniu z portalem KSeF — portal może domyślnie filtrować po innej dacie
 * (np. zapis w repozytorium), a tutaj liczymy po dacie wystawienia z faktury.
 *
 * Użycie:
 *   cd backend && npx tsx scripts/stats-invoices-issue-range.ts <tenantId> <YYYY-MM-DD> <YYYY-MM-DD> [PURCHASE|SALE]
 *
 * Przykład:
 *   npx tsx scripts/stats-invoices-issue-range.ts $TENANT_ID 2026-04-01 2026-04-30 PURCHASE
 */
import "dotenv/config";
import type { InvoiceLedgerKind } from "@prisma/client";
import { PrismaClient } from "@prisma/client";
import { parseInvoiceDate, parseInvoiceDateInclusiveEndUtc } from "../src/modules/invoices/invoice-dates.js";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const tenantId = process.argv[2] ?? process.env.TENANT_ID;
  const dateFrom = process.argv[3] ?? "2026-04-01";
  const dateTo = process.argv[4] ?? "2026-04-30";
  const ledgerArg = (process.argv[5] ?? "PURCHASE").toUpperCase();
  const ledgerKind = (ledgerArg === "SALE" ? "SALE" : "PURCHASE") as InvoiceLedgerKind;

  if (!tenantId) {
    console.error("Podaj tenantId (UUID) jako pierwszy argument lub ustaw TENANT_ID.");
    process.exitCode = 1;
    return;
  }

  const issueDate = {
    gte: parseInvoiceDate(dateFrom),
    lte: parseInvoiceDateInclusiveEndUtc(dateTo),
  };

  const whereBase = { tenantId, issueDate, ledgerKind };

  const total = await prisma.invoice.count({ where: whereBase });
  const byIntake = await prisma.invoice.groupBy({
    by: ["intakeSourceType"],
    where: whereBase,
    _count: { _all: true },
  });
  const byStatus = await prisma.invoice.groupBy({
    by: ["status"],
    where: whereBase,
    _count: { _all: true },
  });

  const ksefOnly = await prisma.invoice.count({
    where: { ...whereBase, intakeSourceType: "KSEF_API" },
  });

  console.log(
    JSON.stringify(
      {
        tenantId,
        dateFrom,
        dateTo,
        ledgerKind,
        total,
        ksefApiOnly: ksefOnly,
        byIntakeSourceType: Object.fromEntries(byIntake.map((r) => [r.intakeSourceType, r._count._all])),
        byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r._count._all])),
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
