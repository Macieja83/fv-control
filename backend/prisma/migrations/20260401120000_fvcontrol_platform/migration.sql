-- Optional fuzzy search (duplicate / number similarity)
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateEnum
CREATE TYPE "IngestionSourceType" AS ENUM ('MAIL_GMAIL', 'MAIL_IMAP', 'KSEF', 'RESTA_API', 'MANUAL_UPLOAD');

-- CreateEnum
CREATE TYPE "MailboxProvider" AS ENUM ('GMAIL', 'IMAP');

-- CreateEnum
CREATE TYPE "ConnectorType" AS ENUM ('GMAIL', 'IMAP_ZENBOX', 'KSEF', 'RESTA_POS', 'MANUAL');

-- CreateEnum
CREATE TYPE "ProcessingJobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'DEAD_LETTER');

-- CreateEnum
CREATE TYPE "PipelineStep" AS ENUM ('INGEST', 'PERSIST_RAW', 'PARSE_METADATA', 'EXTRACT', 'VALIDATE', 'DEDUP', 'CLASSIFY', 'EMIT_EVENTS', 'AUDIT');

-- CreateEnum
CREATE TYPE "DuplicateResolution" AS ENUM ('OPEN', 'MERGED', 'IGNORED', 'FALSE_POSITIVE');

-- CreateEnum
CREATE TYPE "WebhookDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "IntegrationCredentialKind" AS ENUM ('OAUTH_TOKENS', 'IMAP_PASSWORD', 'API_KEY', 'KSEF_CERT', 'GENERIC_SECRET');

-- CreateEnum
CREATE TYPE "AuditEntityType" AS ENUM ('TENANT', 'USER', 'INVOICE', 'DOCUMENT', 'INTEGRATION', 'WEBHOOK', 'SETTINGS');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "InvoiceStatus" ADD VALUE 'INGESTING';
ALTER TYPE "InvoiceStatus" ADD VALUE 'PENDING_REVIEW';
ALTER TYPE "InvoiceStatus" ADD VALUE 'FAILED_NEEDS_REVIEW';

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "fingerprint" TEXT,
ADD COLUMN     "ingestionKind" "IngestionSourceType",
ADD COLUMN     "primaryDocId" UUID,
ADD COLUMN     "sourceExternalId" TEXT,
ADD COLUMN     "updatedById" UUID,
ALTER COLUMN "contractorId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "InvoiceFile" ADD COLUMN     "documentId" UUID;

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Permission" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "roleId" UUID NOT NULL,
    "permissionId" UUID NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "userId" UUID NOT NULL,
    "roleId" UUID NOT NULL,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "sha256" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "storageBucket" TEXT,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sourceType" "IngestionSourceType",
    "sourceExternalId" TEXT,
    "metadata" JSONB,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_links" (
    "id" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "targetSystem" "IngestionSourceType" NOT NULL,
    "externalId" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_duplicates" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "candidateInvoiceId" UUID NOT NULL,
    "canonicalInvoiceId" UUID NOT NULL,
    "confidence" DECIMAL(5,4) NOT NULL,
    "reasonCodes" JSONB NOT NULL,
    "resolution" "DuplicateResolution" NOT NULL DEFAULT 'OPEN',
    "resolvedById" UUID,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoice_duplicates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extraction_runs" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "invoiceId" UUID,
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "rawJson" JSONB,
    "confidence" DECIMAL(5,4),
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "extraction_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processing_jobs" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "queueName" TEXT NOT NULL,
    "bullJobId" TEXT,
    "type" TEXT NOT NULL,
    "status" "ProcessingJobStatus" NOT NULL DEFAULT 'PENDING',
    "currentStep" "PipelineStep",
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 8,
    "correlationId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "lastError" TEXT,
    "documentId" UUID,
    "invoiceId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "processing_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processing_attempts" (
    "id" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "attemptNo" INTEGER NOT NULL,
    "step" "PipelineStep" NOT NULL,
    "errorClass" TEXT,
    "message" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "processing_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mailboxes" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "provider" "MailboxProvider" NOT NULL,
    "label" TEXT NOT NULL,
    "credentialId" UUID,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mailboxes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mailbox_sync_state" (
    "id" UUID NOT NULL,
    "mailboxId" UUID NOT NULL,
    "historyId" TEXT,
    "uidValidity" INTEGER,
    "uidNext" INTEGER,
    "lastSyncedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mailbox_sync_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingestion_sources" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "kind" "IngestionSourceType" NOT NULL,
    "label" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ingestion_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_credentials" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "connector" "ConnectorType" NOT NULL,
    "kind" "IntegrationCredentialKind" NOT NULL,
    "label" TEXT NOT NULL,
    "secretEncrypted" TEXT NOT NULL,
    "metadata" JSONB,
    "rotatedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,

    CONSTRAINT "integration_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhooks_outbox" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "eventType" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "WebhookDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhooks_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "actorId" UUID,
    "action" TEXT NOT NULL,
    "entityType" "AuditEntityType" NOT NULL,
    "entityId" TEXT,
    "metadata" JSONB NOT NULL,
    "ip" TEXT,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "responseStatus" INTEGER NOT NULL,
    "responseBody" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_settings" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "valueJson" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "tenant_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Permission_key_key" ON "Permission"("key");

-- CreateIndex
CREATE INDEX "roles_tenantId_idx" ON "roles"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "roles_tenantId_slug_key" ON "roles"("tenantId", "slug");

-- CreateIndex
CREATE INDEX "documents_tenantId_sha256_idx" ON "documents"("tenantId", "sha256");

-- CreateIndex
CREATE INDEX "documents_tenantId_idx" ON "documents"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "documents_tenantId_sourceType_sourceExternalId_key" ON "documents"("tenantId", "sourceType", "sourceExternalId");

-- CreateIndex
CREATE INDEX "invoice_links_invoiceId_idx" ON "invoice_links"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_links_invoiceId_targetSystem_externalId_key" ON "invoice_links"("invoiceId", "targetSystem", "externalId");

-- CreateIndex
CREATE INDEX "invoice_duplicates_tenantId_resolution_idx" ON "invoice_duplicates"("tenantId", "resolution");

-- CreateIndex
CREATE INDEX "invoice_duplicates_candidateInvoiceId_idx" ON "invoice_duplicates"("candidateInvoiceId");

-- CreateIndex
CREATE INDEX "extraction_runs_documentId_idx" ON "extraction_runs"("documentId");

-- CreateIndex
CREATE INDEX "extraction_runs_invoiceId_idx" ON "extraction_runs"("invoiceId");

-- CreateIndex
CREATE INDEX "processing_jobs_tenantId_status_idx" ON "processing_jobs"("tenantId", "status");

-- CreateIndex
CREATE INDEX "processing_jobs_correlationId_idx" ON "processing_jobs"("correlationId");

-- CreateIndex
CREATE INDEX "processing_attempts_jobId_idx" ON "processing_attempts"("jobId");

-- CreateIndex
CREATE INDEX "mailboxes_tenantId_idx" ON "mailboxes"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "mailbox_sync_state_mailboxId_key" ON "mailbox_sync_state"("mailboxId");

-- CreateIndex
CREATE INDEX "ingestion_sources_tenantId_idx" ON "ingestion_sources"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "ingestion_sources_tenantId_kind_label_key" ON "ingestion_sources"("tenantId", "kind", "label");

-- CreateIndex
CREATE INDEX "integration_credentials_tenantId_idx" ON "integration_credentials"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "integration_credentials_tenantId_connector_label_key" ON "integration_credentials"("tenantId", "connector", "label");

-- CreateIndex
CREATE INDEX "webhooks_outbox_tenantId_status_idx" ON "webhooks_outbox"("tenantId", "status");

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_createdAt_idx" ON "audit_logs"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "idempotency_keys_expiresAt_idx" ON "idempotency_keys"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_tenantId_key_route_key" ON "idempotency_keys"("tenantId", "key", "route");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_settings_tenantId_key_key" ON "tenant_settings"("tenantId", "key");

-- CreateIndex
CREATE INDEX "Invoice_tenantId_status_idx" ON "Invoice"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Invoice_tenantId_fingerprint_idx" ON "Invoice"("tenantId", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_tenantId_ingestionKind_sourceExternalId_key" ON "Invoice"("tenantId", "ingestionKind", "sourceExternalId");

-- CreateIndex
CREATE INDEX "InvoiceFile_documentId_idx" ON "InvoiceFile"("documentId");

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_primaryDocId_fkey" FOREIGN KEY ("primaryDocId") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceFile" ADD CONSTRAINT "InvoiceFile_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_links" ADD CONSTRAINT "invoice_links_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_duplicates" ADD CONSTRAINT "invoice_duplicates_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_duplicates" ADD CONSTRAINT "invoice_duplicates_candidateInvoiceId_fkey" FOREIGN KEY ("candidateInvoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_duplicates" ADD CONSTRAINT "invoice_duplicates_canonicalInvoiceId_fkey" FOREIGN KEY ("canonicalInvoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extraction_runs" ADD CONSTRAINT "extraction_runs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extraction_runs" ADD CONSTRAINT "extraction_runs_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extraction_runs" ADD CONSTRAINT "extraction_runs_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing_jobs" ADD CONSTRAINT "processing_jobs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing_jobs" ADD CONSTRAINT "processing_jobs_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing_jobs" ADD CONSTRAINT "processing_jobs_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing_attempts" ADD CONSTRAINT "processing_attempts_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "processing_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mailboxes" ADD CONSTRAINT "mailboxes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mailboxes" ADD CONSTRAINT "mailboxes_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "integration_credentials"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mailbox_sync_state" ADD CONSTRAINT "mailbox_sync_state_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailboxes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingestion_sources" ADD CONSTRAINT "ingestion_sources_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_credentials" ADD CONSTRAINT "integration_credentials_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhooks_outbox" ADD CONSTRAINT "webhooks_outbox_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
