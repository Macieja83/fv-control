/**
 * Ponownie pobiera XML z API KSeF i zapisuje w aktualnym storage, potem kolejkuje pipeline.
 * Użycie (na serwerze z .env): `cd backend && npx tsx scripts/rehydrate-ksef-invoice-xml.ts <invoiceId> [id2...]`
 */
import { createHash, randomUUID } from "node:crypto";
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { createObjectStorage } from "../src/adapters/storage/create-storage.js";
import { loadConfig } from "../src/config.js";
import { getPipelineQueue } from "../src/lib/pipeline-queue.js";
import { PIPELINE_QUEUE_NAME } from "../src/lib/queue-constants.js";
import { KsefClient } from "../src/modules/ksef/ksef-client.js";

const prisma = new PrismaClient();

function buildKsefClient(cfg: ReturnType<typeof loadConfig>): KsefClient {
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

async function rehydrateOne(client: KsefClient, invoiceId: string): Promise<void> {
  const inv = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { primaryDoc: true },
  });
  if (!inv?.primaryDoc) {
    console.warn(`[skip] ${invoiceId}: brak faktury lub dokumentu.`);
    return;
  }
  const doc = inv.primaryDoc;
  if (doc.sourceType !== "KSEF") {
    console.warn(`[skip] ${invoiceId}: dokument nie jest KSEF.`);
    return;
  }
  const ksefNum = (doc.sourceExternalId ?? inv.sourceExternalId)?.trim();
  if (!ksefNum) {
    console.warn(`[skip] ${invoiceId}: brak numeru KSeF (sourceExternalId).`);
    return;
  }

  console.info(`[fetch] ${invoiceId} ksefNumber=${ksefNum}`);
  const xml = await client.fetchInvoiceXml(ksefNum);
  const buf = Buffer.from(xml, "utf-8");
  const sha = createHash("sha256").update(buf).digest("hex");
  const objectKey = `${sha}-${ksefNum.replace(/[^a-zA-Z0-9._-]/g, "_")}.xml`;

  const storage = createObjectStorage();
  const put = await storage.putObject({
    key: objectKey,
    body: buf,
    contentType: "application/xml",
    tenantId: inv.tenantId,
  });

  await prisma.document.update({
    where: { id: doc.id },
    data: {
      storageKey: put.key,
      storageBucket: put.bucket ?? null,
      sha256: sha,
      sizeBytes: buf.length,
    },
  });
  console.info(`[stored] doc=${doc.id} key=${put.bucket ?? "local"}:${put.key}`);

  const cfg = loadConfig();
  const inflight = await prisma.processingJob.findFirst({
    where: {
      tenantId: inv.tenantId,
      invoiceId: inv.id,
      status: { in: ["PENDING", "RUNNING"] },
    },
  });
  if (inflight) {
    console.warn(`[skip queue] ${invoiceId}: jest job PENDING/RUNNING ${inflight.id}`);
    return;
  }

  const meta = doc.metadata as { filename?: unknown } | null;
  const filename =
    meta && typeof meta.filename === "string" && meta.filename.length > 0 ? meta.filename : `${ksefNum}.xml`;

  const processingJob = await prisma.processingJob.create({
    data: {
      tenantId: inv.tenantId,
      queueName: PIPELINE_QUEUE_NAME,
      type: "INGEST_PIPELINE",
      correlationId: randomUUID(),
      payload: { documentId: doc.id, invoiceId: inv.id, filename } as object,
      documentId: doc.id,
      invoiceId: inv.id,
      maxAttempts: cfg.PIPELINE_MAX_ATTEMPTS,
    },
  });

  const queue = getPipelineQueue();
  await queue.add(
    "run",
    { processingJobId: processingJob.id },
    {
      attempts: cfg.PIPELINE_MAX_ATTEMPTS,
      backoff: { type: "exponential", delay: 5000 },
      jobId: processingJob.id,
      removeOnComplete: 1000,
      removeOnFail: 5000,
    },
  );

  await prisma.invoice.update({
    where: { id: inv.id },
    data: { status: "INGESTING" },
  });
  console.info(`[queued] invoice=${inv.id} job=${processingJob.id}`);
}

async function main(): Promise<void> {
  const ids = process.argv.slice(2).filter(Boolean);
  if (ids.length === 0) {
    console.error("Podaj co najmniej jeden UUID faktury (KSeF).");
    process.exitCode = 1;
    return;
  }

  const cfg = loadConfig();
  if (cfg.KSEF_ENV === "mock" || !cfg.KSEF_TOKEN || !cfg.KSEF_NIP) {
    console.error("KSeF nie jest skonfigurowany (KSEF_ENV / token / NIP).");
    process.exitCode = 1;
    return;
  }

  const client = buildKsefClient(cfg);
  await client.authenticate();

  for (const id of ids) {
    try {
      await rehydrateOne(client, id);
    } catch (e) {
      console.error(`[error] ${id}`, e instanceof Error ? e.message : e);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
