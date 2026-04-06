# n8n integration

**OpenClaw (Discord) + n8n:** kiedy użyć agenta, a kiedy workflow — [openclaw-n8n-hybrid.md](./openclaw-n8n-hybrid.md).

## Outbound (FVControl → n8n)

1. Pipeline step **EMIT_EVENTS** inserts into **`webhooks_outbox`** with `eventType` (e.g. `invoice.processed`), target `url`, and JSON `payload`.
2. Process **`npm run worker`** (or the `worker` container in Docker Compose) every **`WEBHOOK_DELIVERY_INTERVAL_MS`** ms:
   - Claims rows in **`PENDING`** or **`FAILED_RETRYABLE`** (after exponential backoff) into **`PROCESSING`** (compare-and-set per row).
   - Sends **POST** to `url` with body = **canonical JSON** (sorted object keys — same string that is signed).
   - If **`WEBHOOK_SIGNING_SECRET`** is set, adds:
     - **`X-FVControl-Timestamp`**: Unix seconds (string)
     - **`X-FVControl-Signature`**: `sha256=<hex>` where hex = HMAC-SHA256(secret, `${timestamp}.${rawBody}`) as UTF-8
     - **`X-FVControl-Delivery-Attempt`**: 1-based attempt number
   - On **2xx**: **`SENT`**. On network/HTTP failure: **`FAILED_RETRYABLE`**, `attemptCount++`, `lastError`. After **`WEBHOOK_DELIVERY_MAX_ATTEMPTS`**: **`DEAD_LETTER`** (and metric `fvcontrol_webhook_dead_letter_total`).
   - Stale **`PROCESSING`** rows (worker crash) are reclaimed to **`FAILED_RETRYABLE`** after **`WEBHOOK_PROCESSING_STALE_MS`**.

### Wysyłane nagłówki

- `Content-Type: application/json`
- `X-FVControl-Event: <eventType z wiersza>`
- `X-FVControl-Delivery-Id: <uuid wiersza outbox>`
- `X-FVControl-Timestamp`, `X-FVControl-Signature` (gdy skonfigurowano sekret)
- `X-FVControl-Delivery-Attempt` (numer próby)
- `User-Agent: FVControl-Webhook/1.0 (…)`

Verification on the n8n side: use the **raw body** string and the algorithm in [security-hardening.md](./security-hardening.md).

### Compliance / pipeline event types (outbox)

| `eventType` | When |
|-------------|------|
| `invoice.ingested` | Intake or pipeline persisted invoice + source |
| `invoice.classified` | After `classifyDocumentType` / legal channel refresh |
| `invoice.duplicate.detected` | Duplicate hash/score set |
| `invoice.compliance.flagged` | Compliance rules produced flags / review |
| `invoice.export.ready` | Accounting package built (`export-batch` or compliance export) |

### Idempotency on the n8n side

- FVControl may **retry** deliveries; use **`X-FVControl-Delivery-Id`** (or payload `invoiceId` + `eventType`) in a **dedupe store** (Set node → DB) so workflows do not double-post to ERP.
- For **inbound** calls **to** FVControl, send **`Idempotency-Key`** on mutating POST/PATCH when the HTTP Request node supports custom headers.

### n8n Function node — verify signature (sketch)

```javascript
const crypto = require('crypto');
const secret = $env.WEBHOOK_SIGNING_SECRET;
const rawBody = $input.first().json.bodyRaw ?? $input.first().json.body;
const ts = $input.first().json.headers['x-fvcontrol-timestamp'];
const sig = ($input.first().json.headers['x-fvcontrol-signature'] || '').replace(/^sha256=/i, '');
const expected = crypto.createHmac('sha256', secret).update(`${ts}.${rawBody}`, 'utf8').digest('hex');
return [{ json: { ok: sig.length === 64 && crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex')) } }];
```

(Prefer **Webhook** raw body mode or a small **proxy** that preserves raw bytes; see [security-hardening.md](./security-hardening.md).)

## Inbound (n8n → FVControl)

- `POST /api/v1/webhooks/inbound` — rate limited.
- If **`WEBHOOK_SIGNING_SECRET`** is set:
  - **Preferred:** `X-FVControl-Signature` + `X-FVControl-Timestamp` (same construction as outbound; enforce **`WEBHOOK_MAX_SKEW_SECONDS`**).
  - **Legacy:** `X-Signature` = `hex(HMAC_SHA256(secret, JSON.stringify(body)))` (ordering must match `JSON.stringify` — fragile; migrate to FVControl headers).
- Use for **human approvals**, **manual corrections**, or **kicking a reprocess** job (extend handler to enqueue BullMQ).

## Auth for REST nodes in n8n

- Obtain **access token** via `POST /api/v1/auth/login` (or refresh flow).
- Pass `Authorization: Bearer <access>` on HTTP Request nodes hitting `/api/v1/*`.

## Admin (retry / DLQ)

- **`POST /api/v1/admin/webhooks/:deliveryId/retry`** — OWNER/ADMIN; moves **`DEAD_LETTER`** or **`FAILED_RETRYABLE`** back to **`PENDING`**.
- **`GET /api/v1/admin/webhooks/dlq`** — list **`DEAD_LETTER`** with `cursor`, `limit`, optional **`eventType`**.

## Zenbox IMAP → pipeline → outbox

1. Admin registers Zenbox in **`POST /api/v1/connectors/zenbox/accounts`** and triggers **`POST /api/v1/connectors/zenbox/accounts/:accountKey/sync`** (or the worker consumes recurring jobs you enqueue from n8n/cron).
2. Worker job **`imap:sync:zenbox`** fetches new UIDs, writes **`source_messages` / `source_attachments`**, then calls the same **`ingestAttachmentAndEnqueue`** path as manual upload: **`Document` + `Invoice` + `processing_jobs`** on queue **`fvcontrol-pipeline`**.
3. When the pipeline reaches **EMIT_EVENTS**, rows appear in **`webhooks_outbox`** with types such as **`invoice.ingested`** / **`invoice.classified`** (see table above). n8n should **dedupe** on `invoiceId` + `eventType` because retries are normal.

## Example flows

1. **After ingest:** n8n receives `invoice.processed` → branch on `status` / `duplicatesOpen` → notify Slack / create task.
2. **Zenbox poll:** scheduled n8n workflow (HTTP Request with admin token) calls **`POST /api/v1/connectors/zenbox/accounts/<key>/sync`** every N minutes; ensure only one schedule per account to avoid redundant enqueue (worker still dedupes with Redis lock).
3. **KSeF poll:** (future) scheduled n8n workflow calls internal connector endpoint → enqueue sync job (once exposed securely).
