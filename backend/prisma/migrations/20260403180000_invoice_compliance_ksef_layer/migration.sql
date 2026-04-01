-- Compliance / KSeF filter enums
CREATE TYPE "InvoiceIntakeSourceType" AS ENUM ('EMAIL', 'UPLOAD', 'OCR_SCAN', 'KSEF_API', 'CASH_REGISTER');
CREATE TYPE "InvoiceDocumentKind" AS ENUM ('INVOICE', 'CORRECTIVE_INVOICE', 'SIMPLIFIED_INVOICE', 'RECEIPT_WITH_NIP', 'PROFORMA', 'OTHER');
CREATE TYPE "LegalChannel" AS ENUM ('KSEF', 'OUTSIDE_KSEF', 'EXCLUDED', 'UNKNOWN');
CREATE TYPE "KsefWorkflowStatus" AS ENUM ('NOT_APPLICABLE', 'TO_ISSUE', 'SENT', 'RECEIVED', 'REJECTED', 'PENDING', 'MANUAL_REVIEW');
CREATE TYPE "InvoiceReviewStatus" AS ENUM ('NEW', 'PARSED', 'NEEDS_REVIEW', 'ACCEPTED', 'REJECTED');
CREATE TYPE "AccountingRecordStatus" AS ENUM ('NOT_EXPORTED', 'EXPORTED');
CREATE TYPE "InvoiceFileKind" AS ENUM ('PDF', 'XML', 'IMAGE', 'OTHER');
CREATE TYPE "ComplianceEventType" AS ENUM ('INTAKE', 'CLASSIFIED', 'COMPLIANCE_VALIDATED', 'KSEF_SUBMIT_REQUESTED', 'DUPLICATE_DETECTED', 'EXPORT_READY', 'FLAGGED');
CREATE TYPE "AccountingExportStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

ALTER TYPE "PipelineStep" ADD VALUE 'COMPLIANCE';

ALTER TABLE "Invoice" ADD COLUMN "intake_source_type" "InvoiceIntakeSourceType" NOT NULL DEFAULT 'UPLOAD';
ALTER TABLE "Invoice" ADD COLUMN "source_account" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "document_kind" "InvoiceDocumentKind" NOT NULL DEFAULT 'OTHER';
ALTER TABLE "Invoice" ADD COLUMN "legal_channel" "LegalChannel" NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE "Invoice" ADD COLUMN "ksef_required" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Invoice" ADD COLUMN "ksef_status" "KsefWorkflowStatus" NOT NULL DEFAULT 'NOT_APPLICABLE';
ALTER TABLE "Invoice" ADD COLUMN "ksef_number" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "ksef_reference_id" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "ocr_confidence" DECIMAL(5,4);
ALTER TABLE "Invoice" ADD COLUMN "duplicate_hash" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "duplicate_score" DECIMAL(5,4);
ALTER TABLE "Invoice" ADD COLUMN "review_status" "InvoiceReviewStatus" NOT NULL DEFAULT 'NEW';
ALTER TABLE "Invoice" ADD COLUMN "accounting_status" "AccountingRecordStatus" NOT NULL DEFAULT 'NOT_EXPORTED';
ALTER TABLE "Invoice" ADD COLUMN "raw_payload" JSONB;
ALTER TABLE "Invoice" ADD COLUMN "normalized_payload" JSONB;
ALTER TABLE "Invoice" ADD COLUMN "compliance_flags" JSONB;

UPDATE "Invoice" SET "intake_source_type" = CASE
  WHEN "ingestionKind"::text = 'KSEF' THEN 'KSEF_API'::"InvoiceIntakeSourceType"
  WHEN "ingestionKind"::text IN ('MAIL_GMAIL', 'MAIL_IMAP') THEN 'EMAIL'::"InvoiceIntakeSourceType"
  WHEN "ingestionKind"::text = 'RESTA_API' THEN 'CASH_REGISTER'::"InvoiceIntakeSourceType"
  WHEN "ingestionKind"::text = 'MANUAL_UPLOAD' THEN 'UPLOAD'::"InvoiceIntakeSourceType"
  WHEN "source"::text = 'EMAIL' THEN 'EMAIL'::"InvoiceIntakeSourceType"
  WHEN "source"::text = 'OCR' THEN 'OCR_SCAN'::"InvoiceIntakeSourceType"
  ELSE 'UPLOAD'::"InvoiceIntakeSourceType"
END;

CREATE INDEX "Invoice_tenantId_intake_source_type_idx" ON "Invoice"("tenantId", "intake_source_type");
CREATE INDEX "Invoice_tenantId_ksef_status_idx" ON "Invoice"("tenantId", "ksef_status");
CREATE INDEX "Invoice_tenantId_review_status_idx" ON "Invoice"("tenantId", "review_status");

ALTER TABLE "InvoiceFile" ADD COLUMN "file_kind" "InvoiceFileKind";
ALTER TABLE "InvoiceFile" ADD COLUMN "storage_url" TEXT;
ALTER TABLE "InvoiceFile" ADD COLUMN "xml_payload" TEXT;
ALTER TABLE "InvoiceFile" ADD COLUMN "pdf_preview_url" TEXT;
ALTER TABLE "InvoiceFile" ADD COLUMN "original_sha256" TEXT;
ALTER TABLE "InvoiceFile" ADD COLUMN "ocr_text" TEXT;
ALTER TABLE "InvoiceFile" ADD COLUMN "is_primary" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "invoice_sources" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "invoiceId" UUID,
    "intake_source_type" "InvoiceIntakeSourceType" NOT NULL,
    "source_account" TEXT,
    "external_ref" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_sources_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "invoice_compliance_events" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "event_type" "ComplianceEventType" NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_compliance_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "accounting_exports" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "status" "AccountingExportStatus" NOT NULL DEFAULT 'PENDING',
    "invoiceIds" JSONB NOT NULL,
    "package_summary" JSONB,
    "created_by_id" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_exports_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "invoice_sources_tenantId_intake_source_type_idx" ON "invoice_sources"("tenantId", "intake_source_type");
CREATE INDEX "invoice_sources_invoiceId_idx" ON "invoice_sources"("invoiceId");
CREATE INDEX "invoice_compliance_events_tenantId_invoiceId_idx" ON "invoice_compliance_events"("tenantId", "invoiceId");
CREATE INDEX "invoice_compliance_events_invoiceId_createdAt_idx" ON "invoice_compliance_events"("invoiceId", "createdAt");
CREATE INDEX "accounting_exports_tenantId_createdAt_idx" ON "accounting_exports"("tenantId", "createdAt");

ALTER TABLE "invoice_sources" ADD CONSTRAINT "invoice_sources_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invoice_sources" ADD CONSTRAINT "invoice_sources_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invoice_compliance_events" ADD CONSTRAINT "invoice_compliance_events_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invoice_compliance_events" ADD CONSTRAINT "invoice_compliance_events_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "accounting_exports" ADD CONSTRAINT "accounting_exports_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
