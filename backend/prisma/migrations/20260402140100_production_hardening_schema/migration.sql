UPDATE "webhooks_outbox" SET "status" = 'FAILED_RETRYABLE' WHERE "status" = 'FAILED';

CREATE INDEX "webhooks_outbox_status_updatedAt_idx" ON "webhooks_outbox"("status", "updatedAt");

CREATE TYPE "IdempotencyLifecycle" AS ENUM ('IN_FLIGHT', 'COMPLETED');

DROP INDEX IF EXISTS "idempotency_keys_tenantId_key_route_key";

ALTER TABLE "idempotency_keys" RENAME COLUMN "key" TO "idempotency_key";
ALTER TABLE "idempotency_keys" RENAME COLUMN "route" TO "route_fingerprint";

ALTER TABLE "idempotency_keys" ADD COLUMN "lifecycle" "IdempotencyLifecycle" NOT NULL DEFAULT 'COMPLETED';

ALTER TABLE "idempotency_keys" ALTER COLUMN "responseStatus" DROP NOT NULL;
ALTER TABLE "idempotency_keys" ALTER COLUMN "responseBody" DROP NOT NULL;

CREATE UNIQUE INDEX "idempotency_keys_tenantId_idempotency_key_route_fingerprint_key" ON "idempotency_keys"("tenantId", "idempotency_key", "route_fingerprint");

CREATE INDEX "idempotency_keys_tenantId_lifecycle_idx" ON "idempotency_keys"("tenantId", "lifecycle");
