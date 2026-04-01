import type { InvoiceEventType, Prisma, PrismaClient } from "@prisma/client";
import { jsonPayload } from "../../lib/prisma-json.js";

export async function createInvoiceEvent(
  db: PrismaClient | Prisma.TransactionClient,
  params: {
    invoiceId: string;
    actorUserId: string | null;
    type: InvoiceEventType;
    payload: unknown;
  },
) {
  await db.invoiceEvent.create({
    data: {
      invoiceId: params.invoiceId,
      actorUserId: params.actorUserId,
      type: params.type,
      payload: jsonPayload(params.payload),
    },
  });
}
