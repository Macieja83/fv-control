/**
 * Ustawia `Invoice.issueDate` zgodnie z `issueDate` w metadanych dokumentu KSeF (sync MF)
 * i przelicza `fingerprint`, żeby nie rozjeżdżać deduplikacji.
 * Gdy pipeline/OCR nadpisał datę (np. pełne ISO z offsetem → inny dzień w UTC), faktura
 * nie wchodzi w widok miesiąca zgodny z portalem, choć sync zwraca same duplikaty (`ingested=0`).
 *
 *   cd backend && npx tsx scripts/repair-ksef-issue-dates-from-doc-metadata.ts <tenantId> [--dry-run]
 *
 * Tylko faktury, których **data w metadanych KSeF** zaczyna się od prefiksu (np. kwiecień 2026):
 *   npx tsx scripts/repair-ksef-issue-dates-from-doc-metadata.ts <tenantId> --only-meta-prefix 2026-04
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { buildInvoiceFingerprint } from "../src/domain/deduplication/invoice-fingerprint.js";
import { parseInvoiceDate } from "../src/modules/invoices/invoice-dates.js";

const prisma = new PrismaClient();

function ymdFromDbIssue(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function issueYmdFromMetadata(meta: Record<string, unknown> | null | undefined): string | null {
  if (!meta) return null;
  const raw = meta.issueDate;
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  if (t.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  return null;
}

async function resolveKsefXmlDoc(
  tenantId: string,
  ksefNum: string,
  primary: { id: string; sourceType: string; mimeType: string | null; metadata: unknown } | null,
): Promise<{ id: string; metadata: unknown } | null> {
  const fromDb = await prisma.document.findFirst({
    where: { tenantId, sourceType: "KSEF", sourceExternalId: ksefNum, deletedAt: null },
    select: { id: true, metadata: true },
  });
  if (fromDb) return fromDb;
  if (!primary) return null;
  const mime = (primary.mimeType ?? "").toLowerCase();
  if (primary.sourceType === "KSEF" && (mime.includes("xml") || mime.includes("text/xml"))) {
    return prisma.document.findUnique({
      where: { id: primary.id },
      select: { id: true, metadata: true },
    });
  }
  if (mime.includes("pdf")) {
    const meta = primary.metadata as { derivedFromDocumentId?: unknown } | null;
    const derived =
      typeof meta?.derivedFromDocumentId === "string" && meta.derivedFromDocumentId.trim().length > 0
        ? meta.derivedFromDocumentId.trim()
        : null;
    if (derived) {
      return prisma.document.findFirst({
        where: { id: derived, tenantId, deletedAt: null },
        select: { id: true, metadata: true },
      });
    }
  }
  return null;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter(Boolean);
  const dryRun = args.includes("--dry-run");
  const prefixIdx = args.indexOf("--only-meta-prefix");
  const onlyMetaPrefix =
    prefixIdx >= 0 && args[prefixIdx + 1] ? String(args[prefixIdx + 1]).trim() : null;
  const tenantId = args.find((a) => !a.startsWith("--")) ?? process.env.TENANT_ID;
  if (!tenantId) {
    console.error("Podaj tenantId (UUID) jako pierwszy argument lub TENANT_ID.");
    process.exitCode = 1;
    return;
  }

  const invoices = await prisma.invoice.findMany({
    where: { tenantId, intakeSourceType: "KSEF_API" },
    select: {
      id: true,
      issueDate: true,
      number: true,
      currency: true,
      grossTotal: true,
      ksefNumber: true,
      sourceExternalId: true,
      contractor: { select: { nip: true } },
      primaryDoc: {
        select: { id: true, sourceType: true, mimeType: true, metadata: true },
      },
    },
  });

  let checked = 0;
  let updated = 0;
  let skippedNoKsef = 0;
  let skippedNoDoc = 0;
  let skippedNoMetaYmd = 0;
  let skippedPrefix = 0;
  let skippedSame = 0;

  for (const inv of invoices) {
    checked++;
    const ksefNum = inv.ksefNumber?.trim() || inv.sourceExternalId?.trim() || "";
    if (!ksefNum) {
      skippedNoKsef++;
      continue;
    }
    const xmlDoc = await resolveKsefXmlDoc(tenantId, ksefNum, inv.primaryDoc);
    if (!xmlDoc) {
      skippedNoDoc++;
      continue;
    }
    const metaYmd = issueYmdFromMetadata(xmlDoc.metadata as Record<string, unknown> | null);
    if (!metaYmd) {
      skippedNoMetaYmd++;
      continue;
    }
    if (onlyMetaPrefix && !metaYmd.startsWith(onlyMetaPrefix)) {
      skippedPrefix++;
      continue;
    }
    const currentYmd = ymdFromDbIssue(inv.issueDate);
    if (metaYmd === currentYmd) {
      skippedSame++;
      continue;
    }
    const nextIssue = parseInvoiceDate(metaYmd);
    const fingerprint = buildInvoiceFingerprint({
      contractorNip: inv.contractor?.nip ?? null,
      number: inv.number,
      issueDateIso: nextIssue.toISOString(),
      grossTotal: inv.grossTotal.toString(),
      currency: inv.currency,
    });
    if (dryRun) {
      console.log(`[dry-run] ${inv.id} issueDate ${currentYmd} → ${metaYmd} (${ksefNum})`);
      updated++;
      continue;
    }
    await prisma.invoice.update({
      where: { id: inv.id },
      data: { issueDate: nextIssue, fingerprint },
    });
    console.log(`[updated] ${inv.id} ${currentYmd} → ${metaYmd} (${ksefNum})`);
    updated++;
  }

  console.log(
    JSON.stringify(
      {
        tenantId,
        dryRun,
        onlyMetaPrefix,
        checked,
        updated,
        skippedNoKsef,
        skippedNoDoc,
        skippedNoMetaYmd,
        skippedPrefix,
        skippedSame,
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
