import { InvoiceStatus, type PrismaClient } from "@prisma/client";
import { parseInvoiceDate, parseInvoiceDateInclusiveEndUtc } from "../invoices/invoice-dates.js";

const EXCLUDED_STATUSES: InvoiceStatus[] = [InvoiceStatus.INGESTING];

const UNASSIGNED = "Nieprzypisane";

export type CategoryBreakdownQuery = {
  dateFrom?: string;
  dateTo?: string;
  currency?: string;
};

export async function getCategoryBreakdown(
  prisma: PrismaClient,
  tenantId: string,
  q: CategoryBreakdownQuery,
) {
  const where = {
    tenantId,
    status: { notIn: EXCLUDED_STATUSES },
    ...(q.dateFrom || q.dateTo
      ? {
          issueDate: {
            ...(q.dateFrom ? { gte: parseInvoiceDate(q.dateFrom) } : {}),
            ...(q.dateTo ? { lte: parseInvoiceDateInclusiveEndUtc(q.dateTo) } : {}),
          },
        }
      : {}),
    ...(q.currency?.trim() ? { currency: q.currency.trim().toUpperCase() } : {}),
  };

  const grouped = await prisma.invoice.groupBy({
    by: ["ledgerKind", "reportCategory", "currency"],
    where,
    _sum: { grossTotal: true },
    _count: { _all: true },
  });

  return {
    rows: grouped.map((r) => ({
      ledgerKind: r.ledgerKind,
      category: r.reportCategory?.trim() ? r.reportCategory.trim() : UNASSIGNED,
      currency: r.currency,
      grossTotal: r._sum.grossTotal?.toString() ?? "0",
      invoiceCount: r._count._all,
    })),
  };
}
