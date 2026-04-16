# Runbooks

## API won’t start — config errors

**Symptoms:** process exits on boot with `Invalid environment`.

**Checks:**

1. Compare `.env` to `.env.example` — all required keys present.
2. `JWT_*` length ≥ 32 characters.
3. `ENCRYPTION_KEY` is base64 of **32 bytes**.
4. In production ensure:
   - `FEATURE_AI_EXTRACTION_MOCK=false`,
   - `WEBHOOK_SIGNING_SECRET` set,
   - `METRICS_BEARER_TOKEN` set.

## Database connection failures

**Symptoms:** `/api/v1/ready` returns `database: down`.

**Checks:**

1. `docker compose ps` — Postgres healthy.
2. `DATABASE_URL` host/port match compose network (use `postgres` hostname inside Docker).

## Redis / queue issues

**Symptoms:** manual upload returns 500 “Queue unavailable”; `/api/v1/ready` shows `redis: down`.

**Checks:**

1. `redis-cli ping` from host or `docker compose exec redis redis-cli ping`.
2. `REDIS_URL` points to `redis://redis:6379` in compose.

## Worker not processing jobs

**Symptoms:** `processing_jobs` stuck `PENDING`; BullMQ queue depth grows.

**Checks:**

1. `worker` container running: `docker compose logs worker -f`.
2. Same `REDIS_URL` and `BULLMQ_PREFIX` as API.
3. Run `npx prisma migrate deploy` on worker image (compose command includes it).

## Pipeline DLQ / FAILED_NEEDS_REVIEW

**Symptoms:** invoice status `FAILED_NEEDS_REVIEW`; job `DEAD_LETTER`.

**Checks:**

1. Read `processing_jobs.lastError` and latest `processing_attempts`.
2. Fix data (e.g. extraction produced no number) and **re-enqueue** (future admin endpoint) or patch invoice manually.
3. If extraction mock disabled, re-enable `FEATURE_AI_EXTRACTION_MOCK=true` in dev.

## MinIO / S3 upload errors

**Symptoms:** 500 on upload when `STORAGE_DRIVER=s3`.

**Checks:**

1. `S3_ENDPOINT`, keys, bucket exist; `S3_FORCE_PATH_STYLE=true` for MinIO.
2. Bucket created (MinIO console on port 9001).

## Webhook signature failures

**Symptoms:** `401` on `POST /api/v1/webhooks/inbound`.

**Checks:**

1. **FVControl headers:** verify `X-FVControl-Signature` = `sha256=<hex>` over `${timestamp}.${rawBody}` (canonical JSON with sorted keys). Clock skew must be within **`WEBHOOK_MAX_SKEW_SECONDS`**.
2. **Legacy `X-Signature`:** must match `HMAC_SHA256(secret, JSON.stringify(parsedBody))` — sensitive to key order; prefer FVControl headers.
3. If secret unset, only use unsigned mode in **trusted dev** networks.
4. Never log raw bodies or secrets when debugging; use delivery/request IDs only.

## Outbound webhooks stuck PENDING

**Symptoms:** `webhooks_outbox` rows never become `SENT`.

**Checks:**

1. Worker is running (`npm run worker` or `docker compose` service `worker`).
2. `WEBHOOK_SIGNING_SECRET` matches what n8n expects for verification (if you verify outbound calls). Algorithm: see [security-hardening.md](./security-hardening.md).
3. Target `url` is reachable from the worker network (not `example.invalid`).
4. Inspect `lastError` and metrics `fvcontrol_webhook_delivery_total{status="…"}`, `fvcontrol_webhook_delivery_duration_seconds`.
5. Tune `WEBHOOK_DELIVERY_INTERVAL_MS`, `WEBHOOK_HTTP_TIMEOUT_MS`, `WEBHOOK_DELIVERY_MAX_ATTEMPTS`, `WEBHOOK_PROCESSING_STALE_MS`.

## Outbound webhooks in DEAD_LETTER

**Symptoms:** `webhooks_outbox.status = DEAD_LETTER` or rising `fvcontrol_webhook_dead_letter_total`.

**Checks:**

1. `GET /api/v1/admin/webhooks/dlq` (OWNER/ADMIN) — review `lastError`, `eventType`, `attemptCount`.
2. Fix URL, TLS, or receiver validation; then `POST /api/v1/admin/webhooks/:deliveryId/retry` to re-queue.
3. Confirm receiver verifies **timestamp + signature** correctly (skew, raw body).

## Integration credentials rotation (AES-GCM)

**Context:** `integration_credentials.secret_encrypted` uses **AES-256-GCM** with `ENCRYPTION_KEY` (32-byte base64). Rotation avoids long-lived single-key exposure.

**Design (dual-key window):**

1. Introduce **`ENCRYPTION_KEY_NEXT`** (optional env) — decrypt tries current key first, then next; encrypt always uses **primary** until cutover.
2. Run a **one-off maintenance job** (or SQL + script): for each row, decrypt with old, re-encrypt with new primary, update `secret_encrypted`.
3. Swap env: make **next** the primary, remove old after verification window.

**Operational steps:**

1. Generate new 32-byte key (`openssl rand -base64 32`).
2. Deploy with `ENCRYPTION_KEY_NEXT` set; run re-encrypt job against staging first.
3. Verify connectors (Gmail/IMAP/KSeF stubs → real) still decrypt.
4. Promote new key to `ENCRYPTION_KEY`, clear `ENCRYPTION_KEY_NEXT` after job completes.

**KMS adapter (future):** replace `encryptSecret`/`decryptSecret` with envelope encryption (e.g. AWS KMS data key per tenant); keep same DB column shape.

## Zenbox IMAP — credentials rotation & recovery

**Symptoms:** `GET /api/v1/connectors/zenbox/accounts/:accountKey/status` shows `status: ERROR` or `lastError` with auth / TLS / mailbox errors.

**Rotate password (API):**

1. Call **`PATCH /api/v1/connectors/zenbox/accounts/:accountKey`** with full body (`host`, `port`, `username`, `password`, `tls`, `mailbox`). This bumps `integration_credentials.key_version` and replaces the encrypted blob.
2. Trigger **`POST .../sync`** and confirm `status` returns to `IDLE` and `lastSyncAt` updates.

**Force re-sync after UIDVALIDITY change:**

- Server mailbox rebuild changes **UIDVALIDITY**; the worker detects mismatch vs `imap_uid_validity_str` and **resets the UID cursor** automatically on the next successful sync.

**Stuck sync / parallel runs:**

- Only one sync per `(tenantId, accountKey)` should run (Redis lock). If a worker died mid-flight, wait for **`IMAP_ZENBOX_LOCK_TTL_SEC`** or clear the key `${BULLMQ_PREFIX}:imap:zenbox:sync:<tenantId>:<accountKey>` in Redis in emergencies.

**Duplicates & skipped messages:**

- Rising **`fvcontrol_imap_duplicates_skipped_total{kind="message"}`** — same `externalMessageId` seen again (expected after re-delivery). **`kind="attachment"`** — same SHA-256 already stored for that message.
- Global PDF dedupe still uses **`documents.sha256`** per tenant (existing intake behaviour).

**DLQ-ready jobs:**

- Transient IMAP/network errors → BullMQ **retries** with backoff. **Permanent** errors (e.g. authentication) → `UnrecoverableError`; job fails without endless retry. Inspect failed jobs in Redis/BullMQ UI; fix credentials and re-enqueue via **`POST .../sync`**.

## Known risks + mitigations

| Risk | Mitigation |
|------|------------|
| **Duplicate logic false positives** | Threshold tuning; human review queue; `PATCH /duplicates/:id/resolve`. |
| **OAuth token leakage** | Encrypt at rest; never log plaintext; short-lived access + rotation. |
| **Queue overload** | Horizontal workers; job concurrency limits; back-pressure on ingest. |
| **Large attachments** | Virus scan hook; size limits; object storage lifecycle. |
| **PII in logs** | Redaction middleware; avoid logging full payloads in prod. |
| **Multipart idempotency** | `Idempotency-Key` applies to JSON POST/PATCH only; uploads use SHA-256 document dedupe instead. |
