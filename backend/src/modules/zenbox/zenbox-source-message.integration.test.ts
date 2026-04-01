import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const TENANT_ID = "00000000-0000-4000-8000-000000000001";

describe("source_messages idempotency", () => {
  beforeAll(async () => {
    const t = await prisma.tenant.findUnique({ where: { id: TENANT_ID } });
    if (!t) {
      throw new Error("Seed tenant missing — run prisma seed before integration tests");
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("duplicate externalMessageId violates unique constraint", async () => {
    const externalMessageId = `test-dedupe-${Date.now()}@local`;
    const row = await prisma.sourceMessage.create({
      data: {
        tenantId: TENANT_ID,
        provider: "ZENBOX_IMAP",
        accountKey: "test-dedupe-account",
        externalMessageId,
        imapUid: 1n,
        receivedAt: new Date(),
        subject: "x",
      },
    });

    await expect(
      prisma.sourceMessage.create({
        data: {
          tenantId: TENANT_ID,
          provider: "ZENBOX_IMAP",
          accountKey: "test-dedupe-account",
          externalMessageId,
          imapUid: 2n,
          receivedAt: new Date(),
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });

    await prisma.sourceMessage.delete({ where: { id: row.id } });
  });
});
