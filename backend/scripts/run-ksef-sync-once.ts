/**
 * Jednorazowy sync KSeF z poziomu shell (VPS / dev), bez JWT.
 *
 *   cd backend && npx tsx scripts/run-ksef-sync-once.ts --from 2026-04-10T00:00:00.000Z
 *   npx tsx scripts/run-ksef-sync-once.ts --tenant <uuid> --from 2026-04-01T00:00:00.000Z --to 2026-04-30T23:59:59.999Z
 *
 * `--to` zawęża **tylko** przebieg metadanych `Issue` (data wystawienia); `PermanentStorage` nadal do „teraz”.
 * Przy `--to` **nie zapisujemy** `hwmDate` (bezpieczne na produkcji przy uzupełnianiu jednego miesiąca).
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { runKsefSyncJob } from "../src/modules/ksef/ksef-sync.service.js";

const prisma = new PrismaClient();

function parseArgs(): { fromDate?: string; toDate?: string; tenantId?: string } {
  let fromDate: string | undefined;
  let toDate: string | undefined;
  let tenantId: string | undefined;
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--from" && a[i + 1]) {
      fromDate = a[++i];
      continue;
    }
    if (a[i] === "--to" && a[i + 1]) {
      toDate = a[++i];
      continue;
    }
    if (a[i] === "--tenant" && a[i + 1]) {
      tenantId = a[++i];
      continue;
    }
  }
  return { fromDate, toDate, tenantId };
}

async function main(): Promise<void> {
  const { fromDate, toDate, tenantId: tidArg } = parseArgs();
  const tenantId =
    tidArg ??
    (
      await prisma.ingestionSource.findFirst({
        where: { kind: "KSEF" },
        select: { tenantId: true },
      })
    )?.tenantId ??
    (await prisma.tenant.findFirst({ select: { id: true } }))?.id;
  if (!tenantId) {
    console.error("run-ksef-sync-once: brak tenantId (ustaw --tenant lub źródło KSEF w bazie).");
    process.exitCode = 1;
    return;
  }
  console.info(
    `run-ksef-sync-once: tenantId=${tenantId} fromDate=${fromDate ?? "(hwm / domyślny zakres)"} toDate=${toDate ?? "(teraz)"}`,
  );
  const r = await runKsefSyncJob(prisma, { tenantId, fromDate, toDate });
  console.info("wynik:", JSON.stringify(r, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
