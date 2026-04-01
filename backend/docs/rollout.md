# Deployment rollout plan

## Stage 1 — Core + manual upload ✅ (baseline in repo)

- Fastify API `/api/v1`, Prisma schema, migrations, seed, auth, invoices CRUD (existing).
- **Manual upload** `POST /api/v1/ingestion/manual-upload` → `Document` + `Invoice` + BullMQ **pipeline** job.
- **Dedup** scoring + `invoice_duplicates` rows.
- **Dashboard** summary + review queue endpoints.
- **Docker Compose:** Postgres, Redis, MinIO, API, Worker.

## Stage 2 — Gmail + Zenbox

- Implement real **Gmail** OAuth routes + token refresh; encrypted storage; sync worker; attachment download to S3/local.
- Implement **IMAP** session pool, IDLE + poller; MIME parser; error taxonomy for disconnects.
- Wire **mailbox** rows to **credentials**; surface sync errors on dashboard.

**Szczegółowa kolejność PR (3× Gmail + Zenbox, potem KSeF):** [integration-rollout-prs.md](./integration-rollout-prs.md).

## Stage 3 — KSeF + POS

- **KSeF** client with environment-aware base URL (`KSEF_ENV`), certificate or token auth via `IntegrationCredential`.
- **Resta** read client; map list endpoints to internal invoice model; idempotent creates.
- Expand **InvoiceLink** usage for traceability.

## Stage 4 — AI + auto-workflows

- Replace **mock** `AiInvoiceAdapter` with provider implementation (env + KMS for keys).
- **AnomalyCheck** drives `PENDING_REVIEW` vs auto-accept policies per `TenantSetting`.
- Auto-merge low-risk duplicates; escalation paths for high-risk.

## Environment promotion

| | dev | staging | prod |
|---|-----|---------|------|
| DB | docker | managed PG | managed PG + backups |
| Redis | docker | managed | managed |
| Storage | local / MinIO | S3-compatible | S3 + lifecycle |
| Secrets | `.env` | vault / CI secrets | KMS + rotation |
| Metrics | `/metrics` scrape | same + alerts | same + SLO dashboards |
