-- CreateEnum
CREATE TYPE "BillingWebhookProvider" AS ENUM ('STRIPE', 'P24');

-- CreateTable
CREATE TABLE "billing_webhook_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider" "BillingWebhookProvider" NOT NULL,
    "eventId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "billing_webhook_events_provider_eventId_key" ON "billing_webhook_events"("provider", "eventId");

-- CreateIndex
CREATE INDEX "billing_webhook_events_received_at_idx" ON "billing_webhook_events"("received_at");
