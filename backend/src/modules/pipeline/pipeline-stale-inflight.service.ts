import type { PrismaClient, ProcessingJob } from "@prisma/client";
import { getPipelineQueue } from "../../lib/pipeline-queue.js";

/** PENDING bez wpisu w Redis — czekamy krótko (kolejka może zapisać job z opóźnieniem). */
const PENDING_ORPHAN_MIN_AGE_MS = 2 * 60 * 1000;
/** Po tym czasie uznajemy PENDING/RUNNING za zawieszone niezależnie od stanu Bull (np. worker wyłączony). */
const FORCE_STALE_MAX_AGE_MS = 45 * 60 * 1000;

const STALE_ERR =
  "Zwolniono zawieszone zadanie (brak aktywnej pracy w kolejce lub przekroczony czas) — możesz ponowić pobranie.";

async function isJobRowStale(row: ProcessingJob, now: number): Promise<boolean> {
  const age = now - row.createdAt.getTime();
  const queue = getPipelineQueue();
  const bullJob = await queue.getJob(row.id);
  if (!bullJob) {
    if (row.status === "RUNNING") return true;
    if (row.status === "PENDING" && age >= PENDING_ORPHAN_MIN_AGE_MS) return true;
    return false;
  }

  const state = await bullJob.getState();
  /** Worker faktycznie wykonuje pipeline — nie zwalniaj rekordu w DB (nawet przy długim OCR). */
  if (state === "active") return false;
  if (state === "completed" || state === "failed") return true;
  /** waiting / delayed / paused — zbyt długo bez postępu (np. worker wyłączony). */
  if (age >= FORCE_STALE_MAX_AGE_MS) return true;
  return false;
}

/**
 * Uwalnia zawieszone INGEST_PIPELINE (PENDING/RUNNING), gdy kolejka Redis i DB się rozjeżdżają
 * albo worker nie dokończył pracy. Umożliwia ponowne `rehydrate` / retry OCR.
 *
 * @returns liczba jobów oznaczonych jako FAILED
 */
export async function recoverStaleInflightPipelineJobsForInvoice(
  prisma: PrismaClient,
  tenantId: string,
  invoiceId: string,
): Promise<number> {
  const inflight = await prisma.processingJob.findMany({
    where: {
      tenantId,
      invoiceId,
      type: "INGEST_PIPELINE",
      status: { in: ["PENDING", "RUNNING"] },
    },
  });
  if (inflight.length === 0) return 0;

  const now = Date.now();
  let recovered = 0;
  for (const row of inflight) {
    if (!(await isJobRowStale(row, now))) continue;
    await prisma.processingJob.update({
      where: { id: row.id },
      data: { status: "FAILED", lastError: STALE_ERR },
    });
    await prisma.invoice.updateMany({
      where: { id: invoiceId, tenantId, status: "INGESTING" },
      data: { status: "FAILED_NEEDS_REVIEW" },
    });
    recovered++;
  }
  return recovered;
}

/**
 * Gdy UI pokazuje „przetwarzanie”, ale w bazie nie ma już PENDING/RUNNING (np. błąd walidacji przy powtórce Bull
 * nie zaktualizował statusu faktury) — ustaw FAILED_NEEDS_REVIEW, żeby dało się ponowić import.
 */
export async function repairOrphanIngestingInvoiceWithoutInflightJobs(
  prisma: PrismaClient,
  tenantId: string,
  invoiceId: string,
): Promise<boolean> {
  const inv = await prisma.invoice.findFirst({
    where: { id: invoiceId, tenantId },
    select: { status: true },
  });
  if (!inv || inv.status !== "INGESTING") return false;
  const active = await prisma.processingJob.count({
    where: {
      tenantId,
      invoiceId,
      type: "INGEST_PIPELINE",
      status: { in: ["PENDING", "RUNNING"] },
    },
  });
  if (active > 0) return false;
  await prisma.invoice.update({
    where: { id: invoiceId },
    data: { status: "FAILED_NEEDS_REVIEW" },
  });
  return true;
}
