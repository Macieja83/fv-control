-- CreateTable
CREATE TABLE "mobile_capture_handoffs" (
    "id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "upload_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "mobile_capture_handoffs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mobile_capture_handoffs_token_key" ON "mobile_capture_handoffs"("token");

-- CreateIndex
CREATE INDEX "mobile_capture_handoffs_token_idx" ON "mobile_capture_handoffs"("token");

-- CreateIndex
CREATE INDEX "mobile_capture_handoffs_expires_at_idx" ON "mobile_capture_handoffs"("expires_at");

-- AddForeignKey
ALTER TABLE "mobile_capture_handoffs" ADD CONSTRAINT "mobile_capture_handoffs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mobile_capture_handoffs" ADD CONSTRAINT "mobile_capture_handoffs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
