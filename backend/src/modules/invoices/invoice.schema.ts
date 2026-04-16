import {
  InvoiceDocumentKind,
  InvoiceIntakeSourceType,
  InvoiceLedgerKind,
  InvoiceReviewStatus,
  InvoiceSource,
  InvoiceStatus,
  KsefWorkflowStatus,
  LegalChannel,
} from "@prisma/client";
import { z } from "zod";

/** Path param `id` for invoice-scoped routes (rejects mock ids like `inv-001`). */
export const invoiceIdParamSchema = z.object({
  id: z.string().uuid("Invoice id must be a UUID"),
});

const decimalString = z.union([z.string().regex(/^-?\d+(\.\d+)?$/), z.number()]);

export const invoiceItemInputSchema = z.object({
  name: z.string().min(1).max(500),
  quantity: decimalString,
  unit: z.string().max(32).optional().nullable(),
  netPrice: decimalString,
  vatRate: decimalString,
  netValue: decimalString,
  grossValue: decimalString,
});

export const invoiceCreateSchema = z
  .object({
    ledgerKind: z.nativeEnum(InvoiceLedgerKind).optional(),
    contractorId: z.string().uuid(),
    number: z.string().min(1).max(100),
    issueDate: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
    saleDate: z
      .string()
      .datetime({ offset: true })
      .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
      .optional()
      .nullable(),
    dueDate: z
      .string()
      .datetime({ offset: true })
      .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
      .optional()
      .nullable(),
    currency: z.string().min(3).max(3).optional(),
    netTotal: decimalString.optional(),
    vatTotal: decimalString.optional(),
    grossTotal: decimalString.optional(),
    status: z.nativeEnum(InvoiceStatus).optional(),
    source: z.nativeEnum(InvoiceSource).optional(),
    notes: z.string().max(5000).optional().nullable(),
    items: z.array(invoiceItemInputSchema).optional(),
  })
  .transform((v) => ({
    ...v,
    currency: v.currency ?? "PLN",
    status: v.status ?? InvoiceStatus.DRAFT,
  }));

export const invoiceUpdateSchema = z.object({
  contractorId: z.string().uuid().optional(),
  number: z.string().min(1).max(100).optional(),
  issueDate: z
    .string()
    .datetime({ offset: true })
    .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
    .optional(),
  saleDate: z
    .string()
    .datetime({ offset: true })
    .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
    .optional()
    .nullable(),
  dueDate: z
    .string()
    .datetime({ offset: true })
    .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
    .optional()
    .nullable(),
  currency: z.string().min(3).max(3).optional(),
  netTotal: decimalString.optional(),
  vatTotal: decimalString.optional(),
  grossTotal: decimalString.optional(),
  status: z.nativeEnum(InvoiceStatus).optional(),
  source: z.nativeEnum(InvoiceSource).optional(),
  notes: z.string().max(5000).optional().nullable(),
  reviewStatus: z.nativeEnum(InvoiceReviewStatus).optional(),
  legalChannel: z.nativeEnum(LegalChannel).optional(),
  reportCategory: z.string().max(200).optional().nullable(),
});

export const invoiceStatusPatchSchema = z.object({
  status: z.nativeEnum(InvoiceStatus),
});

export const invoiceItemCreateSchema = invoiceItemInputSchema;
export const invoiceItemUpdateSchema = invoiceItemInputSchema.partial();

export const invoiceListQuerySchema = z
  .object({
    ledgerKind: z.nativeEnum(InvoiceLedgerKind).optional(),
    status: z.nativeEnum(InvoiceStatus).optional(),
    ksefStatus: z.nativeEnum(KsefWorkflowStatus).optional(),
    intakeSourceType: z.nativeEnum(InvoiceIntakeSourceType).optional(),
    documentKind: z.nativeEnum(InvoiceDocumentKind).optional(),
    legalChannel: z.nativeEnum(LegalChannel).optional(),
    reviewStatus: z.nativeEnum(InvoiceReviewStatus).optional(),
    contractorId: z.string().uuid().optional(),
    dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    q: z.string().max(200).optional(),
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
  })
  .transform((v) => ({
    ...v,
    page: v.page ?? 1,
    limit: Math.min(v.limit ?? 20, 100),
  }));

export const invoiceIntakeSchema = z
  .object({
    ledgerKind: z.nativeEnum(InvoiceLedgerKind).optional(),
    contractorId: z.string().uuid(),
    number: z.string().min(1).max(100),
    issueDate: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
    saleDate: z
      .string()
      .datetime({ offset: true })
      .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
      .optional()
      .nullable(),
    dueDate: z
      .string()
      .datetime({ offset: true })
      .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
      .optional()
      .nullable(),
    currency: z.string().min(3).max(3).optional(),
    netTotal: decimalString.optional(),
    vatTotal: decimalString.optional(),
    grossTotal: decimalString.optional(),
    status: z.nativeEnum(InvoiceStatus).optional(),
    notes: z.string().max(5000).optional().nullable(),
    items: z.array(invoiceItemInputSchema).optional(),
    intakeSourceType: z.nativeEnum(InvoiceIntakeSourceType),
    sourceAccount: z.string().max(500).optional().nullable(),
    externalRef: z.string().max(500).optional().nullable(),
    sourceMetadata: z.record(z.unknown()).optional(),
    documentKind: z.nativeEnum(InvoiceDocumentKind).optional(),
    filename: z.string().max(500).optional().nullable(),
    isOwnSales: z.boolean().optional(),
    hasStructuredKsefPayload: z.boolean().optional(),
    ocrConfidence: z.number().min(0).max(1).optional().nullable(),
    rawPayload: z.record(z.unknown()).optional(),
    normalizedPayload: z.record(z.unknown()).optional(),
    legacySource: z.nativeEnum(InvoiceSource).optional(),
  })
  .transform((v) => ({
    ...v,
    currency: v.currency ?? "PLN",
    status: v.status ?? InvoiceStatus.DRAFT,
  }));

export const invoiceClassifyBodySchema = z.object({
  documentKind: z.nativeEnum(InvoiceDocumentKind).optional(),
  filename: z.string().max(500).optional().nullable(),
  intakeSourceType: z.nativeEnum(InvoiceIntakeSourceType).optional(),
  isOwnSales: z.boolean().optional(),
  hasStructuredKsefPayload: z.boolean().optional(),
});

export const accountingExportBatchSchema = z.object({
  invoiceIds: z.array(z.string().uuid()).min(1).max(500),
});

/** Opcjonalne nadpisanie NIP/nazwy przy dopisywaniu kontrahenta z faktury. */
export const invoiceAdoptVendorBodySchema = z.object({
  nip: z.string().max(24).optional(),
  name: z.string().max(300).optional(),
});

export type InvoiceCreateInput = z.output<typeof invoiceCreateSchema>;
export type InvoiceUpdateInput = z.infer<typeof invoiceUpdateSchema>;
export type InvoiceListQuery = z.output<typeof invoiceListQuerySchema>;
export type InvoiceItemInput = z.infer<typeof invoiceItemInputSchema>;
export type InvoiceIntakeInput = z.output<typeof invoiceIntakeSchema>;
export type InvoiceAdoptVendorBody = z.infer<typeof invoiceAdoptVendorBodySchema>;
