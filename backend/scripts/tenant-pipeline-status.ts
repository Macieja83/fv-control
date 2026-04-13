/** Stan INGESTING + jobów pipeline dla tenanta. Użycie: npx tsx scripts/tenant-pipeline-status.ts <tenantUuid> */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const tenantId = process.argv[2]?.trim();
  if (!tenantId) {
    console.error("Podaj tenantId (UUID).");
    process.exitCode = 1;
    return;
  }
  const invoicesIngesting = await prisma.invoice.count({
    where: { tenantId, status: "INGESTING" },
  });
  const pipelineJobsRunnable = await prisma.processingJob.count({
    where: {
      tenantId,
      type: "INGEST_PIPELINE",
      status: { in: ["PENDING", "RUNNING"] },
      invoiceId: { not: null },
      documentId: { not: null },
    },
  });
  const pipelineJobsBroken = await prisma.processingJob.count({
    where: {
      tenantId,
      type: "INGEST_PIPELINE",
      status: { in: ["PENDING", "RUNNING"] },
      OR: [{ invoiceId: null }, { documentId: null }],
    },
  });
  console.log(
    JSON.stringify(
      { tenantId, invoicesIngesting, pipelineJobsRunnable, pipelineJobsBroken },
      null,
      2,
    ),
  );
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
