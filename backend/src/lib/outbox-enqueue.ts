import type { PrismaClient } from "@prisma/client";
import { loadConfig } from "../config.js";

/**
 * Kolejkuje wysyłkę webhooka dla tenanta. Gdy `N8N_WEBHOOK_URL` nie jest ustawione — no-op (brak wpisów do outboxa).
 */
export async function enqueueTenantWebhook(
  prisma: PrismaClient,
  tenantId: string,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const cfg = loadConfig();
  const url = cfg.N8N_WEBHOOK_URL?.trim();
  if (!url) return;
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
