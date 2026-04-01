import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../app.js";

const prisma = new PrismaClient();

describe("admin webhooks", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("POST retry resets DEAD_LETTER to PENDING", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "admin@fvresta.local", password: "Admin123!" },
    });
    expect(login.statusCode).toBe(200);
    const loginBody = JSON.parse(login.body) as { accessToken: string; user: { tenantId: string } };
    const token = loginBody.accessToken;
    const tenantId = loginBody.user.tenantId;

    const row = await prisma.webhookOutbox.create({
      data: {
        tenantId,
        eventType: "test.admin_retry",
        url: "https://example.com/h",
        payload: {},
        status: "DEAD_LETTER",
        attemptCount: 2,
        lastError: "gone",
      },
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/admin/webhooks/${row.id}/retry`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(202);

    const updated = await prisma.webhookOutbox.findUniqueOrThrow({ where: { id: row.id } });
    expect(updated.status).toBe("PENDING");
    expect(updated.attemptCount).toBe(0);
    expect(updated.lastError).toBeNull();

    await prisma.webhookOutbox.delete({ where: { id: row.id } });
  });
});
