import type { PrismaClient } from "@prisma/client";
import { ZenboxImapPermanentError } from "./zenbox-imap-errors.js";

/**
 * Pipeline requires `Invoice.createdById`. Prefer the user who triggered sync; else first active OWNER/ADMIN.
 */
export async function resolveIntegrationActorUserId(
  prisma: PrismaClient,
  tenantId: string,
  preferredUserId?: string | null,
): Promise<string> {
  if (preferredUserId) {
    const u = await prisma.user.findFirst({
      where: { id: preferredUserId, tenantId, isActive: true },
    });
    if (u) return u.id;
  }
  const u = await prisma.user.findFirst({
    where: { tenantId, isActive: true, role: { in: ["OWNER", "ADMIN"] } },
    orderBy: { createdAt: "asc" },
  });
  if (!u) {
    throw new ZenboxImapPermanentError("No active OWNER/ADMIN user for tenant — cannot attribute IMAP ingestion");
  }
  return u.id;
}
