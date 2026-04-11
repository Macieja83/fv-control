-- CreateEnum
CREATE TYPE "AgreementStatus" AS ENUM ('PROCESSING', 'READY', 'FAILED');

-- CreateTable
CREATE TABLE "agreements" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "contractorId" UUID,
    "primaryDocId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "subject" TEXT,
    "counterpartyName" TEXT,
    "counterpartyNip" TEXT,
    "signedAt" DATE,
    "validUntil" DATE,
    "status" "AgreementStatus" NOT NULL DEFAULT 'PROCESSING',
    "notes" TEXT,
    "normalizedPayload" JSONB,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agreements_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "agreements_primaryDocId_key" ON "agreements"("primaryDocId");

CREATE INDEX "agreements_tenantId_status_idx" ON "agreements"("tenantId", "status");

CREATE INDEX "agreements_tenantId_createdAt_idx" ON "agreements"("tenantId", "createdAt");

ALTER TABLE "agreements" ADD CONSTRAINT "agreements_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "agreements" ADD CONSTRAINT "agreements_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Contractor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "agreements" ADD CONSTRAINT "agreements_primaryDocId_fkey" FOREIGN KEY ("primaryDocId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "agreements" ADD CONSTRAINT "agreements_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
