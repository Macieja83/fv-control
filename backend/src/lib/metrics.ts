import { Registry, collectDefaultMetrics, Counter, Histogram, Gauge } from "prom-client";

const registry = new Registry();
collectDefaultMetrics({ register: registry });

export const httpRequestDuration = new Histogram({
  name: "fvcontrol_http_request_duration_seconds",
  help: "HTTP request duration",
  labelNames: ["method", "route", "status_code"] as const,
  registers: [registry],
});

export const pipelineJobsTotal = new Counter({
  name: "fvcontrol_pipeline_jobs_total",
  help: "Pipeline job outcomes",
  labelNames: ["result"] as const,
  registers: [registry],
});

/** Outbound webhook delivery terminal / attempt outcomes (label `status`). */
export const webhooksDeliveryTotal = new Counter({
  name: "fvcontrol_webhook_delivery_total",
  help: "Outbound webhook delivery results",
  labelNames: ["status"] as const,
  registers: [registry],
});

export const webhookDeadLetterTotal = new Counter({
  name: "fvcontrol_webhook_dead_letter_total",
  help: "Outbound webhooks moved to DEAD_LETTER after max attempts",
  registers: [registry],
});

export const webhookDeliveryDurationSeconds = new Histogram({
  name: "fvcontrol_webhook_delivery_duration_seconds",
  help: "Time to complete outbound webhook HTTP delivery",
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
  labelNames: ["status"] as const,
  registers: [registry],
});

export const idempotencyReplayTotal = new Counter({
  name: "fvcontrol_idempotency_replay_total",
  help: "Idempotent replays served from stored response",
  registers: [registry],
});

export const idempotencyConflictTotal = new Counter({
  name: "fvcontrol_idempotency_conflict_total",
  help: "Idempotency conflicts (409)",
  registers: [registry],
});

export const idempotencyStoredTotal = new Counter({
  name: "fvcontrol_idempotency_stored_total",
  help: "Successful idempotent response snapshots stored after 2xx",
  registers: [registry],
});

export const cleanupDeletedTotal = new Counter({
  name: "fvcontrol_cleanup_deleted_total",
  help: "Rows deleted by housekeeping jobs",
  labelNames: ["entity"] as const,
  registers: [registry],
});

export const idempotencyKeysActiveGauge = new Gauge({
  name: "fvcontrol_idempotency_keys_active",
  help: "Idempotency rows not yet expired (any lifecycle)",
  registers: [registry],
});

export const imapSyncRunsTotal = new Counter({
  name: "fvcontrol_imap_sync_runs_total",
  help: "Zenbox IMAP sync job terminal outcomes",
  labelNames: ["status"] as const,
  registers: [registry],
});

export const imapMessagesFetchedTotal = new Counter({
  name: "fvcontrol_imap_messages_fetched_total",
  help: "IMAP messages fetched and parsed in Zenbox sync",
  registers: [registry],
});

export const imapAttachmentsFetchedTotal = new Counter({
  name: "fvcontrol_imap_attachments_fetched_total",
  help: "IMAP attachments stored from Zenbox sync",
  registers: [registry],
});

export const imapDuplicatesSkippedTotal = new Counter({
  name: "fvcontrol_imap_duplicates_skipped_total",
  help: "IMAP idempotency skips (existing message or attachment row)",
  labelNames: ["kind"] as const,
  registers: [registry],
});

export const imapSyncDurationSeconds = new Histogram({
  name: "fvcontrol_imap_sync_duration_seconds",
  help: "Wall time of a Zenbox IMAP sync job (locked section)",
  buckets: [0.5, 1, 2, 5, 10, 30, 60, 120, 300, 600],
  registers: [registry],
});

export const imapLastUidGauge = new Gauge({
  name: "fvcontrol_imap_last_uid",
  help: "Last processed IMAP UID after successful Zenbox sync batch",
  labelNames: ["tenant_id", "account_key"] as const,
  registers: [registry],
});

// ─── KSeF sync (P1-5 z research/ksef-batch-stability.md) ───

export const ksefSyncRunsTotal = new Counter({
  name: "fvcontrol_ksef_sync_runs_total",
  help: "KSeF sync job terminal outcomes",
  labelNames: ["tenant_id", "phase"] as const, // phase: completed | failed | skipped_no_credentials
  registers: [registry],
});

export const ksefSyncDurationSeconds = new Histogram({
  name: "fvcontrol_ksef_sync_duration_seconds",
  help: "Wall time of a KSeF sync job",
  buckets: [1, 5, 15, 30, 60, 120, 300, 600, 1800, 3600],
  labelNames: ["tenant_id"] as const,
  registers: [registry],
});

export const ksefRetryQueueSize = new Gauge({
  name: "fvcontrol_ksef_retry_queue_size",
  help: "Liczba numerów KSeF czekających na ponowny ingest (per tenant). Alert przy >100 = MF outage albo recurring failure.",
  labelNames: ["tenant_id"] as const,
  registers: [registry],
});

export const ksefInvoicesProcessedTotal = new Counter({
  name: "fvcontrol_ksef_invoices_processed_total",
  help: "KSeF invoice processing outcomes per sync run",
  labelNames: ["tenant_id", "outcome"] as const, // outcome: ingested | skipped_duplicate | refetched | error
  registers: [registry],
});

export function getMetricsRegistry(): Registry {
  return registry;
}
