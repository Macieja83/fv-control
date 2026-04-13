/**
 * Jednorazowe wykonanie `runPipelineJob` dla jobów `INGEST_PIPELINE` w statusie PENDING/RUNNING
 * (np. gdy worker BullMQ nie działa, a joby już są w bazie po `resumePipelineForOrphanKsefDocument`).
 *
 *   cd backend && npx tsx scripts/run-pending-pipeline-jobs.ts [tenantUuid] [--limit 30] [--dry-run]
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { runPipelineJob } from "../src/modules/pipeline/pipeline-orchestrator.js";

const prisma = new PrismaClient();

function parseArgs(): { tenantId?: string; limit: number; dryRun: boolean } {
  const a = process.argv.slice(2).filter(Boolean);
  let limit = 30;
  let dryRun = false;
  const rest: string[] = [];
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--limit" && a[i + 1]) {
      limit = Math.max(1, Math.min(200, Number.parseInt(a[++i]!, 10) || 30));
      continue;
    }
    if (a[i] === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (a[i]?.startsWith("--")) continue;
    rest.push(a[i]!);
  }
  const tenantId = rest[0]?.match(/^[0-9a-f-]{36}$/i) ? rest[0] : undefined;
  return { tenantId, limit, dryRun };
}

async function main(): Promise<void> {
  const { tenantId, limit, dryRun } = parseArgs();
  const jobs = await prisma.processingJob.findMany({
    where: {
      type: "INGEST_PIPELINE",
      status: { in: ["PENDING", "RUNNING"] },
      invoiceId: { not: null },
      documentId: { not: null },
      ...(tenantId ? { tenantId } : {}),
    },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true, tenantId: true, invoiceId: true, status: true, createdAt: true },
  });

  console.info(
    JSON.stringify(
      { tenantId: tenantId ?? "(all)", dryRun, pendingCount: jobs.length, jobIds: jobs.map((j) => j.id) },
      null,
      2,
    ),
  );

  if (dryRun || jobs.length === 0) {
    return;
  }

  for (const j of jobs) {
    try {
      console.info(`[pipeline] start job=${j.id} invoice=${j.invoiceId}`);
      await runPipelineJob(prisma, j.id);
      const after = await prisma.processingJob.findUnique({
        where: { id: j.id },
        select: { status: true, lastError: true },
      });
      console.info(`[pipeline] done job=${j.id} status=${after?.status} err=${after?.lastError ?? "—"}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[pipeline] FAILED job=${j.id}: ${msg}`);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
