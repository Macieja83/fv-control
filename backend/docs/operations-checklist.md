# Operations checklist

## Before production deploy

1. **Migrations:** `npx prisma migrate deploy` on API and worker (see Makefile / compose).
2. **Secrets:** `JWT_*`, `ENCRYPTION_KEY`, `WEBHOOK_SIGNING_SECRET`, `METRICS_BEARER_TOKEN` (production values).
3. **Worker:** at least one `worker` process running (outbox sweep + housekeeping + BullMQ).
4. **Metrics:** scrape `GET /metrics` (Prometheus) with `Authorization: Bearer <METRICS_BEARER_TOKEN>`. Confirm counters increase under load tests.

## Key metrics

| Metric | Meaning |
|--------|---------|
| `fvcontrol_idempotency_keys_active` | Non-expired idempotency rows |
| `fvcontrol_idempotency_replay_total` | Cached replays |
| `fvcontrol_idempotency_stored_total` | New idempotency rows stored (first completion per key) |
| `fvcontrol_idempotency_conflict_total` | 409 conflicts |
| `fvcontrol_webhook_delivery_total{status="sent"}` | Successful deliveries |
| `fvcontrol_webhook_delivery_total{status="dead_letter"}` | Terminal failures |
| `fvcontrol_webhook_dead_letter_total` | Rows moved to DLQ (counter) |
| `fvcontrol_webhook_delivery_duration_seconds` | Delivery latency histogram |
| `fvcontrol_cleanup_deleted_total` (`entity` = `idempotency` or `webhook`) | Housekeeping deletions |

## DLQ monitoring

1. Query `fvcontrol_webhook_dead_letter_total` and `fvcontrol_webhook_delivery_total{status="dead_letter"}`.
2. List rows: `GET /api/v1/admin/webhooks/dlq?limit=50` (OWNER/ADMIN JWT).
3. Inspect `lastError` on rows; fix upstream URL, auth, or payload issues.

## Manual retry

- `POST /api/v1/admin/webhooks/:deliveryId/retry` with tenant OWNER/ADMIN token.
- Resets delivery to **`PENDING`**, `attemptCount = 0`, clears `lastError`.

## Housekeeping

- Worker runs **idempotency expiry purge** and optional **`SENT` outbox retention** (`WEBHOOK_OUTBOX_SENT_RETENTION_DAYS`, default 90).
- **Gauge** `fvcontrol_idempotency_keys_active` refreshed on the same interval (`HOUSEKEEPING_INTERVAL_MS`).
