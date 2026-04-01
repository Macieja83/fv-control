import type { Prisma } from "@prisma/client";

export type InvoiceDetailPayload = Prisma.InvoiceGetPayload<{
  include: {
    contractor: true;
    items: { orderBy: { id: "asc" } };
    files: true;
  };
}>;

export function serializeInvoiceDetail(inv: InvoiceDetailPayload) {
  return {
    ...inv,
    netTotal: inv.netTotal.toString(),
    vatTotal: inv.vatTotal.toString(),
    grossTotal: inv.grossTotal.toString(),
    ocrConfidence: inv.ocrConfidence?.toString() ?? null,
    duplicateScore: inv.duplicateScore?.toString() ?? null,
    items: inv.items.map((i) => ({
      ...i,
      quantity: i.quantity.toString(),
      netPrice: i.netPrice.toString(),
      vatRate: i.vatRate.toString(),
      netValue: i.netValue.toString(),
      grossValue: i.grossValue.toString(),
    })),
    files: inv.files.map((f) => ({ ...f })),
  };
}
