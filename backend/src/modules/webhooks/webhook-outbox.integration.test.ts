import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { sweepWebhookOutbox } from "./webhook-delivery.service.js";

const prisma = new PrismaClient();

describe("webhook outbox state machine", () => {
  beforeAll(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("err", { status: 502, statusText: "Bad Gateway" })),
    );
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await prisma.$disconnect();
  });

  it("PENDING → FAILED_RETRYABLE → DEAD_LETTER after max attempts (WEBHOOK_DELIVERY_MAX_ATTEMPTS)", async () => {
    const max = Number(process.env.WEBHOOK_DELIVERY_MAX_ATTEMPTS ?? "3");
    const tenant = await prisma.tenant.findFirstOrThrow();
    const row = await prisma.webhookOutbox.create({
      data: {
        tenantId: tenant.id,
        eventType: "test.deadletter",
        url: "https://example.com/webhook",
        payload: { n: 1 },
        status: "PENDING",
      },
    });

    await sweepWebhookOutbox(prisma);

    for (let i = 2; i <= max; i++) {
      await prisma.webhookOutbox.update({
        where: { id: row.id },
        data: { updatedAt: new Date(Date.now() - 120_000) },
      });
      await sweepWebhookOutbox(prisma);
    }

    const end = await prisma.webhookOutbox.findUniqueOrThrow({ where: { id: row.id } });
    expect(end.status).toBe("DEAD_LETTER");
    expect(end.attemptCount).toBe(max);

    await prisma.webhookOutbox.delete({ where: { id: row.id } });
  });
});
