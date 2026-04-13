/**
 * Porównuje zestaw numerów KSeF z `POST …/query/metadata` (dateType=Issue, zakres from–to)
 * z fakturami w bazie (tenant). Wykrywa braki po stronie FV Control.
 *
 *   cd backend && npx tsx scripts/diff-ksef-issue-metadata-vs-db.ts <tenantId> 2026-04-01 2026-04-30T23:59:59.999Z
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { loadConfig } from "../src/config.js";
import { KsefClient } from "../src/modules/ksef/ksef-client.js";
import { nextMetadataQueryFrom } from "../src/modules/ksef/ksef-sync.service.js";

const prisma = new PrismaClient();
const PAGE_SIZE = 100;

function buildClient(cfg: ReturnType<typeof loadConfig>): KsefClient {
  const env = cfg.KSEF_ENV as "production" | "sandbox";
  if (cfg.KSEF_CERT && cfg.KSEF_TOKEN_PASSWORD) {
    return KsefClient.fromEncryptedCertificate(
      env,
      cfg.KSEF_TOKEN!,
      cfg.KSEF_TOKEN_PASSWORD,
      cfg.KSEF_CERT,
      cfg.KSEF_NIP!,
    );
  }
  if (cfg.KSEF_TOKEN_PASSWORD) {
    return KsefClient.fromEncryptedToken(env, cfg.KSEF_TOKEN!, cfg.KSEF_TOKEN_PASSWORD, cfg.KSEF_NIP!);
  }
  return new KsefClient(env, cfg.KSEF_NIP!, { kind: "token", ksefToken: cfg.KSEF_TOKEN! });
}

async function collectIssueMetadataNumbers(
  client: KsefClient,
  from: string,
  to: string,
  subjectTypes: ("Subject1" | "Subject2")[],
): Promise<Map<string, { issueDate: string; invoiceNumber: string }>> {
  const map = new Map<string, { issueDate: string; invoiceNumber: string }>();
  for (const subjectType of subjectTypes) {
    let pageOffset = 0;
    let hasMore = true;
    let currentFrom = from;
    while (hasMore) {
      const page = await client.queryMetadata(currentFrom, to, pageOffset, PAGE_SIZE, subjectType, "Issue");
      for (const inv of page.invoices) {
        const n = inv.ksefNumber?.trim();
        if (n) map.set(n, { issueDate: inv.issueDate?.slice(0, 10) ?? "", invoiceNumber: inv.invoiceNumber });
      }
      hasMore = page.hasMore;
      if (hasMore && page.isTruncated) {
        const last = page.invoices[page.invoices.length - 1];
        if (last) currentFrom = nextMetadataQueryFrom("Issue", last);
        pageOffset = 0;
      } else if (hasMore) {
        pageOffset++;
      }
    }
  }
  return map;
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  if (cfg.KSEF_ENV === "mock" || !cfg.KSEF_TOKEN || !cfg.KSEF_NIP) {
    console.error("KSeF nie jest skonfigurowany.");
    process.exitCode = 1;
    return;
  }

  const tenantId = process.argv[2] ?? process.env.TENANT_ID;
  const from = process.argv[3] ?? "2026-04-01T00:00:00.000Z";
  const to = process.argv[4] ?? "2026-04-30T23:59:59.999Z";
  if (!tenantId) {
    console.error("Użycie: npx tsx scripts/diff-ksef-issue-metadata-vs-db.ts <tenantId> [fromISO] [toISO]");
    process.exitCode = 1;
    return;
  }

  const client = buildClient(cfg);
  await client.authenticate();

  const subjects = [...cfg.KSEF_SYNC_SUBJECT_TYPES];
  const fromMf = await collectIssueMetadataNumbers(client, from, to, subjects);
  const numbers = [...fromMf.keys()].sort();

  const inDb =
    numbers.length === 0
      ? []
      : await prisma.invoice.findMany({
          where: {
            tenantId,
            OR: [
              { ksefNumber: { in: numbers } },
              { AND: [{ sourceExternalId: { in: numbers } }, { intakeSourceType: "KSEF_API" }] },
            ],
          },
          select: {
            id: true,
            ksefNumber: true,
            sourceExternalId: true,
            issueDate: true,
            ledgerKind: true,
            number: true,
          },
        });

  const dbByKsef = new Map<string, (typeof inDb)[0]>();
  for (const row of inDb) {
    const k = row.ksefNumber?.trim() || row.sourceExternalId?.trim();
    if (k) dbByKsef.set(k, row);
  }

  const missingInDb: string[] = [];
  for (const k of numbers) {
    if (!dbByKsef.has(k)) missingInDb.push(k);
  }

  console.log(
    JSON.stringify(
      {
        tenantId,
        from,
        to,
        uniqueKsefInIssueMetadata: numbers.length,
        invoicesMatchedInDb: inDb.length,
        missingInDbCount: missingInDb.length,
        missingInDb: missingInDb.slice(0, 200),
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
