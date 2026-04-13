/**
 * Oznacza jako FAILED joby INGEST_PIPELINE w PENDING bez powiązania invoice/document
 * (np. po błędnym ręcznym odpaleniu pipeline na niekompletnych rekordach).
 *
 *   npx tsx scripts/cleanup-broken-pipeline-jobs.ts <tenantUuid> [--dry-run]
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const tenantId = process.argv.find((a) => !a.startsWith("--") && a.length === 36);
  if (!tenantId) {
    console.error("Użycie: npx tsx scripts/cleanup-broken-pipeline-jobs.ts <tenantUuid> [--dry-run]");
    process.exitCode = 1;
    return;
  }
  const where = {
    tenantId,
    type: "INGEST_PIPELINE",
    status: "PENDING" as const,
    OR: [{ invoiceId: null }, { documentId: null }],
  };
  const rows = await prisma.processingJob.findMany({
    where,
    select: { id: true, invoiceId: true, documentId: true },
  });
  console.info(JSON.stringify({ tenantId, dryRun, count: rows.length, ids: rows.map((r) => r.id) }, null, 2));
  if (dryRun || rows.length === 0) return;
  const r = await prisma.processingJob.updateMany({
    where,
    data: {
      status: "FAILED",
      lastError: "cleanup-broken-pipeline-jobs: brak invoiceId lub documentId",
    },
  });
  console.info("updated:", r.count);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
