import type { PrismaClient } from "@prisma/client";
import { AppError } from "../../lib/errors.js";
import { buildAccountingPackage } from "../compliance/compliance-engine.js";

export async function exportAccountingBatch(
  prisma: PrismaClient,
  tenantId: string,
  userId: string,
  invoiceIds: string[],
) {
  if (invoiceIds.length === 0) {
    throw AppError.validation("invoiceIds must not be empty");
  }

  const invoices = await prisma.invoice.findMany({
    where: {
      tenantId,
      id: { in: invoiceIds },
      accountingStatus: "NOT_EXPORTED",
    },
    include: { contractor: true },
  });

  if (invoices.length === 0) {
    throw AppError.validation("No eligible invoices (already exported or not found)");
  }

  const packages = invoices.map((inv) =>
    buildAccountingPackage({
      id: inv.id,
      number: inv.number,
      issueDate: inv.issueDate,
      currency: inv.currency,
      netTotal: inv.netTotal,
      vatTotal: inv.vatTotal,
      grossTotal: inv.grossTotal,
      documentKind: inv.documentKind,
      intakeSourceType: inv.intakeSourceType,
      contractorNip: inv.contractor?.nip ?? null,
    }),
  );

  const exportRow = await prisma.$transaction(async (tx) => {
    await tx.invoice.updateMany({
      where: { id: { in: invoices.map((i) => i.id) }, tenantId },
      data: { accountingStatus: "EXPORTED" },
    });
    return tx.accountingExport.create({
      data: {
        tenantId,
        status: "COMPLETED",
        invoiceIds: invoices.map((i) => i.id),
        packageSummary: { lines: packages } as object,
        createdById: userId,
      },
    });
  });

  return {
    accountingExportId: exportRow.id,
    count: invoices.length,
    packages,
  };
}
