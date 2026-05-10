/**
 * KSeF incremental invoice sync.
 *
 * Używa `permanentStorageDate` (Asc) oraz — domyślnie — drugiego przebiegu po **dacie wystawienia** (`Issue`),
 * żeby zestawić się z portalem MF (data wystawienia vs trwały zapis).
 * Domyślnie odpytywane są **Subject2 i Subject1** (`KSEF_SYNC_SUBJECT_TYPES`).
 * `hwmDate` jest cofane o kilka dni (`KSEF_SYNC_HWN_OVERLAP_DAYS`) względem „teraz”, żeby ponownie objąć skrajne przypadki.
 * Przy błędach ingestu odkładamy numery KSeF do kolejki retry (`retryKsefNumbers`) i zapisujemy checkpoint,
 * żeby kolejne przebiegi nie zaczynały od pełnego zakresu i nie przekraczały limitów MF.
 * For each new invoice found:
 *   1. Check if we already have this ksefNumber (dedup).
 *   2. Download the XML.
 *   3. Ingest via shared attachment-intake pipeline (creates Document + Invoice + processing job).
 *
 * Stores the high-water-mark date per tenant for incremental pulls.
 */

import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { Prisma, PrismaClient } from "@prisma/client";
import { KsefClient, type KsefInvoiceMetadata, type KsefMetadataPage } from "./ksef-client.js";
import { polishNipDigits10 } from "../contractors/contractor-resolve.js";
import { tryExtractDraftFromKsefFaXml } from "./ksef-fa-xml-extract.js";
import { issueYmdEmbeddedInKsefNumber } from "./ksef-metadata-draft.js";
import {
  ingestAttachmentAndEnqueue,
  resumePipelineForOrphanKsefDocument,
} from "../ingestion/attachment-intake.service.js";
import { parseInvoiceDate } from "../invoices/invoice-dates.js";
import { createObjectStorage } from "../../adapters/storage/create-storage.js";
import { loadConfig } from "../../config.js";
import { getEffectiveKsefApiEnv, KSEF_INGESTION_SOURCE_LABEL } from "./ksef-effective-env.js";
import { loadKsefClientForTenant } from "./ksef-tenant-credentials.service.js";
import { recoverStaleInflightPipelineJobsForInvoice } from "../pipeline/pipeline-stale-inflight.service.js";
import { retryInvoiceExtraction } from "../pipeline/retry-invoice-extraction.service.js";

export type KsefSyncJobData = {
  tenantId: string;
  /** Override the "from" date instead of using the stored high-water mark. */
  fromDate?: string;
  /**
   * Górny koniec okna metadanych (ISO). Dla np. samego kwietnia: `2026-04-30T23:59:59.999Z`.
   * Przy ustawionym `toDate` **nie zapisujemy** `hwmDate` — żeby nie cofnąć znaku wodnego produkcji.
   */
  toDate?: string;
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

/** Telemetria ostatniego przebiegu joba sync (JSON w `IngestionSource.metadata`). */
export type KsefSyncRunTelemetryPatch = {
  runAt: string;
  ok: boolean;
  phase: "skipped_no_credentials" | "completed" | "failed";
  skippedReason?: string;
  stats?: {
    fetched: number;
    ingested: number;
    skippedDuplicate: number;
    refetched: number;
    errorCount: number;
  };
  errorPreview?: string | null;
  /** Id joba BullMQ — deduplikacja wpisu audytu przy retry tego samego joba. */
  queueJobId?: string | null;
};

/** Kontekst wywołania z workera (opcjonalnie). */
export type KsefSyncJobRunContext = {
  queueJobId?: string | null;
};

const KSEF_SYNC_ACTOR_ID = "00000000-0000-0000-0000-000000000000";
const PAGE_SIZE = 100;
const MAX_RETRY_QUEUE_SIZE = 500;
type KsefSyncState = {
  hwmDate: string | null;
  retryKsefNumbers: string[];
};

/**
 * Gdy `hasMore && isTruncated`, MF wymaga zawężenia `dateRange.from` do „ostatniego rekordu”
 * i wyzerowania `pageOffset` (OpenAPI `POST /invoices/query/metadata`).
 * Sortowanie zależy od `dateRange.dateType` — dla **Issue** nie wolno używać `permanentStorageDate`
 * (to pomijałoby strony wyników i część faktur nigdy nie trafiałaby do ingestu).
 */
export function nextMetadataQueryFrom(
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

export function createInvoiceXmlThrottle(minIntervalMs: number): () => Promise<void> {
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
  ctx?: KsefSyncJobRunContext,
): Promise<KsefSyncResult> {
  const cfg = loadConfig();
  const syncRunAt = () => new Date().toISOString();

  // P0-1: load credentials musi być w try, żeby błąd (zły password / uszkodzony PKCS#5 / DB error)
  // nie pominął zapisu telemetrii i audit logu — inaczej operator widzi stale `lastSync*` i nie wie że job pada.
  let client: Awaited<ReturnType<typeof loadKsefClientForTenant>>;
  try {
    client = await loadKsefClientForTenant(prisma, data.tenantId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await mergeKsefSyncRunTelemetry(prisma, data.tenantId, {
      runAt: syncRunAt(),
      ok: false,
      phase: "failed",
      errorPreview: `loadKsefClientForTenant: ${msg}`.slice(0, 500),
      queueJobId: ctx?.queueJobId ?? null,
    });
    throw e;
  }

  if (!client) {
    console.warn(
      "KSeF sync skipped: brak realnego API (mock / brak nadpisania środowiska) lub brak poświadczeń (Ustawienia / KSeF albo KSEF_TOKEN+KSEF_NIP w .env).",
    );
    await mergeKsefSyncRunTelemetry(prisma, data.tenantId, {
      runAt: syncRunAt(),
      ok: false,
      phase: "skipped_no_credentials",
      skippedReason: "missing_credentials",
      errorPreview: null,
    });
    return { fetched: 0, ingested: 0, skippedDuplicate: 0, refetched: 0, errors: [], newHwmDate: null };
  }

  // P0-2: retryQueue trzymany na zewnątrz try, żeby outer catch mógł persistować numery
  // dodane w bieżącym runie zanim throw (inaczej praca per-faktura w `processOneInvoice` ginie).
  const state = await getKsefSyncState(prisma, data.tenantId);
  const retryQueue = new Set(state.retryKsefNumbers);

  try {
  const apiEnv = await getEffectiveKsefApiEnv(prisma, data.tenantId);
  console.info(`[KSeF sync] Authenticating (env=${apiEnv}, tenant=${data.tenantId})…`);
  await client.authenticate();
  console.info("[KSeF sync] Authenticated.");

  // state + retryQueue zainicjowane PRZED try (P0-2), żeby outer catch widział referencję
  const hwmOnly = data.fromDate ? null : state.hwmDate;
  const from = resolveSyncFrom({
    fromOverride: data.fromDate,
    hwm: hwmOnly,
    overlapDays: cfg.KSEF_SYNC_HWN_OVERLAP_DAYS,
  });
  const toTrim = data.toDate?.trim();
  const toNow = new Date().toISOString();
  /** Górny zakres dla `Issue` (np. koniec kwietnia) — portal MF filtruje po dacie wystawienia. */
  const toIssue = toTrim && toTrim.length > 0 ? toTrim : toNow;
  /** `PermanentStorage` zawsze do „teraz”, żeby nie pominąć faktur z kwietniową datą wystawienia zapisanych w KSeF później. */
  const toPermanent = toNow;
  /** Zawężony `toDate` (Issue) — nie zapisujemy HWM (odpowiedź MF przy wąskim oknie mogłaby cofnąć produkcyjny znacznik). */
  const skipHwmPersistence = Boolean(toTrim && toTrim.length > 0);
  const force = data.forceRefetchFiles === true;

  console.info(
    `[KSeF sync] Querying metadata from=${from} toPermanent=${toPermanent} toIssue=${toIssue} force=${force} overlapDays=${cfg.KSEF_SYNC_HWN_OVERLAP_DAYS} (hwm=${hwmOnly ?? "—"})${skipHwmPersistence ? " [toDate: bez zapisu hwmDate]" : ""}`,
  );

  const result: KsefSyncResult = { fetched: 0, ingested: 0, skippedDuplicate: 0, refetched: 0, errors: [], newHwmDate: null };
  const beforeXmlFetch = createInvoiceXmlThrottle(cfg.KSEF_INVOICE_FETCH_MIN_INTERVAL_MS);

  if (retryQueue.size > 0 && !force) {
    console.info(`[KSeF sync] Retry queue: ${retryQueue.size} numerów KSeF do ponowienia przed nowymi metadanymi.`);
    for (const kn of [...retryQueue]) {
      try {
        const outcome = await ingestKsefInvoiceXmlByKsefNumber(
          prisma,
          client,
          data.tenantId,
          kn,
          beforeXmlFetch,
        );
        if (outcome === "ingested" || outcome === "linked" || outcome === "resumed") result.ingested++;
        else result.skippedDuplicate++;
        retryQueue.delete(kn);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push(`retry ${kn}: ${msg}`);
      }
    }
  }

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
    if (dateType === "Issue") {
      const pauseMs = cfg.KSEF_METADATA_INTER_PASS_PAUSE_MS;
      if (pauseMs > 0) {
        console.info(
          `[KSeF sync] Pauza ${pauseMs}ms przed przebiegiem Issue (limit zapytań metadanych MF — po PermanentStorage).`,
        );
        await delay(pauseMs);
      }
    }
    for (const subjectType of cfg.KSEF_SYNC_SUBJECT_TYPES) {
      const to = dateType === "Issue" ? toIssue : toPermanent;
      console.info(`[KSeF sync] Paging metadata dateType=${dateType} subjectType=${subjectType} to=${to} …`);
      let pageOffset = 0;
      let hasMore = true;
      let currentFrom = from;

      while (hasMore) {
        let page: KsefMetadataPage | undefined;
        // P0-2 część A: oba dateType dostają retry. Issue jest agresywniej throttled przez MF → 6 prób
        // z dłuższym backoff (20s + 15s*attempt). PermanentStorage rzadziej 429, ale 502/503/504 zdarzają
        // się równie często — bez retry pojedynczy transient błąd ginie cały run + retryQueue.
        const metaMaxAttempts = dateType === "Issue" ? 6 : 4;
        const baseWaitMs = dateType === "Issue" ? 20_000 : 15_000;
        const stepWaitMs = dateType === "Issue" ? 15_000 : 10_000;
        let lastMetaErr: unknown;
        for (let metaAttempt = 0; metaAttempt < metaMaxAttempts; metaAttempt++) {
          try {
            page = await client.queryMetadata(currentFrom, to, pageOffset, PAGE_SIZE, subjectType, dateType);
            break;
          } catch (err) {
            lastMetaErr = err;
            if (metaAttempt + 1 >= metaMaxAttempts) {
              throw err;
            }
            const waitMs = baseWaitMs + metaAttempt * stepWaitMs;
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(
              `[KSeF sync] ${dateType} metadata błąd (próba ${metaAttempt + 1}/${metaMaxAttempts}) ${subjectType} offset=${pageOffset}: ${msg} — czekam ${waitMs}ms`,
            );
            await delay(waitMs);
          }
        }
        if (!page) {
          throw lastMetaErr instanceof Error ? lastMetaErr : new Error(String(lastMetaErr));
        }
        const metaPage = page;
        result.fetched += metaPage.invoices.length;

        for (const inv of metaPage.invoices) {
          try {
            const outcome = await processOneInvoice(prisma, client, data.tenantId, inv, force, beforeXmlFetch);
            if (outcome === "ingested" || outcome === "linked" || outcome === "resumed") result.ingested++;
            else if (outcome === "refetched") result.refetched++;
            else result.skippedDuplicate++;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[KSeF sync] Error processing ${inv.ksefNumber}: ${msg}`);
            result.errors.push(`${inv.ksefNumber}: ${msg}`);
            retryQueue.add(inv.ksefNumber);
          }
        }

        if (dateType === "PermanentStorage" && metaPage.permanentStorageHwmDate) {
          result.newHwmDate = mergeHwm(result.newHwmDate, metaPage.permanentStorageHwmDate);
        }

        hasMore = metaPage.hasMore;
        if (hasMore && metaPage.isTruncated) {
          const lastInvoice = metaPage.invoices[metaPage.invoices.length - 1];
          if (lastInvoice) {
            const computedNext = nextMetadataQueryFrom(dateType, lastInvoice);
            // P2-6: clamp żeby zapobiec infinite loop. Dla Issue, gdy `invoicingDate` puste i `issueDate`
            // jest YMD-only, helper konstruuje `T00:00:00.000Z` — to może być WCZEŚNIEJ niż obecne `currentFrom`,
            // szczególnie jeśli MF zwróci `isTruncated: true` na końcu strony z tylko jedną unikalną issueDate.
            // Sort Asc po stronie MF powinien chronić, ale tu defensywnie: jeśli next <= current → zatrzymaj
            // dalsze stronicowanie (kontynuujemy w następnym auto-sync).
            if (computedNext <= currentFrom) {
              console.warn(
                `[KSeF sync] Loop guard: next from (${computedNext}) <= current (${currentFrom}) dla dateType=${dateType} po ${lastInvoice.ksefNumber} — przerywam stronicowanie tej kombinacji.`,
              );
              hasMore = false;
            } else {
              currentFrom = computedNext;
              console.info(
                `[KSeF sync] isTruncated dateType=${dateType} → next from=${currentFrom} (po ${lastInvoice.ksefNumber})`,
              );
              pageOffset = 0;
            }
          } else {
            pageOffset = 0;
          }
        } else if (hasMore) {
          pageOffset++;
        }

        if (hasMore && cfg.KSEF_METADATA_PAGE_PAUSE_MS > 0) {
          await delay(cfg.KSEF_METADATA_PAGE_PAUSE_MS);
        }
      }
    }
  }

  const persistedHwm = skipHwmPersistence
    ? state.hwmDate
    : (result.newHwmDate ?? state.hwmDate);

  if (skipHwmPersistence) {
    console.info("[KSeF sync] Pomijam zmianę hwmDate (ustawiono toDate — sync zawężony).");
    result.newHwmDate = null;
  } else if (persistedHwm && persistedHwm !== state.hwmDate) {
    console.info(`[KSeF sync] Zaktualizowano hwmDate=${persistedHwm}`);
  } else if (!persistedHwm) {
    console.info("[KSeF sync] Brak permanentStorageHwmDate z API — hwmDate bez zmian.");
  }

  const retryToPersist = [...retryQueue].slice(0, MAX_RETRY_QUEUE_SIZE);
  if (retryQueue.size > MAX_RETRY_QUEUE_SIZE) {
    console.warn(
      `[KSeF sync] Retry queue przycięta do ${MAX_RETRY_QUEUE_SIZE} pozycji (było ${retryQueue.size}).`,
    );
  }
  const errPreview =
    result.errors.length > 0
      ? result.errors
          .slice(0, 3)
          .join(" | ")
          .slice(0, 480)
      : null;
  await saveKsefSyncState(
    prisma,
    data.tenantId,
    {
      hwmDate: persistedHwm,
      retryKsefNumbers: retryToPersist,
    },
    {
      runAt: syncRunAt(),
      ok: true,
      phase: "completed",
      stats: {
        fetched: result.fetched,
        ingested: result.ingested,
        skippedDuplicate: result.skippedDuplicate,
        refetched: result.refetched,
        errorCount: result.errors.length,
      },
      errorPreview: errPreview,
    },
  );

  // Webhook outbox removed (no n8n / automation integration).

  if (retryToPersist.length > 0) {
    console.warn(
      `[KSeF sync] Pozostawiono ${retryToPersist.length} numerów KSeF w retry queue (ponowienie w kolejnych sync).`,
    );
  }

  console.info(
    `[KSeF sync] Done: fetched=${result.fetched}, ingested=${result.ingested}, refetched=${result.refetched}, dupes=${result.skippedDuplicate}, errors=${result.errors.length}`,
  );
  return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // P0-2: persist retryQueue (numery dodane przed throw w bieżącym runie) zanim re-throw,
    // żeby BullMQ retry zaczął od pełnego stanu zamiast od ostatniego persisted DB snapshotu.
    // Świadomie nie ruszamy hwmDate — pozostawiamy ostatnio zapisany przez completed run.
    try {
      const retryToPersist = [...retryQueue].slice(0, MAX_RETRY_QUEUE_SIZE);
      await saveKsefSyncState(prisma, data.tenantId, {
        hwmDate: state.hwmDate,
        retryKsefNumbers: retryToPersist,
      });
      if (retryToPersist.length > state.retryKsefNumbers.length) {
        console.warn(
          `[KSeF sync] Persisted ${retryToPersist.length} retry numbers przed throw (było ${state.retryKsefNumbers.length} przed runem).`,
        );
      }
    } catch (persistErr) {
      const pmsg = persistErr instanceof Error ? persistErr.message : String(persistErr);
      console.error(`[KSeF sync] Nie udało się persistować retryQueue w catch: ${pmsg}`);
    }
    await mergeKsefSyncRunTelemetry(prisma, data.tenantId, {
      runAt: syncRunAt(),
      ok: false,
      phase: "failed",
      errorPreview: msg.slice(0, 500),
      queueJobId: ctx?.queueJobId ?? null,
    });
    throw e;
  }
}

type ProcessOutcome = "ingested" | "refetched" | "skipped" | "linked" | "resumed";

const AUTO_RETRY_FRESH_KSEF_WINDOW_MS = 3 * 60 * 60 * 1000;
const AUTO_RETRY_MIN_GAP_MS = 90 * 1000;
const AUTO_RESUME_MAX_ATTEMPTS = 3;

// P2-7: per-process counter prób auto-resume per invoice. Bez tego invoice w stanie FAILED_NEEDS_REVIEW
// był wskrzeszany w każdej rundzie auto-sync (co 5 min) przez całe 3h okno = do 36 prób, spam audit log + Redis.
// In-memory celowo — restart workera resetuje, ale i tak po restarcie zwykle minęło >3h od `createdAt`,
// więc okno freshness odcina kolejne próby. Czyszczone leniwie przy każdym hit (sprawdzenie ageMs > window).
const autoResumeAttemptsByInvoice = new Map<string, number>();

async function tryAutoResumeKsefInvoiceProcessing(
  prisma: PrismaClient,
  tenantId: string,
  invoice: { id: string; status: string; createdAt: Date },
): Promise<boolean> {
  if (invoice.status !== "INGESTING" && invoice.status !== "FAILED_NEEDS_REVIEW") return false;
  const ageMs = Date.now() - invoice.createdAt.getTime();
  if (ageMs > AUTO_RETRY_FRESH_KSEF_WINDOW_MS) {
    autoResumeAttemptsByInvoice.delete(invoice.id); // lazy cleanup poza oknem
    return false;
  }

  const prevAttempts = autoResumeAttemptsByInvoice.get(invoice.id) ?? 0;
  if (prevAttempts >= AUTO_RESUME_MAX_ATTEMPTS) {
    // P2-7: cap przekroczony — zostaw operatorowi manual review zamiast spamować.
    return false;
  }

  await recoverStaleInflightPipelineJobsForInvoice(prisma, tenantId, invoice.id);

  const inflight = await prisma.processingJob.findFirst({
    where: {
      tenantId,
      invoiceId: invoice.id,
      type: "INGEST_PIPELINE",
      status: { in: ["PENDING", "RUNNING"] },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (inflight) return false;

  const lastJob = await prisma.processingJob.findFirst({
    where: { tenantId, invoiceId: invoice.id, type: "INGEST_PIPELINE" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (lastJob && Date.now() - lastJob.createdAt.getTime() < AUTO_RETRY_MIN_GAP_MS) {
    return false;
  }

  try {
    const res = await retryInvoiceExtraction(prisma, tenantId, invoice.id);
    // P2-7: zwiększ counter PO udanym retry (przed throw → counter nie rośnie, kolejna próba możliwa).
    const newAttempts = prevAttempts + 1;
    autoResumeAttemptsByInvoice.set(invoice.id, newAttempts);
    console.info(
      `[KSeF sync] auto-resume pipeline: invoice=${invoice.id} processingJob=${res.processingJobId} (attempt ${newAttempts}/${AUTO_RESUME_MAX_ATTEMPTS})`,
    );
    if (newAttempts >= AUTO_RESUME_MAX_ATTEMPTS) {
      console.warn(
        `[KSeF sync] auto-resume cap osiągnięty dla invoice=${invoice.id} (${newAttempts}/${AUTO_RESUME_MAX_ATTEMPTS}) — kolejne auto-resume zablokowane, wymagane manual review.`,
      );
    }
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[KSeF sync] auto-resume skipped for ${invoice.id}: ${msg}`);
    return false;
  }
}

/**
 * Faktura powiązana z XML KSeF (`primaryDocId`), ale bez `ksefNumber` — diff MF vs DB pokazuje „brak w bazie”,
 * a sync/ingest uznaje sam `Document` za duplikat i nic nie robi.
 */
async function linkKsefNumberToInvoiceIfNeeded(
  prisma: PrismaClient,
  tenantId: string,
  ksefNumber: string,
  documentId: string,
): Promise<boolean> {
  const inv = await prisma.invoice.findFirst({
    where: { tenantId, primaryDocId: documentId },
    select: { id: true, ksefNumber: true, sourceExternalId: true },
  });
  if (!inv) return false;
  const kn = ksefNumber.trim();
  if (inv.ksefNumber?.trim() && inv.ksefNumber.trim() !== kn) return false;
  const needsKsef = (inv.ksefNumber?.trim() ?? "") !== kn;
  const needsExt = (inv.sourceExternalId?.trim() ?? "") !== kn;
  if (!needsKsef && !needsExt) return false;
  await prisma.invoice.update({
    where: { id: inv.id },
    data: {
      ksefNumber: kn,
      ...(needsExt ? { sourceExternalId: kn } : {}),
      intakeSourceType: "KSEF_API",
    },
  });
  console.info(`[KSeF sync] Uzupełniono powiązanie KSeF: invoiceId=${inv.id} ksefNumber=${kn}`);
  return true;
}

/** Data wystawienia z metadanych KSeF — żeby GET /invoices?dateFrom/dateTo od razu trafiała w ten sam miesiąc co w MF. */
function issueDateFromKsefMetadata(meta: KsefInvoiceMetadata): Date | undefined {
  const raw = meta.issueDate?.trim();
  if (!raw) return undefined;
  const ymd = raw.length >= 10 ? raw.slice(0, 10) : raw;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return undefined;
  const d = parseInvoiceDate(ymd);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function parseDraftMoney(s: string | undefined): number {
  if (!s) return 0;
  const normalized = s.replace(/\s/g, "").replace(/,/g, ".");
  const n = Number.parseFloat(normalized);
  return Number.isFinite(n) ? n : 0;
}

/** Metadane jak z `query/metadata`, zbudowane z treści FA po pobraniu XML. */
function ksefMetadataFromFaXmlDraft(
  ksefNumber: string,
  extracted: NonNullable<ReturnType<typeof tryExtractDraftFromKsefFaXml>>,
): KsefInvoiceMetadata {
  const d = extracted.draft;
  const issueYmd =
    (d.issueDate && d.issueDate.length >= 10 ? d.issueDate.slice(0, 10) : undefined) ??
    issueYmdEmbeddedInKsefNumber(ksefNumber) ??
    "1970-01-01";
  const nip = polishNipDigits10(d.contractorNip ?? "") ?? "0000000000";
  const net = parseDraftMoney(d.netTotal);
  const vat = parseDraftMoney(d.vatTotal);
  let gross = parseDraftMoney(d.grossTotal);
  if (gross <= 0 && (net > 0 || vat > 0)) gross = net + vat;
  const nowIso = new Date().toISOString();
  return {
    ksefNumber,
    invoiceNumber: (d.number?.trim() || ksefNumber).slice(0, 500),
    issueDate: issueYmd,
    invoicingDate: `${issueYmd}T12:00:00.000Z`,
    permanentStorageDate: nowIso,
    seller: { nip, name: (d.contractorName?.trim() || "—").slice(0, 512) },
    buyer: null,
    netAmount: net,
    grossAmount: gross,
    vatAmount: vat,
    currency: (d.currency || "PLN").slice(0, 8),
    invoiceType: "FA",
    invoiceHash: "",
  };
}

/**
 * Pobiera XML po numerze KSeF i wprowadza fakturę tak jak sync — na uzupełnienie luk,
 * gdy metadane MF zawierają numer, którego nie ma jeszcze w `Document` / `Invoice`.
 */
export async function ingestKsefInvoiceXmlByKsefNumber(
  prisma: PrismaClient,
  client: KsefClient,
  tenantId: string,
  ksefNumber: string,
  beforeXmlFetch: () => Promise<void>,
): Promise<"ingested" | "skipped" | "linked" | "resumed"> {
  const kn = ksefNumber.trim();
  if (!kn) throw new Error("pusty numer KSeF");

  const existingInv = await prisma.invoice.findFirst({
    where: { tenantId, ksefNumber: kn },
    select: { id: true, status: true, createdAt: true },
  });
  if (existingInv) {
    const resumed = await tryAutoResumeKsefInvoiceProcessing(prisma, tenantId, existingInv);
    return resumed ? "resumed" : "skipped";
  }

  const existingDoc = await prisma.document.findFirst({
    where: { tenantId, sourceType: "KSEF", sourceExternalId: kn },
    select: { id: true },
  });
  if (existingDoc) {
    const linked = await linkKsefNumberToInvoiceIfNeeded(prisma, tenantId, kn, existingDoc.id);
    if (linked) return "linked";
    const orphan = !(await prisma.invoice.findFirst({
      where: { tenantId, primaryDocId: existingDoc.id },
      select: { id: true },
    }));
    if (orphan) {
      const actorUser = await prisma.user.findFirst({
        where: { tenantId, role: { in: ["OWNER", "ADMIN"] }, isActive: true },
        select: { id: true },
      });
      const actorId = actorUser?.id ?? KSEF_SYNC_ACTOR_ID;
      await resumePipelineForOrphanKsefDocument(prisma, {
        tenantId,
        documentId: existingDoc.id,
        actorUserId: actorId,
        ksefNumber: kn,
      });
      return "resumed";
    }
    return "skipped";
  }

  await beforeXmlFetch();
  const xml = await client.fetchInvoiceXml(kn);
  const buf = Buffer.from(xml, "utf-8");

  const extracted = tryExtractDraftFromKsefFaXml(buf, "application/xml");
  if (!extracted) {
    throw new Error(`nie rozpoznano struktury FA w XML dla ${kn}`);
  }

  const meta = ksefMetadataFromFaXmlDraft(kn, extracted);

  const actorUser = await prisma.user.findFirst({
    where: { tenantId, role: { in: ["OWNER", "ADMIN"] }, isActive: true },
    select: { id: true },
  });
  const actorId = actorUser?.id ?? KSEF_SYNC_ACTOR_ID;

  await ingestAttachmentAndEnqueue(prisma, {
    tenantId,
    actorUserId: actorId,
    buffer: buf,
    filename: `${kn}.xml`,
    mimeType: "application/xml",
    ingestionSourceType: "KSEF",
    sourceExternalId: kn,
    intakeSourceType: "KSEF_API",
    sourceAccount: `KSeF ${meta.seller.nip}`,
    metadata: ksefMetadataPayload(meta),
    initialIssueDate: issueDateFromKsefMetadata(meta),
  });

  return "ingested";
}

async function processOneInvoice(
  prisma: PrismaClient,
  client: KsefClient,
  tenantId: string,
  meta: KsefInvoiceMetadata,
  force: boolean,
  beforeXmlFetch: () => Promise<void>,
): Promise<ProcessOutcome> {
  const existingInv = await prisma.invoice.findFirst({
    where: { tenantId, ksefNumber: meta.ksefNumber },
    select: { id: true, status: true, createdAt: true },
  });
  const existingDoc = await prisma.document.findFirst({
    where: { tenantId, sourceType: "KSEF", sourceExternalId: meta.ksefNumber },
    select: { id: true },
  });

  if ((existingDoc || existingInv) && force) {
    return refetchAndStoreFile(prisma, client, tenantId, meta, existingDoc?.id, beforeXmlFetch);
  }

  if (existingInv) {
    const resumed = await tryAutoResumeKsefInvoiceProcessing(prisma, tenantId, existingInv);
    return resumed ? "resumed" : "skipped";
  }

  if (existingDoc) {
    const linked = await linkKsefNumberToInvoiceIfNeeded(
      prisma,
      tenantId,
      meta.ksefNumber,
      existingDoc.id,
    );
    if (linked) return "linked";
    const orphan = !(await prisma.invoice.findFirst({
      where: { tenantId, primaryDocId: existingDoc.id },
      select: { id: true },
    }));
    if (orphan) {
      const actorUser = await prisma.user.findFirst({
        where: { tenantId, role: { in: ["OWNER", "ADMIN"] }, isActive: true },
        select: { id: true },
      });
      const actorId = actorUser?.id ?? KSEF_SYNC_ACTOR_ID;
      await resumePipelineForOrphanKsefDocument(prisma, {
        tenantId,
        documentId: existingDoc.id,
        actorUserId: actorId,
        ksefNumber: meta.ksefNumber,
      });
      return "resumed";
    }
    return "skipped";
  }

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
    initialIssueDate: issueDateFromKsefMetadata(meta),
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

async function getKsefSyncState(prisma: PrismaClient, tenantId: string): Promise<KsefSyncState> {
  const source = await prisma.ingestionSource.findFirst({
    where: { tenantId, kind: "KSEF" },
    select: { metadata: true },
  });
  if (!source?.metadata) return { hwmDate: null, retryKsefNumbers: [] };
  const data = source.metadata as Record<string, unknown>;
  const retryRaw = Array.isArray(data.retryKsefNumbers) ? data.retryKsefNumbers : [];
  const retryKsefNumbers = retryRaw
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
  return {
    hwmDate: typeof data.hwmDate === "string" ? data.hwmDate : null,
    retryKsefNumbers,
  };
}

async function saveKsefSyncState(
  prisma: PrismaClient,
  tenantId: string,
  state: KsefSyncState,
  telemetry?: KsefSyncRunTelemetryPatch,
): Promise<void> {
  const source = await prisma.ingestionSource.findFirst({
    where: { tenantId, kind: "KSEF" },
    orderBy: { updatedAt: "desc" },
    select: { id: true, metadata: true, label: true },
  });
  const base = source?.metadata && typeof source.metadata === "object"
    ? (source.metadata as Record<string, unknown>)
    : {};
  const metaCore: Record<string, unknown> = {
    ...base,
    hwmDate: state.hwmDate,
    retryKsefNumbers: state.retryKsefNumbers,
  };
  const metadata: Prisma.InputJsonObject = telemetry
    ? {
        ...metaCore,
        lastSyncRunAt: telemetry.runAt,
        lastSyncOk: telemetry.ok,
        lastSyncPhase: telemetry.phase,
        ...(telemetry.skippedReason !== undefined ? { lastSyncSkippedReason: telemetry.skippedReason } : {}),
        ...(telemetry.stats ? { lastSyncStats: telemetry.stats as object } : {}),
        ...(telemetry.errorPreview !== undefined ? { lastSyncErrorPreview: telemetry.errorPreview } : {}),
      }
    : (metaCore as Prisma.InputJsonObject);
  if (source) {
    await prisma.ingestionSource.update({
      where: { id: source.id },
      data: { metadata },
    });
    return;
  }
  await prisma.ingestionSource.create({
    data: {
      tenantId,
      kind: "KSEF",
      label: KSEF_INGESTION_SOURCE_LABEL,
      isEnabled: true,
      metadata,
    },
  });
}

/** Zapis telemetrii bez zmiany HWM/retry (np. brak credów, wyjątek przed zapisem stanu). */
export async function mergeKsefSyncRunTelemetry(
  prisma: PrismaClient,
  tenantId: string,
  patch: KsefSyncRunTelemetryPatch,
): Promise<void> {
  const source = await prisma.ingestionSource.findFirst({
    where: { tenantId, kind: "KSEF" },
    orderBy: { updatedAt: "desc" },
    select: { id: true, metadata: true, label: true },
  });
  const base =
    source?.metadata && typeof source.metadata === "object"
      ? ({ ...(source.metadata as Record<string, unknown>) } as Record<string, unknown>)
      : {};

  const queueJobIdStr = patch.queueJobId != null ? String(patch.queueJobId) : "";
  const prevFailureAudited =
    typeof base.lastSyncFailureAuditedQueueJobId === "string" ? base.lastSyncFailureAuditedQueueJobId : "";
  const duplicateFailureAudit =
    patch.phase === "failed" &&
    patch.ok === false &&
    queueJobIdStr.length > 0 &&
    prevFailureAudited === queueJobIdStr;

  const failureAuditMarker: Record<string, unknown> = {};
  if (patch.phase === "failed" && !patch.ok && queueJobIdStr.length > 0 && !duplicateFailureAudit) {
    failureAuditMarker.lastSyncFailureAuditedQueueJobId = queueJobIdStr;
  }

  const metadata: Prisma.InputJsonObject = {
    ...base,
    lastSyncRunAt: patch.runAt,
    lastSyncOk: patch.ok,
    lastSyncPhase: patch.phase,
    ...(patch.skippedReason !== undefined ? { lastSyncSkippedReason: patch.skippedReason } : {}),
    ...(patch.stats ? { lastSyncStats: patch.stats as object } : {}),
    ...(patch.errorPreview !== undefined ? { lastSyncErrorPreview: patch.errorPreview } : {}),
    ...failureAuditMarker,
  };
  if (source) {
    await prisma.ingestionSource.update({ where: { id: source.id }, data: { metadata } });
  } else {
    await prisma.ingestionSource.create({
      data: {
        tenantId,
        kind: "KSEF",
        label: KSEF_INGESTION_SOURCE_LABEL,
        isEnabled: true,
        metadata: {
          hwmDate: null,
          retryKsefNumbers: [],
          ...metadata,
        },
      },
    });
  }

  if (patch.phase === "failed" && !patch.ok && !duplicateFailureAudit) {
    await prisma.auditLog.create({
      data: {
        tenantId,
        actorId: null,
        action: "KSEF_SYNC_RUN_FAILED",
        entityType: "INTEGRATION",
        entityId: tenantId,
        metadata: {
          queueJobId: patch.queueJobId ?? null,
          errorPreview: patch.errorPreview ?? null,
        } as object,
      },
    });
    // Webhook outbox removed (no n8n / automation integration).
  }
}
