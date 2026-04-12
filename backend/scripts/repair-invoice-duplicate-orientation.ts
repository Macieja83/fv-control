/**
 * Naprawa otwartych par duplikatów: canonical = faktura z KSeF (KSEF_API lub `ksefNumber`), candidate = pozostałe.
 * Uruchom: `cd backend && npx tsx scripts/repair-invoice-duplicate-orientation.ts`
 * Potem (opcjonalnie): `npm run refresh:dup-compliance`
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { orientInvoiceDuplicateRoles } from "../src/domain/deduplication/duplicate-score.js";
import { refreshInvoiceCompliance } from "../src/modules/compliance/compliance.service.js";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const open = await prisma.invoiceDuplicate.findMany({
    where: { resolution: "OPEN" },
    select: { id: true, tenantId: true, candidateInvoiceId: true, canonicalInvoiceId: true },
  });

  let fixed = 0;
  for (const row of open) {
    const [a, b] = await Promise.all([
      prisma.invoice.findUnique({
        where: { id: row.candidateInvoiceId },
        select: { id: true, intakeSourceType: true, createdAt: true, ksefNumber: true },
      }),
      prisma.invoice.findUnique({
        where: { id: row.canonicalInvoiceId },
        select: { id: true, intakeSourceType: true, createdAt: true, ksefNumber: true },
      }),
    ]);
    if (!a || !b) continue;

    const { canonicalId, candidateId } = orientInvoiceDuplicateRoles(a, b);
    if (canonicalId === row.canonicalInvoiceId && candidateId === row.candidateInvoiceId) continue;

    await prisma.invoiceDuplicate.update({
      where: { id: row.id },
      data: { canonicalInvoiceId: canonicalId, candidateInvoiceId: candidateId },
    });
    fixed++;
    for (const invoiceId of [canonicalId, candidateId]) {
      await refreshInvoiceCompliance(prisma, row.tenantId, invoiceId, {}, {
        eventType: "COMPLIANCE_VALIDATED",
        enqueueDuplicate: false,
        enqueueClassified: false,
      });
    }
  }

  console.info(
    `repair-invoice-duplicate-orientation: sprawdzono ${open.length} par OPEN, poprawiono ${fixed}.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
