import type { PrismaClient } from "@prisma/client";

type WebhookOutboxRow = NonNullable<Awaited<ReturnType<PrismaClient["webhookOutbox"]["findUnique"]>>>;
import { loadConfig } from "../../config.js";
import {
  webhookDeadLetterTotal,
  webhookDeliveryDurationSeconds,
  webhooksDeliveryTotal,
} from "../../lib/metrics.js";
import { buildFvControlSignatureHeader, canonicalWebhookPayload } from "../../lib/webhook-outbound-sign.js";

export function webhookRetryDelayMs(attemptCountAfterFailure: number): number {
  const base = 5000;
  return Math.min(base * 2 ** Math.max(0, attemptCountAfterFailure - 1), 3_600_000);
}

function deliveryLogLine(row: {
  id: string;
  eventType: string;
  url: string;
  attemptCount: number;
  status: string;
}): Record<string, unknown> {
  let host = "invalid-url";
  try {
    host = new URL(row.url).hostname;
  } catch {
    /* keep placeholder */
  }
  return {
    msg: "webhook_delivery",
    deliveryId: row.id,
    eventType: row.eventType,
    status: row.status,
    attempt: row.attemptCount + 1,
    targetHost: host,
  };
}

async function reclaimStaleProcessing(prisma: PrismaClient): Promise<void> {
  const cfg = loadConfig();
  const staleBefore = new Date(Date.now() - cfg.WEBHOOK_PROCESSING_STALE_MS);
  const res = await prisma.webhookOutbox.updateMany({
    where: { status: "PROCESSING", updatedAt: { lt: staleBefore } },
    data: {
      status: "FAILED_RETRYABLE",
      lastError: "PROCESSING timeout — reclaimed by worker",
    },
  });
  if (res.count > 0) {
    webhooksDeliveryTotal.labels("reclaimed_stale").inc(res.count);
  }
}

async function claimPendingBatch(prisma: PrismaClient, take: number): Promise<WebhookOutboxRow[]> {
  const candidates = await prisma.webhookOutbox.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
    take,
    select: { id: true },
  });
  const rows: WebhookOutboxRow[] = [];
  for (const c of candidates) {
    const u = await prisma.webhookOutbox.updateMany({
      where: { id: c.id, status: "PENDING" },
      data: { status: "PROCESSING" },
    });
    if (u.count === 1) {
      const row = await prisma.webhookOutbox.findUnique({ where: { id: c.id } });
      if (row) rows.push(row);
    }
  }
  return rows;
}

async function claimRetryableBatch(
  prisma: PrismaClient,
  maxAttempts: number,
  take: number,
): Promise<WebhookOutboxRow[]> {
  const now = Date.now();
  const candidates = await prisma.webhookOutbox.findMany({
    where: { status: "FAILED_RETRYABLE", attemptCount: { lt: maxAttempts } },
    orderBy: { updatedAt: "asc" },
    take: take * 2,
  });
  const due = candidates.filter((f) => now - f.updatedAt.getTime() >= webhookRetryDelayMs(f.attemptCount)).slice(0, take);
  const rows: WebhookOutboxRow[] = [];
  for (const c of due) {
    const u = await prisma.webhookOutbox.updateMany({
      where: { id: c.id, status: "FAILED_RETRYABLE" },
      data: { status: "PROCESSING" },
    });
    if (u.count === 1) {
      const row = await prisma.webhookOutbox.findUnique({ where: { id: c.id } });
      if (row) rows.push(row);
    }
  }
  return rows;
}

export async function sweepWebhookOutbox(prisma: PrismaClient): Promise<{ processed: number; sent: number }> {
  const cfg = loadConfig();
  const maxAttempts = cfg.WEBHOOK_DELIVERY_MAX_ATTEMPTS;

  await reclaimStaleProcessing(prisma);

  const pending = await claimPendingBatch(prisma, 20);
  const retryable = await claimRetryableBatch(prisma, maxAttempts, 30);
  const batch = [...pending, ...retryable];
  let sent = 0;

  for (const row of batch) {
    const rawBody = canonicalWebhookPayload(row.payload);
    const ts = Math.floor(Date.now() / 1000).toString();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-FVControl-Event": row.eventType,
      "X-FVControl-Delivery-Id": row.id,
      "User-Agent": `FVControl-Webhook/1.0 (${cfg.APP_NAME})`,
      "X-FVControl-Delivery-Attempt": String(row.attemptCount + 1),
    };
    if (cfg.WEBHOOK_SIGNING_SECRET) {
      headers["X-FVControl-Timestamp"] = ts;
      headers["X-FVControl-Signature"] = buildFvControlSignatureHeader(cfg.WEBHOOK_SIGNING_SECRET, ts, rawBody);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.WEBHOOK_HTTP_TIMEOUT_MS);
    const endTimer = webhookDeliveryDurationSeconds.startTimer();

    console.info(JSON.stringify(deliveryLogLine({ ...row, status: "attempt" })));

    try {
      const res = await fetch(row.url, {
        method: "POST",
        headers,
        body: rawBody,
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.ok) {
        await prisma.webhookOutbox.update({
          where: { id: row.id },
          data: {
            status: "SENT",
            lastError: null,
            attemptCount: { increment: 1 },
          },
        });
        endTimer({ status: "sent" });
        webhooksDeliveryTotal.labels("sent").inc();
        sent += 1;
        console.info(JSON.stringify(deliveryLogLine({ ...row, attemptCount: row.attemptCount + 1, status: "sent" })));
      } else {
        const errText = await res.text().catch(() => "");
        const nextAttempts = row.attemptCount + 1;
        const terminal = nextAttempts >= maxAttempts;
        await prisma.webhookOutbox.update({
          where: { id: row.id },
          data: {
            status: terminal ? "DEAD_LETTER" : "FAILED_RETRYABLE",
            lastError: `HTTP ${res.status}: ${errText.slice(0, 500)}`,
            attemptCount: { increment: 1 },
          },
        });
        endTimer({ status: terminal ? "dead_letter" : "http_error" });
        if (terminal) {
          webhookDeadLetterTotal.inc();
          webhooksDeliveryTotal.labels("dead_letter").inc();
        } else {
          webhooksDeliveryTotal.labels("failed_retryable").inc();
        }
        console.info(
          JSON.stringify(
            deliveryLogLine({
              ...row,
              attemptCount: row.attemptCount + 1,
              status: terminal ? "dead_letter" : "failed_retryable",
            }),
          ),
        );
      }
    } catch (e) {
      clearTimeout(timer);
      const msg = e instanceof Error ? e.message : String(e);
      const nextAttempts = row.attemptCount + 1;
      const terminal = nextAttempts >= maxAttempts;
      await prisma.webhookOutbox.update({
        where: { id: row.id },
        data: {
          status: terminal ? "DEAD_LETTER" : "FAILED_RETRYABLE",
          lastError: msg.slice(0, 1000),
          attemptCount: { increment: 1 },
        },
      });
      endTimer({ status: terminal ? "dead_letter" : "network_error" });
      if (terminal) {
        webhookDeadLetterTotal.inc();
        webhooksDeliveryTotal.labels("dead_letter").inc();
      } else {
        webhooksDeliveryTotal.labels("failed_retryable").inc();
      }
      console.info(
        JSON.stringify(
          deliveryLogLine({
            ...row,
            attemptCount: row.attemptCount + 1,
            status: terminal ? "dead_letter" : "failed_retryable",
          }),
        ),
      );
    }
  }

  return { processed: batch.length, sent };
}
