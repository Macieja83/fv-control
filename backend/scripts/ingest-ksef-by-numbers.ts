/**
 * Ingest wybranych faktur KSeF po numerze (pobranie XML z API), gdy pełny sync zwraca same duplikaty,
 * a w bazie nadal brakuje rekordów widocznych w metadanych MF.
 *
 *   cd backend && npx tsx scripts/ingest-ksef-by-numbers.ts --tenant <uuid> NUM1 NUM2 ...
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { loadConfig } from "../src/config.js";
import { KsefClient } from "../src/modules/ksef/ksef-client.js";
import { createInvoiceXmlThrottle, ingestKsefInvoiceXmlByKsefNumber } from "../src/modules/ksef/ksef-sync.service.js";

const prisma = new PrismaClient();

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

function parseArgs(): { tenantId?: string; numbers: string[] } {
  const numbers: string[] = [];
  let tenantId: string | undefined;
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--tenant" && a[i + 1]) {
      tenantId = a[++i];
      continue;
    }
    if (a[i]?.startsWith("--")) {
      console.warn(`nieznany argument: ${a[i]} — pomijam`);
      continue;
    }
    numbers.push(a[i]!);
  }
  return { tenantId, numbers };
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  if (cfg.KSEF_ENV === "mock" || !cfg.KSEF_TOKEN || !cfg.KSEF_NIP) {
    console.error("ingest-ksef-by-numbers: KSeF nie jest skonfigurowany (mock lub brak tokenu/NIP).");
    process.exitCode = 1;
    return;
  }

  const { tenantId: tidArg, numbers } = parseArgs();
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
    console.error("ingest-ksef-by-numbers: brak tenantId — ustaw --tenant lub źródło KSEF w bazie.");
    process.exitCode = 1;
    return;
  }
  if (numbers.length === 0) {
    console.error(
      "Użycie: npx tsx scripts/ingest-ksef-by-numbers.ts [--tenant <uuid>] <ksefNumber> [<ksefNumber> ...]",
    );
    process.exitCode = 1;
    return;
  }

  const client = buildClient(cfg);
  console.info(`ingest-ksef-by-numbers: tenantId=${tenantId} count=${numbers.length}`);
  console.info("[KSeF] Authenticating…");
  await client.authenticate();
  console.info("[KSeF] Authenticated.");

  const beforeXmlFetch = createInvoiceXmlThrottle(cfg.KSEF_INVOICE_FETCH_MIN_INTERVAL_MS);
  const results: Array<{ number: string; outcome: string }> = [];

  for (const n of numbers) {
    try {
      const o = await ingestKsefInvoiceXmlByKsefNumber(prisma, client, tenantId, n, beforeXmlFetch);
      results.push({ number: n, outcome: o });
      console.info(`  ${n} → ${o}${o === "linked" ? " (uzupełniono ksefNumber na istniejącej fakturze)" : ""}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push({ number: n, outcome: `ERROR: ${msg}` });
      console.error(`  ${n} → ERROR: ${msg}`);
    }
  }

  const ingested = results.filter((r) => r.outcome === "ingested").length;
  const linked = results.filter((r) => r.outcome === "linked").length;
  const skipped = results.filter((r) => r.outcome === "skipped").length;
  const errors = results.filter((r) => r.outcome.startsWith("ERROR")).length;
  console.info(`Podsumowanie: ingested=${ingested}, linked=${linked}, skipped=${skipped}, errors=${errors}`);
  console.info(JSON.stringify({ tenantId, results }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
