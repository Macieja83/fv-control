-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('OWNER', 'ADMIN', 'ACCOUNTANT', 'VIEWER');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'RECEIVED', 'VERIFIED', 'PAID', 'REJECTED');

-- CreateEnum
CREATE TYPE "InvoiceSource" AS ENUM ('MANUAL', 'OCR', 'EMAIL', 'API');

-- CreateEnum
CREATE TYPE "StorageType" AS ENUM ('LOCAL', 'S3');

-- CreateEnum
CREATE TYPE "InvoiceEventType" AS ENUM ('CREATED', 'UPDATED', 'STATUS_CHANGED', 'FILE_ADDED', 'FILE_REMOVED', 'EXPORTED');

-- CreateEnum
CREATE TYPE "PosProvider" AS ENUM ('POS_RESTA');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "nip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "replacedById" UUID,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contractor" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "nip" TEXT NOT NULL,
    "address" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contractor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "contractorId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "issueDate" DATE NOT NULL,
    "saleDate" DATE,
    "dueDate" DATE,
    "currency" TEXT NOT NULL DEFAULT 'PLN',
    "netTotal" DECIMAL(14,2) NOT NULL,
    "vatTotal" DECIMAL(14,2) NOT NULL,
    "grossTotal" DECIMAL(14,2) NOT NULL,
    "status" "InvoiceStatus" NOT NULL,
    "source" "InvoiceSource" NOT NULL DEFAULT 'MANUAL',
    "notes" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceItem" (
    "id" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unit" TEXT,
    "netPrice" DECIMAL(14,2) NOT NULL,
    "vatRate" DECIMAL(5,2) NOT NULL,
    "netValue" DECIMAL(14,2) NOT NULL,
    "grossValue" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "InvoiceItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceFile" (
    "id" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "storageType" "StorageType" NOT NULL,
    "path" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceEvent" (
    "id" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "actorUserId" UUID,
    "type" "InvoiceEventType" NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationPos" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "provider" "PosProvider" NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "apiKeyEncrypted" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationPos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_nip_key" ON "Tenant"("nip");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_tenantId_idx" ON "User"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE INDEX "RefreshToken_expiresAt_idx" ON "RefreshToken"("expiresAt");

-- CreateIndex
CREATE INDEX "Contractor_tenantId_nip_idx" ON "Contractor"("tenantId", "nip");

-- CreateIndex
CREATE INDEX "Contractor_tenantId_idx" ON "Contractor"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Contractor_tenantId_nip_key" ON "Contractor"("tenantId", "nip");

-- CreateIndex
CREATE INDEX "Invoice_tenantId_issueDate_idx" ON "Invoice"("tenantId", "issueDate");

-- CreateIndex
CREATE INDEX "Invoice_tenantId_idx" ON "Invoice"("tenantId");

-- CreateIndex
CREATE INDEX "Invoice_contractorId_idx" ON "Invoice"("contractorId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_tenantId_number_key" ON "Invoice"("tenantId", "number");

-- CreateIndex
CREATE INDEX "InvoiceItem_invoiceId_idx" ON "InvoiceItem"("invoiceId");

-- CreateIndex
CREATE INDEX "InvoiceFile_invoiceId_idx" ON "InvoiceFile"("invoiceId");

-- CreateIndex
CREATE INDEX "InvoiceEvent_invoiceId_createdAt_idx" ON "InvoiceEvent"("invoiceId", "createdAt");

-- CreateIndex
CREATE INDEX "IntegrationPos_tenantId_idx" ON "IntegrationPos"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationPos_tenantId_provider_key" ON "IntegrationPos"("tenantId", "provider");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contractor" ADD CONSTRAINT "Contractor_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Contractor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceFile" ADD CONSTRAINT "InvoiceFile_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceEvent" ADD CONSTRAINT "InvoiceEvent_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceEvent" ADD CONSTRAINT "InvoiceEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationPos" ADD CONSTRAINT "IntegrationPos_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
