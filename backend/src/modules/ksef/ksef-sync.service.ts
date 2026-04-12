/**
 * KSeF incremental invoice sync.
 *
 * Używa `permanentStorageDate` (Asc) oraz — domyślnie — drugiego przebiegu po **dacie wystawienia** (`Issue`),
 * żeby zestawić się z portalem MF (data wystawienia vs trwały zapis).
 * Domyślnie odpytywane są **Subject2 i Subject1** (`KSEF_SYNC_SUBJECT_TYPES`).
 * `hwmDate` jest cofane o kilka dni (`KSEF_SYNC_HWN_OVERLAP_DAYS`) względem „teraz”, żeby ponownie objąć skrajne przypadki.
 * Przy **jakimkolwiek** błędzie ingestu w przebiegu **nie** zapisujemy `hwmDate` (żeby nie pominąć faktur na stałe).
 * For each new invoice found:
 *   1. Check if we already have this ksefNumber (dedup).
 *   2. Download the XML.
 *   3. Ingest via shared attachment-intake pipeline (creates Document + Invoice + processing job).
 *
 * Stores the high-water-mark date per tenant for incremental pulls.
 */

import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { KsefClient, type KsefInvoiceMetadata, type KsefMetadataPage } from "./ksef-client.js";
import { ingestAttachmentAndEnqueue } from "../ingestion/attachment-intake.service.js";
import { createObjectStorage } from "../../adapters/storage/create-storage.js";
import { loadConfig } from "../../config.js";

export type KsefSyncJobData = {
  tenantId: string;
  /** Override the "from" date instead of using the stored high-water mark. */
  fromDate?: string;
  /** Re-download XMLs for invoices that already exist in DB and store in S3. */
  forceRefetchFiles?: boolean;
};

export type KsefSyncResult = {
  fetched: number;
  ingested: number;
  skippedDuplicate: number;
  /** Files re-downloaded and stored for existing invoices (force mode). */
  refetched: number;
  errors: string[];
  newHwmDate: string | null;
};

const KSEF_SYNC_ACTOR_ID = "00000000-0000-0000-0000-000000000000";
const PAGE_SIZE = 100;

/**
 * Gdy `hasMore && isTruncated`, MF wymaga zawężenia `dateRange.from` do „ostatniego rekordu”
 * i wyzerowania `pageOffset` (OpenAPI `POST /invoices/query/metadata`).
 * Sortowanie zależy od `dateRange.dateType` — dla **Issue** nie wolno używać `permanentStorageDate`
 * (to pomijałoby strony wyników i część faktur nigdy nie trafiałaby do ingestu).
 */
function nextMetadataQueryFrom(
  dateType: "PermanentStorage" | "Issue",
  last: KsefInvoiceMetadata,
): string {
  if (dateType === "PermanentStorage") {
    return last.permanentStorageDate;
  }
  const invoicing = last.invoicingDate?.trim();
  if (invoicing) return invoicing;
  const issue = last.issueDate?.trim();
  if (issue && /^\d{4}-\d{2}-\d{2}$/.test(issue)) {
    return `${issue}T00:00:00.000Z`;
  }
  if (issue) return issue;
  return last.permanentStorageDate;
}

function createInvoiceXmlThrottle(minIntervalMs: number): () => Promise<void> {
  let lastFetchAt = 0;
  return async () => {
    if (minIntervalMs <= 0) return;
    const now = Date.now();
    const waitMs = lastFetchAt + minIntervalMs - now;
    if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
    lastFetchAt = Date.now();
  };
}

/** Początek okna sync: jawny fromDate albo max(cofnięcie hwm, now−overlapDays). */
function resolveSyncFrom(opts: {
  fromOverride?: string;
  hwm: string | null;
  overlapDays: number;
}): string {
  const o = opts.fromOverride?.trim();
  if (o) return o;
  const dayMs = 24 * 60 * 60 * 1000;
  const thirtyAgo = new Date(Date.now() - 30 * dayMs).toISOString();
  const base = opts.hwm ?? thirtyAgo;
  if (opts.overlapDays <= 0) return base;
  const overlapFrom = new Date(Date.now() - opts.overlapDays * dayMs).toISOString();
  return base < overlapFrom ? base : overlapFrom;
}

export async function runKsefSyncJob(
  prisma: PrismaClient,
  data: KsefSyncJobData,
): Promise<KsefSyncResult> {
  const cfg = loadConfig();

  if (cfg.KSEF_ENV === "mock" || !cfg.KSEF_TOKEN || !cfg.KSEF_NIP) {
    console.warn("KSeF sync skipped: KSEF_ENV=mock or missing KSEF_TOKEN/KSEF_NIP.");
    return { fetched: 0, ingested: 0, skippedDuplicate: 0, refetched: 0, errors: [], newHwmDate: null };
  }

  const env = cfg.KSEF_ENV as "production" | "sandbox";
  let client: KsefClient;
  if (cfg.KSEF_CERT && cfg.KSEF_TOKEN_PASSWORD) {
    client = KsefClient.fromEncryptedCertificate(
      env, cfg.KSEF_TOKEN, cfg.KSEF_TOKEN_PASSWORD, cfg.KSEF_CERT, cfg.KSEF_NIP,
    );
  } else if (cfg.KSEF_TOKEN_PASSWORD) {
    client = KsefClient.fromEncryptedToken(env, cfg.KSEF_TOKEN, cfg.KSEF_TOKEN_PASSWORD, cfg.KSEF_NIP);
  } else {
    client = new KsefClient(env, cfg.KSEF_NIP, { kind: "token", ksefToken: cfg.KSEF_TOKEN });
  }

  console.info(`[KSeF sync] Authenticating (env=${env}, NIP=${cfg.KSEF_NIP})…`);
  await client.authenticate();
  console.info("[KSeF sync] Authenticated.");

  const hwmOnly = data.fromDate ? null : await getHighWaterMark(prisma, data.tenantId);
  const from = resolveSyncFrom({
    fromOverride: data.fromDate,
    hwm: hwmOnly,
    overlapDays: cfg.KSEF_SYNC_HWN_OVERLAP_DAYS,
  });
  const to = new Date().toISOString();
  const force = data.forceRefetchFiles === true;

  console.info(
    `[KSeF sync] Querying metadata from=${from} to=${to} force=${force} overlapDays=${cfg.KSEF_SYNC_HWN_OVERLAP_DAYS} (hwm=${hwmOnly ?? "—"})`,
  );

  const result: KsefSyncResult = { fetched: 0, ingested: 0, skippedDuplicate: 0, refetched: 0, errors: [], newHwmDate: null };
  const beforeXmlFetch = createInvoiceXmlThrottle(cfg.KSEF_INVOICE_FETCH_MIN_INTERVAL_MS);

  function mergeHwm(a: string | null, b: string | null): string | null {
    if (!a) return b;
    if (!b) return a;
    return a > b ? a : b;
  }

  const dateTypes = [...cfg.KSEF_SYNC_DATE_TYPES].sort((a, b) => {
    if (a === "PermanentStorage" && b !== "PermanentStorage") return -1;
    if (b === "PermanentStorage" && a !== "PermanentStorage") return 1;
    return 0;
  });

  for (const dateType of dateTypes) {
    for (const subjectType of cfg.KSEF_SYNC_SUBJECT_TYPES) {
      console.info(`[KSeF sync] Paging metadata dateType=${dateType} subjectType=${subjectType} …`);
      let pageOffset = 0;
      let hasMore = true;
      let currentFrom = from;

      while (hasMore) {
        let page: KsefMetadataPage;
        try {
          page = await client.queryMetadata(currentFrom, to, pageOffset, PAGE_SIZE, subjectType, dateType);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (dateType === "Issue") {
            console.warn(`[KSeF sync] Pomijam dateType=Issue dla ${subjectType}: ${msg}`);
            break;
          }
          throw err;
        }
        result.fetched += page.invoices.length;

        for (const inv of page.invoices) {
          try {
            const outcome = await processOneInvoice(prisma, client, data.tenantId, inv, force, beforeXmlFetch);
            if (outcome === "ingested") result.ingested++;
            else if (outcome === "refetched") result.refetched++;
            else result.skippedDuplicate++;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[KSeF sync] Error processing ${inv.ksefNumber}: ${msg}`);
            result.errors.push(`${inv.ksefNumber}: ${msg}`);
          }
        }

        if (dateType === "PermanentStorage" && page.permanentStorageHwmDate) {
          result.newHwmDate = mergeHwm(result.newHwmDate, page.permanentStorageHwmDate);
        }

        hasMore = page.hasMore;
        if (hasMore && page.isTruncated) {
          const lastInvoice = page.invoices[page.invoices.length - 1];
          if (lastInvoice) {
            currentFrom = nextMetadataQueryFrom(dateType, lastInvoice);
            console.info(
              `[KSeF sync] isTruncated dateType=${dateType} → next from=${currentFrom} (po ${lastInvoice.ksefNumber})`,
            );
          }
          pageOffset = 0;
        } else if (hasMore) {
          pageOffset++;
        }
      }
    }
  }

  if (result.errors.length === 0 && result.newHwmDate) {
    await setHighWaterMark(prisma, data.tenantId, result.newHwmDate);
    console.info(`[KSeF sync] Zaktualizowano hwmDate=${result.newHwmDate}`);
  } else if (result.errors.length > 0) {
    console.warn(
      `[KSeF sync] Nie aktualizuję hwmDate (błędy: ${result.errors.length}) — przy następnym sync ponowi się ten sam zakres; napraw błędy lub użyj fromDate.`,
    );
    result.newHwmDate = null;
  } else if (!result.newHwmDate) {
    console.info("[KSeF sync] Brak permanentStorageHwmDate z API — hwmDate bez zmian.");
  }

  console.info(
    `[KSeF sync] Done: fetched=${result.fetched}, ingested=${result.ingested}, refetched=${result.refetched}, dupes=${result.skippedDuplicate}, errors=${result.errors.length}`,
  );
  return result;
}

type ProcessOutcome = "ingested" | "refetched" | "skipped";

async function processOneInvoice(
  prisma: PrismaClient,
  client: KsefClient,
  tenantId: string,
  meta: KsefInvoiceMetadata,
  force: boolean,
  beforeXmlFetch: () => Promise<void>,
): Promise<ProcessOutcome> {
  const existingDoc = await prisma.document.findFirst({
    where: { tenantId, sourceType: "KSEF", sourceExternalId: meta.ksefNumber },
    select: { id: true },
  });
  const existingInv = await prisma.invoice.findFirst({
    where: { tenantId, ksefNumber: meta.ksefNumber },
    select: { id: true },
  });

  if ((existingDoc || existingInv) && force) {
    return refetchAndStoreFile(prisma, client, tenantId, meta, existingDoc?.id, beforeXmlFetch);
  }

  if (existingDoc || existingInv) return "skipped";

  await beforeXmlFetch();
  const xml = await client.fetchInvoiceXml(meta.ksefNumber);
  const buf = Buffer.from(xml, "utf-8");

  const actorUser = await prisma.user.findFirst({
    where: { tenantId, role: { in: ["OWNER", "ADMIN"] }, isActive: true },
    select: { id: true },
  });
  const actorId = actorUser?.id ?? KSEF_SYNC_ACTOR_ID;

  await ingestAttachmentAndEnqueue(prisma, {
    tenantId,
    actorUserId: actorId,
    buffer: buf,
    filename: `${meta.ksefNumber}.xml`,
    mimeType: "application/xml",
    ingestionSourceType: "KSEF",
    sourceExternalId: meta.ksefNumber,
    intakeSourceType: "KSEF_API",
    sourceAccount: `KSeF ${meta.seller.nip}`,
    metadata: ksefMetadataPayload(meta),
  });

  return "ingested";
}

/**
 * Re-downloads XML from KSeF and stores it in the current storage backend (S3).
 * Updates the existing Document record with the new storageKey/storageBucket.
 */
async function refetchAndStoreFile(
  prisma: PrismaClient,
  client: KsefClient,
  tenantId: string,
  meta: KsefInvoiceMetadata,
  existingDocId: string | undefined,
  beforeXmlFetch: () => Promise<void>,
): Promise<ProcessOutcome> {
  await beforeXmlFetch();
  const xml = await client.fetchInvoiceXml(meta.ksefNumber);
  const buf = Buffer.from(xml, "utf-8");

  const storage = createObjectStorage();
  const sha = createHash("sha256").update(buf).digest("hex");
  const objectKey = `${sha}-${meta.ksefNumber.replace(/[^a-zA-Z0-9._-]/g, "_")}.xml`;

  const put = await storage.putObject({
    key: objectKey,
    body: buf,
    contentType: "application/xml",
    tenantId,
  });

  if (existingDocId) {
    await prisma.document.update({
      where: { id: existingDocId },
      data: {
        storageKey: put.key,
        storageBucket: put.bucket ?? null,
        sha256: sha,
        sizeBytes: buf.length,
      },
    });
    console.info(`[KSeF sync] Re-stored file for doc ${existingDocId} → ${put.bucket ?? "local"}:${put.key}`);
  }

  return "refetched";
}

function ksefMetadataPayload(meta: KsefInvoiceMetadata): Record<string, unknown> {
  return {
    ksefNumber: meta.ksefNumber,
    invoiceNumber: meta.invoiceNumber,
    issueDate: meta.issueDate,
    sellerNip: meta.seller.nip,
    sellerName: meta.seller.name,
    buyerName: meta.buyer?.name ?? null,
    netAmount: meta.netAmount,
    grossAmount: meta.grossAmount,
    vatAmount: meta.vatAmount,
    currency: meta.currency,
  };
}

async function getHighWaterMark(prisma: PrismaClient, tenantId: string): Promise<string | null> {
  const source = await prisma.ingestionSource.findFirst({
    where: { tenantId, kind: "KSEF" },
    select: { metadata: true },
  });
  if (!source?.metadata) return null;
  const data = source.metadata as Record<string, unknown>;
  return typeof data.hwmDate === "string" ? data.hwmDate : null;
}

async function setHighWaterMark(prisma: PrismaClient, tenantId: string, hwmDate: string): Promise<void> {
  await prisma.ingestionSource.updateMany({
    where: { tenantId, kind: "KSEF" },
    data: { metadata: { hwmDate } },
  });
}
