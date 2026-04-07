# FVControl — connectors

Each connector is an **adapter** behind a small TypeScript interface (see `src/connectors/connector.interfaces.ts`). Production implementations should live under `src/adapters/connectors/` and be registered in a factory that reads **`IntegrationCredential`** rows (secrets decrypted with `ENCRYPTION_KEY`).

## Gmail (×3 mailboxes)

- **Auth:** OAuth2 per mailbox; store **refresh token encrypted** in `integration_credentials` (`kind: OAUTH_TOKENS`).
- **Sync:** incremental via `historyId` stored in `mailbox_sync_state`.
- **Attachments:** fetch by `attachmentId` after message list diff.
- **Push:** Google Pub/Sub watch — prepare **interface** + service account topic; start with **polling worker** if needed.

## Zenbox (IMAP) — live

- **Code:** `ZenboxImapFlowTransport` (`src/modules/zenbox/zenbox-imap.connector.ts`), sync orchestration `zenbox-imap-sync.service.ts`, credentials `zenbox-credentials.service.ts`.
- **Credentials:** `IntegrationCredential` with `connector = IMAP_ZENBOX`, `kind = IMAP_PASSWORD`; JSON payload encrypted with existing **AES-256-GCM** (`ENCRYPTION_KEY`). Linked `Mailbox` row (`provider = IMAP`, `label = accountKey`).
- **Cursor:** `mailbox_sync_state.imap_uid_validity_str` + `imap_last_processed_uid` (last UID processed). If **UIDVALIDITY** changes vs stored string, cursor resets (re-sync from start of UID space).
- **Idempotency:** `source_messages` unique on `(tenantId, ZENBOX_IMAP, accountKey, externalMessageId)`; `source_attachments` unique on `(sourceMessageId, sha256)`. `externalMessageId` = `Message-ID` when present, else `imap:<uidvalidity>:<uid>`.
- **Worker:** BullMQ queue **`imap-sync-zenbox`** (see `queue-constants.ts`); processed by **`npm run worker`** alongside pipeline + webhooks. Per-tenant/account Redis lock (`IMAP_ZENBOX_LOCK_TTL_SEC`).
- **API (OWNER/ADMIN):** `POST/PATCH /api/v1/connectors/zenbox/accounts`, `POST .../sync`, `GET .../status`. Setup: [zenbox-imap-setup.md](./zenbox-imap-setup.md).
- **Metrics:** `fvcontrol_imap_*` on `/metrics` (runs, messages, attachments, duplicates skipped, duration, last UID gauge).

## KSeF

- **Connector:** `KsefConnector` — `listSince`, `fetchOne`.
- **Storage:** map KSeF document id → `Document.sourceExternalId` + `InvoiceLink`.
- **Errors:** classify auth vs rate-limit vs validation; map to retry policy (transient → BullMQ retry, fatal → `FAILED_NEEDS_REVIEW`).

## Resta POS API

- **Connector:** `RestaPosConnector` — read-only listing first; map external DTO → internal `Invoice` + `Contractor` (create or link by NIP).
- **Config:** can reuse `IntegrationPos` or migrate to `IntegrationCredential` (`RESTA_POS`).

## Stubs (current)

`createStubGmailConnector`, `createStubImapConnector` (Zenbox **live** path does not use this stub), `createStubKsefConnector`, `createStubRestaConnector` return empty/safe data so **`GET /api/v1/connectors/status`** can verify wiring without secrets.

## Contract tests

See `src/connectors/connector.contract.test.ts` (Vitest) for minimal shape guarantees.

## Credentials & rotation

- **Storage:** `integration_credentials.secret_encrypted` — AES-256-GCM via `ENCRYPTION_KEY` (see `src/lib/encryption.ts`).
- **Rotation design:** add a new 32-byte key, re-encrypt credentials in a maintenance job, deploy with dual-read window, then retire old key. Operational steps: [runbooks.md](./runbooks.md) (Integration credentials rotation).
- **Gmail multi-account:** one `IntegrationCredential` row per mailbox (OAuth refresh token); worker resolves connector + credential by `mailbox.credentialId`.
