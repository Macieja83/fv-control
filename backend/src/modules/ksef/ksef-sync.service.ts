/**
 * KSeF incremental invoice sync.
 *
 * Uses `permanentStorageDate` (Asc) to pull new invoices since last sync.
 * For each new invoice found:
 *   1. Check if we already have this ksefNumber (dedup).
 *   2. Download the XML.
 *   3. Ingest via shared attachment-intake pipeline (creates Document + Invoice + processing job).
 *
 * Stores the high-water-mark date per tenant for incremental pulls.
 */

import type { PrismaClient } from "@prisma/client";
import { KsefClient, type KsefInvoiceMetadata } from "./ksef-client.js";
import { ingestAttachmentAndEnqueue } from "../ingestion/attachment-intake.service.js";
import { loadConfig } from "../../config.js";

export type KsefSyncJobData = {
  tenantId: string;
};

export type KsefSyncResult = {
  fetched: number;
  ingested: number;
  skippedDuplicate: number;
  errors: string[];
  newHwmDate: string | null;
};

const KSEF_SYNC_ACTOR_ID = "00000000-0000-0000-0000-000000000000";
const PAGE_SIZE = 100;

/**
 * KSeF enforces two rate limits:
 *   - 16 requests per minute
 *   - 64 requests per hour
 * We stay safely under with 14 req/min and 58 req/hour.
 */
class RateLimiter {
  private timestamps: number[] = [];

  async throttle(): Promise<void> {
    const now = Date.now();
    this.timestamps = this.timestamps.filter((t) => now - t < 3_600_000);

    const lastMinute = this.timestamps.filter((t) => now - t < 60_000);
    if (lastMinute.length >= 14) {
      const oldest = lastMinute[0]!;
      const waitMs = 60_000 - (now - oldest) + 1_000;
      console.info(`[KSeF sync] Minute limit reached (${lastMinute.length}/14), waiting ${Math.ceil(waitMs / 1000)}s…`);
      await sleep(waitMs);
    }

    if (this.timestamps.length >= 58) {
      const oldest = this.timestamps[0]!;
      const waitMs = 3_600_000 - (Date.now() - oldest) + 1_000;
      console.info(`[KSeF sync] Hourly limit reached (${this.timestamps.length}/58), waiting ${Math.ceil(waitMs / 1000)}s…`);
      await sleep(waitMs);
      this.timestamps = this.timestamps.filter((t) => Date.now() - t < 3_600_000);
    }

    this.timestamps.push(Date.now());
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function runKsefSyncJob(
  prisma: PrismaClient,
  data: KsefSyncJobData,
): Promise<KsefSyncResult> {
  const cfg = loadConfig();

  if (cfg.KSEF_ENV === "mock" || !cfg.KSEF_TOKEN || !cfg.KSEF_NIP) {
    console.warn("KSeF sync skipped: KSEF_ENV=mock or missing KSEF_TOKEN/KSEF_NIP.");
    return { fetched: 0, ingested: 0, skippedDuplicate: 0, errors: [], newHwmDate: null };
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

  const hwm = await getHighWaterMark(prisma, data.tenantId);
  const from = hwm ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const to = new Date().toISOString();

  console.info(`[KSeF sync] Querying metadata from=${from} to=${to}`);

  const result: KsefSyncResult = { fetched: 0, ingested: 0, skippedDuplicate: 0, errors: [], newHwmDate: null };
  const limiter = new RateLimiter();
  let pageOffset = 0;
  let hasMore = true;
  let currentFrom = from;

  while (hasMore) {
    await limiter.throttle();
    const page = await client.queryMetadata(currentFrom, to, pageOffset, PAGE_SIZE, "Subject2");
    result.fetched += page.invoices.length;

    for (const inv of page.invoices) {
      try {
        const ingested = await processOneInvoice(prisma, client, data.tenantId, inv, limiter);
        if (ingested) result.ingested++;
        else result.skippedDuplicate++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[KSeF sync] Error processing ${inv.ksefNumber}: ${msg}`);
        result.errors.push(`${inv.ksefNumber}: ${msg}`);
      }
    }

    if (page.permanentStorageHwmDate) {
      result.newHwmDate = page.permanentStorageHwmDate;
    }

    hasMore = page.hasMore;
    if (hasMore && page.isTruncated) {
      const lastInvoice = page.invoices[page.invoices.length - 1];
      if (lastInvoice) {
        currentFrom = lastInvoice.permanentStorageDate;
      }
      pageOffset = 0;
    } else if (hasMore) {
      pageOffset++;
    }
  }

  if (result.newHwmDate) {
    await setHighWaterMark(prisma, data.tenantId, result.newHwmDate);
  }

  console.info(
    `[KSeF sync] Done: fetched=${result.fetched}, ingested=${result.ingested}, dupes=${result.skippedDuplicate}, errors=${result.errors.length}`,
  );
  return result;
}

async function processOneInvoice(
  prisma: PrismaClient,
  client: KsefClient,
  tenantId: string,
  meta: KsefInvoiceMetadata,
  limiter: RateLimiter,
): Promise<boolean> {
  const existing = await prisma.invoice.findFirst({
    where: { tenantId, ksefNumber: meta.ksefNumber },
    select: { id: true },
  });
  if (existing) return false;

  const existingDoc = await prisma.document.findFirst({
    where: { tenantId, sourceType: "KSEF", sourceExternalId: meta.ksefNumber },
    select: { id: true },
  });
  if (existingDoc) return false;

  await limiter.throttle();
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
    metadata: {
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
    },
  });

  return true;
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
