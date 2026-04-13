/**
 * Przywraca `Invoice.primaryDocId` na dokument FA XML, gdy wskazywał na PDF podsumowania (`ksef_summary_pdf`).
 * Uruchom po wyłączeniu `KSEF_PROMOTE_SUMMARY_PDF_PRIMARY`, żeby istniejące faktury miały podgląd jak nowe.
 *
 *   cd backend && npx tsx scripts/repair-ksef-primary-xml.ts [--tenant <uuid>] [--dry-run]
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function parseArgs(): { tenantId?: string; dryRun: boolean } {
  const a = process.argv.slice(2);
  let tenantId: string | undefined;
  let dryRun = false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--tenant" && a[i + 1]) {
      tenantId = a[++i];
      continue;
    }
    if (a[i] === "--dry-run") {
      dryRun = true;
      continue;
    }
  }
  return { tenantId, dryRun };
}

async function main(): Promise<void> {
  const { tenantId, dryRun } = parseArgs();
  const invoices = await prisma.invoice.findMany({
    where: {
      intakeSourceType: "KSEF_API",
      ...(tenantId ? { tenantId } : {}),
    },
    include: { primaryDoc: true },
  });

  let checked = 0;
  let updated = 0;
  let skippedNoPdf = 0;
  let skippedNotSummary = 0;
  let skippedNoDerived = 0;
  let skippedMissingXml = 0;

  for (const inv of invoices) {
    checked++;
    const pd = inv.primaryDoc;
    if (!pd) continue;
    const mt = (pd.mimeType ?? "").toLowerCase();
    if (!mt.includes("pdf")) {
      skippedNoPdf++;
      continue;
    }
    const meta = pd.metadata as Record<string, unknown> | null;
    if (meta?.kind !== "ksef_summary_pdf") {
      skippedNotSummary++;
      continue;
    }
    const raw = meta.derivedFromDocumentId;
    if (typeof raw !== "string" || !raw.trim()) {
      skippedNoDerived++;
      continue;
    }
    const xmlId = raw.trim();
    const xml = await prisma.document.findFirst({
      where: { id: xmlId, tenantId: inv.tenantId, deletedAt: null },
    });
    if (!xml) {
      skippedMissingXml++;
      continue;
    }
    if (dryRun) {
      console.info(`[dry-run] invoice ${inv.id} primary ${inv.primaryDocId} → ${xmlId}`);
      updated++;
      continue;
    }
    await prisma.invoice.update({
      where: { id: inv.id },
      data: { primaryDocId: xmlId },
    });
    console.info(`[updated] invoice ${inv.id} primary → FA XML doc ${xmlId}`);
    updated++;
  }

  console.info(
    JSON.stringify(
      {
        tenantId: tenantId ?? "(all)",
        dryRun,
        checked,
        updated,
        skippedNoPdf,
        skippedNotSummary,
        skippedNoDerived,
        skippedMissingXml,
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
