# FVControl — data model (Prisma / PostgreSQL)

## Multi-tenancy

- **`Tenant`** — all operational data is scoped by `tenantId`.
- Soft delete: `Tenant.deletedAt`, `Contractor.deletedAt`, `Document.deletedAt` where applicable.

## Identity & RBAC

- **`User`** — `email`, `passwordHash`, legacy enum **`role`** (JWT compatibility).
- **`roles`**, **`permissions`**, **`role_permissions`**, **`user_roles`** — full RBAC graph (seeded).
- **`RefreshToken`** — hashed opaque refresh tokens with rotation.

## Invoices & accounting

- **`Invoice`** — amounts as `Decimal`; optional **`contractorId`** for unmatched ingests; **`ingestionKind`** + **`sourceExternalId`** unique per tenant when set; **`fingerprint`** (SHA-256 of normalized logical key).
- **`InvoiceItem`**, **`InvoiceFile`**, **`InvoiceEvent`** — lines, files, audit-style invoice events.
- **`InvoiceLink`** — cross-system references (KSeF, POS, …).
- **`InvoiceDuplicate`** — candidate vs canonical, `confidence`, `reasonCodes` (JSON), `resolution`.

## Documents & extraction

- **`Document`** — raw bytes metadata: `sha256`, `storageKey`, optional S3 bucket, `sourceType`, `sourceExternalId`, JSON `metadata`.
- **`ExtractionRun`** — OCR/LLM attempts linked to `document` / optional `invoice`.

## Processing & reliability

- **`ProcessingJob`** — DB mirror of pipeline work: `status`, `currentStep`, `attemptCount`, `maxAttempts`, `correlationId`, JSON `payload`.
- **`ProcessingAttempt`** — per-step attempts for forensic timelines.

## Channels

- **`Mailbox`** + **`MailboxSyncState`** — Gmail / IMAP cursors (`historyId`, `UIDVALIDITY` / `UIDNEXT`).
- **`IngestionSource`** — registry rows per channel instance (`MAIL_GMAIL`, `MAIL_IMAP`, `KSEF`, `RESTA_API`, `MANUAL_UPLOAD`).

## Integrations

- **`IntegrationCredential`** — encrypted secret blob per connector + label (OAuth, IMAP password, API key, KSeF material).
- **`IntegrationPos`** — legacy POS Resta row (kept for backward compatibility).

## Webhooks & audit

- **`WebhookOutbox`** — event fan-out; status **`PENDING` | `PROCESSING` | `SENT` | `FAILED_RETRYABLE` | `DEAD_LETTER`** (legacy enum label `FAILED` unused after migration), `attemptCount`, `lastError`.
- **`AuditLog`** — admin/integration actions with `entityType` / `entityId` / JSON metadata.

## Idempotency

- **`IdempotencyKey`** — unique `(tenantId, idempotency_key, route_fingerprint)`; `lifecycle` `IN_FLIGHT` | `COMPLETED`; stores response snapshot until `expiresAt` (nullable body/status while in flight).

- **`Invoice` (compliance)** — `intake_source_type`, `source_account`, `document_kind`, `legal_channel`, `ksef_required`, `ksef_status`, `ksef_number`, `ksef_reference_id`, `ocr_confidence`, `duplicate_hash`, `duplicate_score`, `review_status`, `accounting_status`, `raw_payload`, `normalized_payload`, `compliance_flags` (JSON). Legacy `source` / `ingestionKind` retained for compatibility.

- **`invoice_sources`** — intake audit rows (`InvoiceSourceRecord`): mailbox/account label, `external_ref`, metadata.

- **`invoice_compliance_events`** — append-only compliance audit trail (`CLASSIFIED`, `COMPLIANCE_VALIDATED`, `KSEF_SUBMIT_REQUESTED`, …).

- **`accounting_exports`** — batch export jobs (`invoiceIds` JSON array, `package_summary`).

- **`InvoiceFile` (extended)** — optional `file_kind`, `storage_url`, `xml_payload`, `pdf_preview_url`, `original_sha256`, `ocr_text`, `is_primary`.

## Settings

- **`TenantSetting`** — arbitrary JSON per key (feature flags, UI prefs).

## PostgreSQL extensions

- **`pg_trgm`** enabled in migration for future similarity queries on invoice numbers / text fields.

## Important constraints

- **Uniqueness:** `Invoice` `(tenantId, number)`; `(tenantId, ingestionKind, sourceExternalId)` when external id present.
- **Document:** `(tenantId, sourceType, sourceExternalId)` unique (multiple `NULL` external ids allowed in Postgres).
- **Dedup file hash:** enforced in application layer on manual upload (`sha256` per tenant); optional DB unique can be added if one document per hash is required.
