/**
 * Diagnostyka faktur/dokumentów/jobów pipeline (np. KSeF „nie załadowało”).
 * Użycie: `cd backend && npx tsx scripts/diagnose-invoices.ts <invoiceId> [invoiceId2...]`
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const ids = process.argv.slice(2).filter(Boolean);
  if (ids.length === 0) {
    console.error("Podaj co najmniej jeden UUID faktury.");
    process.exitCode = 1;
    return;
  }

  const inv = await prisma.invoice.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      tenantId: true,
      number: true,
      status: true,
      intakeSourceType: true,
      ksefNumber: true,
      primaryDocId: true,
      createdAt: true,
      sourceExternalId: true,
    },
  });
  console.log("=== invoices ===\n", JSON.stringify(inv, null, 2));

  const docIds = inv.map((i) => i.primaryDocId).filter((x): x is string => Boolean(x));
  if (docIds.length) {
    const docs = await prisma.document.findMany({
      where: { id: { in: docIds } },
      select: {
        id: true,
        tenantId: true,
        sourceType: true,
        mimeType: true,
        sizeBytes: true,
        storageKey: true,
        storageBucket: true,
        sourceExternalId: true,
        createdAt: true,
      },
    });
    console.log("\n=== documents (primaryDoc) ===\n", JSON.stringify(docs, null, 2));
  }

  const jobs = await prisma.processingJob.findMany({
    where: { invoiceId: { in: ids } },
    orderBy: { createdAt: "desc" },
    take: 12,
    select: {
      id: true,
      invoiceId: true,
      status: true,
      lastError: true,
      attemptCount: true,
      createdAt: true,
      type: true,
    },
  });
  console.log("\n=== processing_jobs (latest) ===\n", JSON.stringify(jobs, null, 2));

  const jobIds = jobs.map((j) => j.id);
  if (jobIds.length) {
    const att = await prisma.processingAttempt.findMany({
      where: { jobId: { in: jobIds } },
      orderBy: [{ jobId: "asc" }, { attemptNo: "desc" }],
      take: 40,
      select: { jobId: true, attemptNo: true, step: true, message: true, errorClass: true },
    });
    console.log("\n=== processing_attempts (recent) ===\n", JSON.stringify(att, null, 2));
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
