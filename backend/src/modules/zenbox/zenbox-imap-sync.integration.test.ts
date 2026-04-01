import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";

vi.mock("../../lib/pipeline-queue.js", () => ({
  getPipelineQueue: vi.fn(() => ({
    add: vi.fn(async () => ({ id: "mock-pipeline-job" })),
  })),
}));

import { runZenboxImapSyncJob } from "./zenbox-imap-sync.service.js";
import { setZenboxCredentials } from "./zenbox-credentials.service.js";
import type { ZenboxImapTransport } from "./zenbox-imap.connector.js";

const prisma = new PrismaClient();
const TENANT_ID = "00000000-0000-4000-8000-000000000001";

function buildPdfEml(): Buffer {
  const pdfBody = Buffer.from("%PDF-1.1\n%\xe2\xe3\xcf\xd3\n1 0 obj<<>>endobj trailer<<>>\n%%EOF\n");
  const lines = [
    "From: vendor@example.com",
    "To: inbox@zenbox.local",
    "Subject: Faktura 1/2026",
    "Message-ID: <sync-int-test@example.com>",
    "MIME-Version: 1.0",
    "Content-Type: multipart/mixed; boundary=\"bnd\"",
    "",
    "--bnd",
    "Content-Type: application/pdf; name=\"FV-001.pdf\"",
    "Content-Transfer-Encoding: base64",
    "",
    pdfBody.toString("base64"),
    "--bnd--",
    "",
  ];
  return Buffer.from(lines.join("\r\n"), "utf8");
}

function createMockRedis(): Redis {
  const store = new Map<string, string>();
  return {
    set: vi.fn(
      async (key: string, val: string, ...args: (string | number | Buffer)[]) => {
        const strArgs = args.map(String);
        const nx = strArgs.includes("NX");
        if (nx && store.has(key)) return null;
        store.set(key, val);
        return "OK";
      },
    ),
    del: vi.fn(async (key: string) => {
      const existed = store.delete(key);
      return existed ? 1 : 0;
    }),
  } as unknown as Redis;
}

describe("runZenboxImapSyncJob (mock IMAP)", () => {
  const accountKey = `sync-mock-${Date.now()}`;
  let actorUserId: string;
  const raw = buildPdfEml();

  beforeAll(async () => {
    const tenant = await prisma.tenant.findUnique({ where: { id: TENANT_ID } });
    if (!tenant) throw new Error("Seed tenant missing");
    const admin = await prisma.user.findFirst({
      where: { tenantId: TENANT_ID, email: "admin@fvresta.local" },
    });
    if (!admin) throw new Error("Seed admin user missing");
    actorUserId = admin.id;

    await setZenboxCredentials(prisma, {
      tenantId: TENANT_ID,
      accountKey,
      plain: {
        host: "127.0.0.1",
        port: 1993,
        username: "noop",
        password: "noop",
        tls: true,
        mailbox: "INBOX",
      },
      actorUserId,
    });
  });

  afterAll(async () => {
    const docIds = (
      await prisma.sourceAttachment.findMany({
        where: { sourceMessage: { tenantId: TENANT_ID, accountKey } },
        select: { documentId: true },
      })
    )
      .map((a) => a.documentId)
      .filter((id): id is string => Boolean(id));
    for (const id of [...new Set(docIds)]) {
      await prisma.processingJob.deleteMany({ where: { documentId: id } });
      await prisma.invoice.deleteMany({ where: { primaryDocId: id } });
      await prisma.document.deleteMany({ where: { id } });
    }
    await prisma.sourceAttachment.deleteMany({
      where: { sourceMessage: { tenantId: TENANT_ID, accountKey } },
    });
    await prisma.sourceMessage.deleteMany({ where: { tenantId: TENANT_ID, accountKey } });
    await prisma.mailbox.deleteMany({ where: { tenantId: TENANT_ID, provider: "IMAP", label: accountKey } });
    await prisma.integrationCredential.deleteMany({
      where: { tenantId: TENANT_ID, connector: "IMAP_ZENBOX", label: accountKey },
    });
    await prisma.$disconnect();
  });

  it("ingests PDF attachment once", async () => {
    const transport: ZenboxImapTransport = {
      async connect() {},
      async disconnect() {},
      async fetchMailboxMetadata() {
        return { uidValidityStr: "sync-test-vv", exists: true };
      },
      async listUidsAfter(last: bigint | null) {
        if (last !== null && last >= 1n) return [];
        return [1];
      },
      async fetchRawByUids(uids: number[]) {
        if (!uids.includes(1)) return [];
        return [{ uid: 1n, rawSource: raw, internalDate: new Date() }];
      },
    };

    await runZenboxImapSyncJob(
      prisma,
      createMockRedis(),
      { tenantId: TENANT_ID, accountKey, triggeredByUserId: actorUserId },
      { createTransport: () => transport },
    );

    const msgs = await prisma.sourceMessage.count({
      where: { tenantId: TENANT_ID, accountKey, provider: "ZENBOX_IMAP" },
    });
    expect(msgs).toBe(1);

    const atts = await prisma.sourceAttachment.count({
      where: { sourceMessage: { tenantId: TENANT_ID, accountKey } },
    });
    expect(atts).toBe(1);

    await runZenboxImapSyncJob(
      prisma,
      createMockRedis(),
      { tenantId: TENANT_ID, accountKey, triggeredByUserId: actorUserId },
      { createTransport: () => transport },
    );

    const msgs2 = await prisma.sourceMessage.count({
      where: { tenantId: TENANT_ID, accountKey, provider: "ZENBOX_IMAP" },
    });
    expect(msgs2).toBe(1);
  });
});
