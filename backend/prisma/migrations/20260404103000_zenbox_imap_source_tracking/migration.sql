-- Zenbox IMAP: source message idempotency, sync cursor fields, credential key version

CREATE TYPE "IngestionChannelProvider" AS ENUM ('ZENBOX_IMAP');
CREATE TYPE "ImapMailboxSyncStatus" AS ENUM ('IDLE', 'RUNNING', 'ERROR');

ALTER TABLE "integration_credentials" ADD COLUMN "key_version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "mailbox_sync_state" ADD COLUMN "imap_sync_status" "ImapMailboxSyncStatus" NOT NULL DEFAULT 'IDLE';
ALTER TABLE "mailbox_sync_state" ADD COLUMN "imap_last_processed_uid" BIGINT;
ALTER TABLE "mailbox_sync_state" ADD COLUMN "imap_uid_validity_str" TEXT;

CREATE INDEX "mailbox_sync_state_mailboxId_imap_last_processed_uid_idx" ON "mailbox_sync_state"("mailboxId", "imap_last_processed_uid");

CREATE UNIQUE INDEX "mailboxes_tenantId_provider_label_key" ON "mailboxes"("tenantId", "provider", "label");

CREATE TABLE "source_messages" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "provider" "IngestionChannelProvider" NOT NULL,
    "account_key" TEXT NOT NULL,
    "mailboxId" UUID,
    "external_message_id" TEXT NOT NULL,
    "imap_uid" BIGINT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL,
    "subject" TEXT,
    "from_address" TEXT,
    "raw_headers" JSONB,
    "processed_at" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "source_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "source_attachments" (
    "id" UUID NOT NULL,
    "source_message_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storage_url" TEXT NOT NULL,
    "is_invoice_candidate" BOOLEAN NOT NULL DEFAULT false,
    "document_id" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "source_attachments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "source_messages_tenantId_provider_account_key_external_message_id_key" ON "source_messages"("tenantId", "provider", "account_key", "external_message_id");
CREATE INDEX "source_messages_tenantId_provider_account_key_idx" ON "source_messages"("tenantId", "provider", "account_key");
CREATE INDEX "source_messages_tenantId_provider_account_key_imap_uid_idx" ON "source_messages"("tenantId", "provider", "account_key", "imap_uid");

CREATE UNIQUE INDEX "source_attachments_source_message_id_sha256_key" ON "source_attachments"("source_message_id", "sha256");
CREATE INDEX "source_attachments_source_message_id_idx" ON "source_attachments"("source_message_id");
CREATE INDEX "source_attachments_document_id_idx" ON "source_attachments"("document_id");

ALTER TABLE "source_messages" ADD CONSTRAINT "source_messages_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "source_messages" ADD CONSTRAINT "source_messages_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailboxes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "source_attachments" ADD CONSTRAINT "source_attachments_source_message_id_fkey" FOREIGN KEY ("source_message_id") REFERENCES "source_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "source_attachments" ADD CONSTRAINT "source_attachments_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
