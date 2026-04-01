import type { PrismaClient } from "@prisma/client";
import { loadConfig } from "../config.js";

/**
 * Enqueues a tenant-scoped outbox row. URL from N8N_WEBHOOK_URL or legacy example placeholder for dev.
 */
export async function enqueueTenantWebhook(
  prisma: PrismaClient,
  tenantId: string,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const cfg = loadConfig();
  const url = cfg.N8N_WEBHOOK_URL ?? "https://hooks.example.invalid/n8n";
  await prisma.webhookOutbox.create({
    data: {
      tenantId,
      eventType,
      url,
      payload: payload as object,
      status: "PENDING",
    },
  });
}
