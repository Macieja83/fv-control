/**
 * Jednorazowa synchronizacja pól compliance (duplicateScore) dla faktur
 * uczestniczących w otwartych parach duplikatów — np. po wdrożeniu liczenia
 * „canonical” (oryginał KSeF) po stronie `refreshInvoiceCompliance`.
 *
 * Uruchom na VPS: `cd backend && npx tsx scripts/refresh-open-duplicate-compliance.ts`
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { refreshInvoiceCompliance } from "../src/modules/compliance/compliance.service.js";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const pairs = await prisma.invoiceDuplicate.findMany({
    where: { resolution: "OPEN" },
    select: { tenantId: true, candidateInvoiceId: true, canonicalInvoiceId: true },
  });
  const todo = new Map<string, string>();
  for (const p of pairs) {
    todo.set(p.candidateInvoiceId, p.tenantId);
    todo.set(p.canonicalInvoiceId, p.tenantId);
  }
  let n = 0;
  for (const [invoiceId, tenantId] of todo) {
    await refreshInvoiceCompliance(prisma, tenantId, invoiceId, {}, {
      eventType: "COMPLIANCE_VALIDATED",
      enqueueDuplicate: false,
      enqueueClassified: false,
    });
    n++;
  }
  console.info(`refresh-open-duplicate-compliance: odświeżono ${n} faktur (${pairs.length} par OPEN).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
