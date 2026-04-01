-- New enum labels must be committed before use in a follow-up migration (PostgreSQL).
ALTER TYPE "WebhookDeliveryStatus" ADD VALUE 'PROCESSING';
ALTER TYPE "WebhookDeliveryStatus" ADD VALUE 'FAILED_RETRYABLE';
ALTER TYPE "WebhookDeliveryStatus" ADD VALUE 'DEAD_LETTER';
