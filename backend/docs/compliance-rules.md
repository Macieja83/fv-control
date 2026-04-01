# Compliance rules (invoice / KSeF filter)

## Principles

- **KSeF is a separate legal channel.** Email, upload, and OCR paths produce **business documents** that are normalized and classified — they are **not** automatically converted into a legally binding KSeF e-invoice.
- **KSeF API ingestion** is treated as the structured **source of truth** for e-invoices received via that channel.
- **Own sales invoices** follow a **KSeF-first** policy: the rules engine sets `ksefRequired = true` and `ksefStatus = TO_ISSUE` until a real connector issues the document (current API uses a **stub** for `send-to-ksef`).
- **Simplified receipts with NIP** (paragon): gross within configured **PLN / EUR** limits uses a simplified operational path (`NOT_APPLICABLE` for mandatory issue); above limits → `MANUAL_REVIEW` for `ksefStatus` (config: `SIMPLIFIED_RECEIPT_MAX_PLN`, `SIMPLIFIED_RECEIPT_MAX_EUR`).

## Engine functions (code)

| Function | Role |
|----------|------|
| `classifyDocumentType()` | Heuristic `document_kind` from filename / declared type (no legal certification). |
| `detectLegalChannel()` | `KSEF` vs `OUTSIDE_KSEF` vs `EXCLUDED` vs `UNKNOWN`. |
| `determineKsefRequirement()` | Whether the tenant must **issue** via KSeF (own sales) vs receive-only vs N/A. |
| `detectDuplicate()` | Maps fingerprint → `duplicate_hash` / score snapshot. |
| `buildAccountingPackage()` | Neutral JSON package for `accounting/export-batch`. |
| `routeReviewStatus()` | **OCR_SCAN**, low OCR confidence, unknown legal channel, or high duplicate score → `NEEDS_REVIEW`. |

Implementation: `src/modules/compliance/compliance-engine.ts`. Persistence and webhooks: `src/modules/compliance/compliance.service.ts`.

## Pipeline

After OCR/dedupe, the worker runs **`COMPLIANCE`** (step) which calls `refreshInvoiceCompliance` so classification stays **auditable** (`invoice_compliance_events`) and aligned with outbox events.

## API touchpoints

- `POST /api/v1/invoices/intake` — creates `invoice_sources` row + applies rules; emits `invoice.ingested` + `invoice.classified` (and `invoice.compliance.flagged` when review required).
- `POST /api/v1/invoices/:id/classify` — override hints and re-run rules.
- `POST /api/v1/invoices/:id/validate-compliance` — full re-evaluation without duplicate classified webhooks.
- `POST /api/v1/invoices/:id/send-to-ksef` — **stub** (sets `PENDING`, records event); replace with real `KsefConnector` in Etap 3.
- `GET /api/v1/invoices?ksefStatus=&intakeSourceType=&reviewStatus=` — operational filtering.
- `POST /api/v1/accounting/export-batch` — marks `accounting_status = EXPORTED`, writes `accounting_exports`, emits `invoice.export.ready`.

## Flags (`compliance_flags` JSON)

Examples: `ocr_requires_review`, `ksef_first_sales`, `simplified_receipt_path`, `external_document_not_auto_legalized`.
