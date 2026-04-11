-- CreateEnum
CREATE TYPE "InvoiceLedgerKind" AS ENUM ('PURCHASE', 'SALE');

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN "ledger_kind" "InvoiceLedgerKind" NOT NULL DEFAULT 'PURCHASE';

-- CreateIndex
CREATE INDEX "invoices_tenantId_ledger_kind_idx" ON "invoices"("tenantId", "ledger_kind");
