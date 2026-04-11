-- CreateEnum
CREATE TYPE "InvoiceLedgerKind" AS ENUM ('PURCHASE', 'SALE');

-- AlterTable (tabela jak w init: "Invoice", nie invoices)
ALTER TABLE "Invoice" ADD COLUMN "ledger_kind" "InvoiceLedgerKind" NOT NULL DEFAULT 'PURCHASE';

-- CreateIndex
CREATE INDEX "Invoice_tenantId_ledger_kind_idx" ON "Invoice"("tenantId", "ledger_kind");
