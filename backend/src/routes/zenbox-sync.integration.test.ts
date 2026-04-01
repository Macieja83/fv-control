import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../app.js";

vi.mock("../lib/imap-sync-queue.js", () => ({
  enqueueZenboxImapSync: vi.fn(async () => ({ jobId: "test-job-mock" })),
}));

const prisma = new PrismaClient();

describe("POST /connectors/zenbox/accounts/:accountKey/sync", () => {
  let app: FastifyInstance;
  const accountKey = `api-sync-${Date.now()}`;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await prisma.mailbox.deleteMany({ where: { label: accountKey, provider: "IMAP" } });
    await prisma.integrationCredential.deleteMany({
      where: { label: accountKey, connector: "IMAP_ZENBOX" },
    });
    await app.close();
    await prisma.$disconnect();
  });

  it("returns 200 and enqueues when credentials exist", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "admin@fvresta.local", password: "Admin123!" },
    });
    expect(login.statusCode).toBe(200);
    const { accessToken } = JSON.parse(login.body) as { accessToken: string };

    const register = await app.inject({
      method: "POST",
      url: "/api/v1/connectors/zenbox/accounts",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        accountKey,
        host: "127.0.0.1",
        port: 993,
        username: "u",
        password: "p",
        tls: true,
        mailbox: "INBOX",
      },
    });
    expect(register.statusCode).toBe(200);

    const sync = await app.inject({
      method: "POST",
      url: `/api/v1/connectors/zenbox/accounts/${encodeURIComponent(accountKey)}/sync`,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(sync.statusCode).toBe(200);
    const body = JSON.parse(sync.body) as { ok: boolean; enqueued: boolean; jobId: string | null };
    expect(body.ok).toBe(true);
    expect(body.enqueued).toBe(true);
    expect(body.jobId).toBe("test-job-mock");
  });
});
