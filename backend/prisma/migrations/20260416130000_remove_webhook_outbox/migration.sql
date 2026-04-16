-- Remove legacy outbound webhook outbox (n8n integration removed)

DROP TABLE IF EXISTS "webhooks_outbox" CASCADE;

-- Prisma enum backing type (only if it exists)
DROP TYPE IF EXISTS "WebhookDeliveryStatus" CASCADE;

