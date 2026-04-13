/** Diagnostyka jednego numeru KSeF: dokumenty i faktury (wszystkie tenanty — ostrożnie na prod). */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const kn = process.argv[2]?.trim();
  if (!kn) {
    console.error("Użycie: npx tsx scripts/diagnose-ksef-number.ts <ksefNumber>");
    process.exitCode = 1;
    return;
  }
  const docs = await prisma.document.findMany({
    where: { sourceType: "KSEF", sourceExternalId: kn, deletedAt: null },
    select: { id: true, tenantId: true, mimeType: true, metadata: true },
  });
  const invByKsef = await prisma.invoice.findMany({
    where: { ksefNumber: kn },
    select: {
      id: true,
      tenantId: true,
      ksefNumber: true,
      sourceExternalId: true,
      primaryDocId: true,
      intakeSourceType: true,
    },
  });
  const invByExt = await prisma.invoice.findMany({
    where: { sourceExternalId: kn },
    select: {
      id: true,
      tenantId: true,
      ksefNumber: true,
      sourceExternalId: true,
      primaryDocId: true,
      intakeSourceType: true,
    },
  });
  const invByPrimary =
    docs.length > 0
      ? await prisma.invoice.findMany({
          where: { primaryDocId: { in: docs.map((d) => d.id) } },
          select: {
            id: true,
            tenantId: true,
            ksefNumber: true,
            sourceExternalId: true,
            primaryDocId: true,
            intakeSourceType: true,
          },
        })
      : [];
  console.log(JSON.stringify({ kn, docs, invByKsef, invByExt, invByPrimary }, null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
