/**
 * Usuwa otwarte rekordy `invoice_duplicates`, gdzie **oba** końce to faktury z repozytorium KSeF
 * (numer KSeF lub `intakeSourceType === KSEF_API`). Takie pary nie powinny istnieć po poprawce w pipeline.
 *
 * VPS: `cd backend && npx tsx scripts/cleanup-ksef-ksef-open-duplicates.ts`
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { areBothKsefRepositoryInvoices } from "../src/domain/deduplication/duplicate-score.js";
import { refreshInvoiceCompliance } from "../src/modules/compliance/compliance.service.js";

const prisma = new PrismaClient();

function role(inv: {
  id: string;
  intakeSourceType: string;
  ksefNumber: string | null;
  createdAt: Date;
}) {
  return {
    id: inv.id,
    intakeSourceType: inv.intakeSourceType,
    createdAt: inv.createdAt,
    ksefNumber: inv.ksefNumber,
  };
}

async function main(): Promise<void> {
  const open = await prisma.invoiceDuplicate.findMany({
    where: { resolution: "OPEN" },
    include: {
      candidate: {
        select: { id: true, intakeSourceType: true, ksefNumber: true, createdAt: true, number: true },
      },
      canonical: {
        select: { id: true, intakeSourceType: true, ksefNumber: true, createdAt: true, number: true },
      },
    },
  });
  const toDelete: string[] = [];
  const touched = new Set<string>();
  for (const row of open) {
    if (areBothKsefRepositoryInvoices(role(row.candidate), role(row.canonical))) {
      toDelete.push(row.id);
      touched.add(row.candidateInvoiceId);
      touched.add(row.canonicalInvoiceId);
      console.info(
        `[cleanup] KSeF↔KSeF OPEN: ${row.candidate.number} (${row.candidate.intakeSourceType}) ↔ ${row.canonical.number} (${row.canonical.intakeSourceType})`,
      );
    }
  }
  if (toDelete.length === 0) {
    console.info("cleanup-ksef-ksef-open-duplicates: brak par OPEN KSeF↔KSeF.");
    return;
  }
  const del = await prisma.invoiceDuplicate.deleteMany({ where: { id: { in: toDelete } } });
  console.info(`cleanup-ksef-ksef-open-duplicates: usunięto ${del.count} wierszy invoice_duplicates.`);
  for (const invoiceId of touched) {
    const inv = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: { tenantId: true },
    });
    if (!inv) continue;
    await refreshInvoiceCompliance(prisma, inv.tenantId, invoiceId, {}, {
      eventType: "COMPLIANCE_VALIDATED",
      enqueueDuplicate: false,
      enqueueClassified: false,
    });
  }
  console.info(`cleanup-ksef-ksef-open-duplicates: odświeżono compliance dla ${touched.size} faktur.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
