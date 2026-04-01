import type {
  InvoiceDocumentKind,
  InvoiceIntakeSourceType,
  PrismaClient,
} from "@prisma/client";
import { AppError } from "../../lib/errors.js";
import { classifyDocumentType } from "../compliance/compliance-engine.js";
import { refreshInvoiceCompliance } from "../compliance/compliance.service.js";
import { serializeInvoiceDetail } from "./invoice-serialize.js";

export async function classifyInvoice(
  prisma: PrismaClient,
  tenantId: string,
  invoiceId: string,
  body: {
    documentKind?: InvoiceDocumentKind;
    filename?: string | null;
    intakeSourceType?: InvoiceIntakeSourceType;
    isOwnSales?: boolean;
    hasStructuredKsefPayload?: boolean;
  },
) {
  const inv = await prisma.invoice.findFirst({ where: { id: invoiceId, tenantId } });
  if (!inv) throw AppError.notFound("Invoice not found");

  const intake = body.intakeSourceType ?? inv.intakeSourceType;
  const docKind =
    body.documentKind ??
    classifyDocumentType({
      intakeSourceType: intake,
      filename: body.filename ?? null,
      declaredKind: null,
    });

  await refreshInvoiceCompliance(
    prisma,
    tenantId,
    invoiceId,
    {
      intakeSourceType: intake,
      documentKind: docKind,
      isOwnSales: body.isOwnSales ?? false,
      hasStructuredKsefPayload: body.hasStructuredKsefPayload ?? false,
    },
    { eventType: "CLASSIFIED", enqueueIngested: false },
  );

  const full = await prisma.invoice.findFirst({
    where: { id: invoiceId, tenantId },
    include: { contractor: true, items: { orderBy: { id: "asc" } }, files: true },
  });
  if (!full) throw AppError.notFound("Invoice not found");
  return serializeInvoiceDetail(full);
}

export async function validateInvoiceCompliance(prisma: PrismaClient, tenantId: string, invoiceId: string) {
  const inv = await prisma.invoice.findFirst({ where: { id: invoiceId, tenantId } });
  if (!inv) throw AppError.notFound("Invoice not found");

  await refreshInvoiceCompliance(
    prisma,
    tenantId,
    invoiceId,
    {},
    { eventType: "COMPLIANCE_VALIDATED", enqueueIngested: false, enqueueClassified: false },
  );

  const full = await prisma.invoice.findFirst({
    where: { id: invoiceId, tenantId },
    include: { contractor: true, items: { orderBy: { id: "asc" } }, files: true },
  });
  if (!full) throw AppError.notFound("Invoice not found");
  return serializeInvoiceDetail(full);
}

export async function sendInvoiceToKsefStub(prisma: PrismaClient, tenantId: string, invoiceId: string) {
  const inv = await prisma.invoice.findFirst({ where: { id: invoiceId, tenantId } });
  if (!inv) throw AppError.notFound("Invoice not found");
  if (!inv.ksefRequired) {
    throw AppError.validation("KSeF submission is not required for this document (see legal_channel / document_kind).");
  }
  if (inv.legalChannel !== "KSEF") {
    throw AppError.validation("KSeF channel not applicable for current legal classification.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.invoice.update({
      where: { id: invoiceId },
      data: { ksefStatus: "PENDING", ksefReferenceId: `stub-${invoiceId.slice(0, 8)}` },
    });
    await tx.invoiceComplianceEvent.create({
      data: {
        tenantId,
        invoiceId,
        eventType: "KSEF_SUBMIT_REQUESTED",
        payload: { stub: true } as object,
      },
    });
  });

  const full = await prisma.invoice.findFirst({
    where: { id: invoiceId, tenantId },
    include: { contractor: true, items: { orderBy: { id: "asc" } }, files: true },
  });
  if (!full) throw AppError.notFound("Invoice not found");
  return serializeInvoiceDetail(full);
}
