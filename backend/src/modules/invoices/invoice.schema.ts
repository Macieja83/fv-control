import { z } from "zod";
import { InvoiceSource, InvoiceStatus } from "@prisma/client";

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
});

export const invoiceStatusPatchSchema = z.object({
  status: z.nativeEnum(InvoiceStatus),
});

export const invoiceItemCreateSchema = invoiceItemInputSchema;
export const invoiceItemUpdateSchema = invoiceItemInputSchema.partial();

export const invoiceListQuerySchema = z
  .object({
    status: z.nativeEnum(InvoiceStatus).optional(),
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

export type InvoiceCreateInput = z.output<typeof invoiceCreateSchema>;
export type InvoiceUpdateInput = z.infer<typeof invoiceUpdateSchema>;
export type InvoiceListQuery = z.output<typeof invoiceListQuerySchema>;
export type InvoiceItemInput = z.infer<typeof invoiceItemInputSchema>;
