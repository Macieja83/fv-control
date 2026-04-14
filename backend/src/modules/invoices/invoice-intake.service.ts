import { Prisma } from "@prisma/client";
import type { InvoiceIntakeSourceType, PrismaClient } from "@prisma/client";
import { AppError } from "../../lib/errors.js";
import { refreshInvoiceCompliance } from "../compliance/compliance.service.js";
import { classifyDocumentType } from "../compliance/compliance-engine.js";
import { parseInvoiceDate } from "./invoice-dates.js";
import { createInvoiceEvent } from "./invoice-events.js";
import type { InvoiceIntakeInput } from "./invoice.schema.js";
import { itemRowFromInput, sumTotalsFromItems } from "./invoice-totals.js";
import { serializeInvoiceDetail } from "./invoice-serialize.js";

async function assertContractor(prisma: PrismaClient, tenantId: string, contractorId: string) {
  const c = await prisma.contractor.findFirst({
    where: { id: contractorId, tenantId, deletedAt: null },
  });
  if (!c) throw AppError.validation("Invalid contractor for tenant");
}

export async function intakeInvoice(
  prisma: PrismaClient,
  tenantId: string,
  userId: string,
  input: InvoiceIntakeInput,
) {
  await assertContractor(prisma, tenantId, input.contractorId);

  const itemRows = input.items?.map(itemRowFromInput) ?? [];
  let netTotal: Prisma.Decimal;
  let vatTotal: Prisma.Decimal;
  let grossTotal: Prisma.Decimal;

  if (itemRows.length > 0) {
    ({ netTotal, vatTotal, grossTotal } = sumTotalsFromItems(itemRows));
  } else {
    if (input.netTotal === undefined || input.vatTotal === undefined || input.grossTotal === undefined) {
      throw AppError.validation("netTotal, vatTotal and grossTotal are required when no items are sent");
    }
    netTotal = new Prisma.Decimal(String(input.netTotal));
    vatTotal = new Prisma.Decimal(String(input.vatTotal));
    grossTotal = new Prisma.Decimal(String(input.grossTotal));
  }

  const docKind =
    input.documentKind ??
    classifyDocumentType({
      intakeSourceType: input.intakeSourceType as InvoiceIntakeSourceType,
      filename: input.filename ?? null,
      declaredKind: null,
    });

  const inv = await prisma.$transaction(async (tx) => {
    const issueDate = parseInvoiceDate(String(input.issueDate));
    const dueDate = input.dueDate ? parseInvoiceDate(String(input.dueDate)) : issueDate;
    const created = await tx.invoice.create({
      data: {
        tenantId,
        ledgerKind: input.ledgerKind ?? "PURCHASE",
        contractorId: input.contractorId,
        number: input.number,
        issueDate,
        saleDate: input.saleDate ? parseInvoiceDate(String(input.saleDate)) : null,
        dueDate,
        currency: input.currency ?? "PLN",
        netTotal,
        vatTotal,
        grossTotal,
        status: input.status ?? "DRAFT",
        source: input.legacySource ?? "MANUAL",
        notes: input.notes ?? null,
        createdById: userId,
        intakeSourceType: input.intakeSourceType,
        sourceAccount: input.sourceAccount ?? null,
        documentKind: docKind,
        ...(input.rawPayload != null ? { rawPayload: input.rawPayload as object } : {}),
        ...(input.normalizedPayload != null ? { normalizedPayload: input.normalizedPayload as object } : {}),
        ...(itemRows.length
          ? {
              items: { create: itemRows },
            }
          : {}),
      },
      include: {
        contractor: true,
        items: { orderBy: { id: "asc" } },
        files: true,
      },
    });

    await tx.invoiceSourceRecord.create({
      data: {
        tenantId,
        invoiceId: created.id,
        intakeSourceType: input.intakeSourceType,
        sourceAccount: input.sourceAccount ?? null,
        externalRef: input.externalRef ?? null,
        ...(input.sourceMetadata != null ? { metadata: input.sourceMetadata as object } : {}),
      },
    });

    await createInvoiceEvent(tx, {
      invoiceId: created.id,
      actorUserId: userId,
      type: "CREATED",
      payload: { number: created.number, status: created.status, intake: true },
    });

    return created;
  });

  await refreshInvoiceCompliance(
    prisma,
    tenantId,
    inv.id,
    {
      intakeSourceType: input.intakeSourceType,
      documentKind: docKind,
      isOwnSales: input.isOwnSales ?? (input.ledgerKind ?? "PURCHASE") === "SALE",
      hasStructuredKsefPayload: input.hasStructuredKsefPayload ?? false,
      ocrConfidence: input.ocrConfidence ?? null,
    },
    {
      eventType: "INTAKE",
      enqueueClassified: true,
      enqueueIngested: true,
      enqueueDuplicate: false,
    },
  );

  const full = await prisma.invoice.findFirst({
    where: { id: inv.id, tenantId },
    include: { contractor: true, items: { orderBy: { id: "asc" } }, files: true },
  });
  if (!full) throw AppError.internal("Invoice missing after intake");
  return serializeInvoiceDetail(full);
}
