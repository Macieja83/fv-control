import { Prisma } from "@prisma/client";
import type { InvoiceItemInput } from "./invoice.schema.js";

export function itemRowFromInput(input: InvoiceItemInput) {
  return {
    name: input.name,
    quantity: new Prisma.Decimal(String(input.quantity)),
    unit: input.unit ?? null,
    netPrice: new Prisma.Decimal(String(input.netPrice)),
    vatRate: new Prisma.Decimal(String(input.vatRate)),
    netValue: new Prisma.Decimal(String(input.netValue)),
    grossValue: new Prisma.Decimal(String(input.grossValue)),
  };
}

export function sumTotalsFromItems(
  items: { netValue: Prisma.Decimal; grossValue: Prisma.Decimal }[],
): {
  netTotal: Prisma.Decimal;
  vatTotal: Prisma.Decimal;
  grossTotal: Prisma.Decimal;
} {
  let netTotal = new Prisma.Decimal(0);
  let grossTotal = new Prisma.Decimal(0);
  for (const it of items) {
    netTotal = netTotal.add(it.netValue);
    grossTotal = grossTotal.add(it.grossValue);
  }
  const vatTotal = grossTotal.sub(netTotal);
  return { netTotal, vatTotal, grossTotal };
}
