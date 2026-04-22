import { Prisma } from "@prisma/client";
import type { InvoiceStatus, PrismaClient } from "@prisma/client";
import { AppError } from "../../lib/errors.js";
import { polishNipDigits10 } from "../contractors/contractor-resolve.js";
import { assertInvoiceCreationAllowed } from "../billing/subscription-plans.js";
import { refreshInvoiceCompliance } from "../compliance/compliance.service.js";
import { parseInvoiceDate, parseInvoiceDateInclusiveEndUtc } from "./invoice-dates.js";
import { createInvoiceEvent } from "./invoice-events.js";
import type {
  InvoiceCreateInput,
  InvoiceItemInput,
  InvoiceListQuery,
  InvoiceUpdateInput,
} from "./invoice.schema.js";
import { buildInvoiceTransferHints } from "./invoice-transfer-hints.js";
import { extractVendorNipFromNormalizedPayload } from "./invoice-vendor-nip.js";
import { serializeInvoiceDetail } from "./invoice-serialize.js";
import { itemRowFromInput, sumTotalsFromItems } from "./invoice-totals.js";
import { regenerateSalesInvoicePreviewDocuments } from "./sales-invoice-preview.service.js";

export async function listInvoices(prisma: PrismaClient, tenantId: string, q: InvoiceListQuery) {
  const skip = (q.page - 1) * q.limit;
  const where: Prisma.InvoiceWhereInput = {
    tenantId,
    ...(q.ledgerKind ? { ledgerKind: q.ledgerKind } : {}),
    ...(q.status ? { status: q.status } : {}),
    ...(q.ksefStatus ? { ksefStatus: q.ksefStatus } : {}),
    ...(q.intakeSourceType ? { intakeSourceType: q.intakeSourceType } : {}),
    ...(q.documentKind ? { documentKind: q.documentKind } : {}),
    ...(q.legalChannel ? { legalChannel: q.legalChannel } : {}),
    ...(q.reviewStatus ? { reviewStatus: q.reviewStatus } : {}),
    ...(q.contractorId ? { contractorId: q.contractorId } : {}),
    ...(q.dateFrom || q.dateTo
      ? {
          issueDate: {
            ...(q.dateFrom ? { gte: parseInvoiceDate(q.dateFrom) } : {}),
            ...(q.dateTo ? { lte: parseInvoiceDateInclusiveEndUtc(q.dateTo) } : {}),
          },
        }
      : {}),
    ...(q.q
      ? {
          OR: [
            { number: { contains: q.q, mode: "insensitive" } },
            { contractor: { is: { name: { contains: q.q, mode: "insensitive" } } } },
          ],
        }
      : {}),
  };

  const [total, rows] = await prisma.$transaction([
    prisma.invoice.count({ where }),
    prisma.invoice.findMany({
      where,
      skip,
      take: q.limit,
      orderBy: [{ issueDate: "desc" }, { number: "asc" }],
      include: {
        contractor: { select: { id: true, name: true, nip: true } },
        tenant: { select: { name: true } },
        primaryDoc: { select: { id: true, sha256: true, mimeType: true, metadata: true } },
        duplicatesAsA: {
          where: { resolution: "OPEN" },
          orderBy: { confidence: "desc" },
          take: 1,
          select: {
            canonicalInvoiceId: true,
            canonical: { select: { number: true } },
          },
        },
        _count: { select: { items: true, files: true } },
      },
    }),
  ]);

  return {
    data: rows.map((r) => {
      const {
        duplicatesAsA,
        normalizedPayload,
        rawPayload: _rp,
        complianceFlags: _cf,
        ...rest
      } = r;
      const extractedVendorNip = extractVendorNipFromNormalizedPayload(normalizedPayload);
      const needsContractorVerification = r.contractorId === null && r.status !== "INGESTING";
      const transfer = buildInvoiceTransferHints(normalizedPayload, {
        number: r.number,
        grossTotal: r.grossTotal,
        currency: r.currency,
        contractor: r.contractor ? { name: r.contractor.name, nip: r.contractor.nip } : null,
      });
      return {
        ...rest,
        netTotal: r.netTotal.toString(),
        vatTotal: r.vatTotal.toString(),
        grossTotal: r.grossTotal.toString(),
        duplicateScore: r.duplicateScore?.toString() ?? null,
        ocrConfidence: r.ocrConfidence?.toString() ?? null,
        duplicateCanonicalId: duplicatesAsA[0]?.canonicalInvoiceId ?? null,
        duplicateCanonicalNumber: duplicatesAsA[0]?.canonical?.number ?? null,
        extractedVendorNip,
        needsContractorVerification,
        transfer,
      };
    }),
    meta: { total, page: q.page, limit: q.limit, totalPages: Math.ceil(total / q.limit) },
  };
}

export async function getInvoice(prisma: PrismaClient, tenantId: string, id: string) {
  const inv = await prisma.invoice.findFirst({
    where: { id, tenantId },
    include: {
      contractor: true,
      items: { orderBy: { id: "asc" } },
      files: { orderBy: { uploadedAt: "desc" } },
    },
  });
  if (!inv) throw AppError.notFound("Invoice not found");
  return serializeInvoiceDetail(inv);
}

export async function createInvoice(
  prisma: PrismaClient,
  tenantId: string,
  userId: string,
  input: InvoiceCreateInput,
) {
  await assertInvoiceCreationAllowed(prisma, tenantId);
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

  const inv = await prisma.$transaction(async (tx) => {
    const issueDate = parseInvoiceDate(
      typeof input.issueDate === "string" ? input.issueDate : String(input.issueDate),
    );
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
        currency: input.currency,
        netTotal,
        vatTotal,
        grossTotal,
        status: input.status,
        source: input.source ?? "MANUAL",
        notes: input.notes ?? null,
        createdById: userId,
        ...(itemRows.length
          ? {
              items: {
                create: itemRows,
              },
            }
          : {}),
      },
      include: {
        contractor: true,
        items: { orderBy: { id: "asc" } },
        files: true,
      },
    });

    await createInvoiceEvent(tx, {
      invoiceId: created.id,
      actorUserId: userId,
      type: "CREATED",
      payload: { number: created.number, status: created.status },
    });
    return created;
  });

  await refreshInvoiceCompliance(
    prisma,
    tenantId,
    inv.id,
    {
      intakeSourceType: "UPLOAD",
      documentKind: "INVOICE",
      isOwnSales: (input.ledgerKind ?? "PURCHASE") === "SALE",
    },
    { enqueueIngested: false },
  );

  await regenerateSalesInvoicePreviewDocuments(prisma, tenantId, inv.id);

  const refreshed = await prisma.invoice.findFirst({
    where: { id: inv.id, tenantId },
    include: { contractor: true, items: { orderBy: { id: "asc" } }, files: true },
  });
  if (!refreshed) throw AppError.internal("Invoice missing after create");
  return serializeInvoiceDetail(refreshed);
}

export async function updateInvoice(
  prisma: PrismaClient,
  tenantId: string,
  userId: string,
  id: string,
  input: InvoiceUpdateInput,
) {
  const existing = await prisma.invoice.findFirst({ where: { id, tenantId } });
  if (!existing) throw AppError.notFound("Invoice not found");
  if (input.contractorId) {
    await assertContractor(prisma, tenantId, input.contractorId);
  }

  const isKsef = existing.intakeSourceType === "KSEF_API";
  const ocrishPatch =
    input.ocrContractorNip !== undefined ||
    input.ocrContractorName !== undefined ||
    input.ocrPaymentForm !== undefined ||
    input.ocrBankAccount !== undefined ||
    input.ocrPaymentDescription !== undefined;
  const keyDataPatch =
    input.number !== undefined ||
    input.issueDate !== undefined ||
    input.saleDate !== undefined ||
    input.dueDate !== undefined ||
    input.currency !== undefined ||
    input.netTotal !== undefined ||
    input.vatTotal !== undefined ||
    input.grossTotal !== undefined;
  if (isKsef && (ocrishPatch || keyDataPatch)) {
    throw AppError.validation(
      "Faktury zapisane z KSeF źródłowo: numerów, dat i kwot nie edytujesz w tym formularzu. Użyj odświeżenia z KSeF.",
    );
  }

  const data: Prisma.InvoiceUpdateInput = {};
  if (input.contractorId !== undefined) data.contractor = { connect: { id: input.contractorId } };
  if (input.number !== undefined) data.number = input.number;
  if (input.issueDate !== undefined) data.issueDate = parseInvoiceDate(String(input.issueDate));
  if (input.saleDate !== undefined)
    data.saleDate = input.saleDate === null ? null : parseInvoiceDate(String(input.saleDate));
  if (input.dueDate !== undefined)
    data.dueDate = input.dueDate === null ? null : parseInvoiceDate(String(input.dueDate));
  if (input.currency !== undefined) data.currency = input.currency;
  if (input.netTotal !== undefined) data.netTotal = new Prisma.Decimal(String(input.netTotal));
  if (input.vatTotal !== undefined) data.vatTotal = new Prisma.Decimal(String(input.vatTotal));
  if (input.grossTotal !== undefined) data.grossTotal = new Prisma.Decimal(String(input.grossTotal));
  if (input.status !== undefined) data.status = input.status;
  if (input.source !== undefined) data.source = input.source;
  if (input.notes !== undefined) data.notes = input.notes;
  if (input.reviewStatus !== undefined) data.reviewStatus = input.reviewStatus;
  if (input.legalChannel !== undefined) data.legalChannel = input.legalChannel;
  if (input.reportCategory !== undefined) {
    const t = input.reportCategory?.trim();
    data.reportCategory = t && t.length > 0 ? t : null;
  }

  if (!isKsef) {
    const hasOcrMergeInput =
      ocrishPatch ||
      keyDataPatch;
    if (hasOcrMergeInput) {
      const prev = (existing.normalizedPayload as Record<string, unknown> | null) ?? {};
      const next: Record<string, unknown> = { ...prev };
      if (input.ocrContractorNip !== undefined) {
        if (input.ocrContractorNip === null || String(input.ocrContractorNip).trim() === "") {
          next.contractorNip = null;
        } else {
          const nip = polishNipDigits10(String(input.ocrContractorNip)) ?? String(input.ocrContractorNip).trim();
          next.contractorNip = nip;
        }
      }
      if (input.ocrContractorName !== undefined) {
        next.contractorName =
          input.ocrContractorName === null || !String(input.ocrContractorName).trim()
            ? null
            : String(input.ocrContractorName).trim().slice(0, 500);
      }
      if (input.ocrPaymentForm !== undefined) {
        next.paymentForm = input.ocrPaymentForm;
      }
      if (input.ocrBankAccount !== undefined) {
        if (input.ocrBankAccount === null || !String(input.ocrBankAccount).trim()) {
          next.bankAccount = null;
        } else {
          next.bankAccount = String(input.ocrBankAccount).replace(/\s/g, "").slice(0, 80);
        }
      }
      if (input.ocrPaymentDescription !== undefined) {
        next.paymentDescription = input.ocrPaymentDescription;
      }
      if (input.number !== undefined) next.number = input.number;
      if (input.issueDate !== undefined) {
        const s = String(input.issueDate);
        next.issueDate = s.length >= 10 ? s.slice(0, 10) : s;
      }
      if (input.saleDate !== undefined) {
        if (input.saleDate === null) next.saleDate = null;
        else {
          const s = String(input.saleDate);
          next.saleDate = s.length >= 10 ? s.slice(0, 10) : s;
        }
      }
      if (input.dueDate !== undefined) {
        if (input.dueDate === null) next.dueDate = null;
        else {
          const s = String(input.dueDate);
          next.dueDate = s.length >= 10 ? s.slice(0, 10) : s;
        }
      }
      if (input.currency !== undefined) next.currency = input.currency;
      if (input.netTotal !== undefined) next.netTotal = String(input.netTotal);
      if (input.vatTotal !== undefined) next.vatTotal = String(input.vatTotal);
      if (input.grossTotal !== undefined) next.grossTotal = String(input.grossTotal);
      data.normalizedPayload = next as Prisma.JsonObject;
    }
  }

  const contractorNameFromOcr =
    input.ocrContractorName !== undefined && !isKsef
      ? input.ocrContractorName === null
        ? null
        : String(input.ocrContractorName).trim().slice(0, 500)
      : null;

  await prisma.$transaction(async (tx) => {
    await tx.invoice.update({
      where: { id },
      data,
      include: {
        contractor: true,
        items: { orderBy: { id: "asc" } },
        files: true,
      },
    });
    if (existing.contractorId && contractorNameFromOcr != null && contractorNameFromOcr.length > 0) {
      await tx.contractor.update({
        where: { id: existing.contractorId, tenantId, deletedAt: null },
        data: { name: contractorNameFromOcr },
      });
    }
    await createInvoiceEvent(tx, {
      invoiceId: id,
      actorUserId: userId,
      type: "UPDATED",
      payload: { fields: Object.keys(input) },
    });
  });

  await regenerateSalesInvoicePreviewDocuments(prisma, tenantId, id);

  const refreshed = await prisma.invoice.findFirst({
    where: { id, tenantId },
    include: { contractor: true, items: { orderBy: { id: "asc" } }, files: true },
  });
  if (!refreshed) throw AppError.notFound("Invoice not found");
  return serializeInvoiceDetail(refreshed);
}

export async function patchInvoiceStatus(
  prisma: PrismaClient,
  tenantId: string,
  userId: string,
  id: string,
  status: InvoiceStatus,
) {
  const existing = await prisma.invoice.findFirst({ where: { id, tenantId } });
  if (!existing) throw AppError.notFound("Invoice not found");
  if (existing.status === status) {
    return getInvoice(prisma, tenantId, id);
  }

  const inv = await prisma.$transaction(async (tx) => {
    const updated = await tx.invoice.update({
      where: { id },
      data: { status },
      include: {
        contractor: true,
        items: { orderBy: { id: "asc" } },
        files: true,
      },
    });
    await createInvoiceEvent(tx, {
      invoiceId: id,
      actorUserId: userId,
      type: "STATUS_CHANGED",
      payload: { from: existing.status, to: status },
    });
    return updated;
  });

  return serializeInvoiceDetail(inv);
}

export async function deleteInvoice(prisma: PrismaClient, tenantId: string, _userId: string, id: string) {
  const existing = await prisma.invoice.findFirst({ where: { id, tenantId } });
  if (!existing) throw AppError.notFound("Invoice not found");
  await prisma.invoice.delete({ where: { id } });
}

export async function addInvoiceItem(
  prisma: PrismaClient,
  tenantId: string,
  userId: string,
  invoiceId: string,
  input: InvoiceItemInput,
) {
  const inv = await prisma.invoice.findFirst({
    where: { id: invoiceId, tenantId },
    include: { items: true },
  });
  if (!inv) throw AppError.notFound("Invoice not found");

  const row = itemRowFromInput(input);
  const updated = await prisma.$transaction(async (tx) => {
    await tx.invoiceItem.create({
      data: { invoiceId, ...row },
    });
    const items = await tx.invoiceItem.findMany({ where: { invoiceId } });
    const { netTotal, vatTotal, grossTotal } = sumTotalsFromItems(items);
    const full = await tx.invoice.update({
      where: { id: invoiceId },
      data: { netTotal, vatTotal, grossTotal },
      include: {
        contractor: true,
        items: { orderBy: { id: "asc" } },
        files: true,
      },
    });
    await createInvoiceEvent(tx, {
      invoiceId,
      actorUserId: userId,
      type: "UPDATED",
      payload: { scope: "items", action: "ADD" },
    });
    return full;
  });
  await regenerateSalesInvoicePreviewDocuments(prisma, tenantId, invoiceId);
  return serializeInvoiceDetail(updated);
}

export async function updateInvoiceItem(
  prisma: PrismaClient,
  tenantId: string,
  userId: string,
  invoiceId: string,
  itemId: string,
  input: Partial<InvoiceItemInput>,
) {
  const inv = await prisma.invoice.findFirst({ where: { id: invoiceId, tenantId } });
  if (!inv) throw AppError.notFound("Invoice not found");
  const item = await prisma.invoiceItem.findFirst({ where: { id: itemId, invoiceId } });
  if (!item) throw AppError.notFound("Invoice item not found");

  const data: Prisma.InvoiceItemUpdateInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.quantity !== undefined) data.quantity = new Prisma.Decimal(String(input.quantity));
  if (input.unit !== undefined) data.unit = input.unit;
  if (input.netPrice !== undefined) data.netPrice = new Prisma.Decimal(String(input.netPrice));
  if (input.vatRate !== undefined) data.vatRate = new Prisma.Decimal(String(input.vatRate));
  if (input.netValue !== undefined) data.netValue = new Prisma.Decimal(String(input.netValue));
  if (input.grossValue !== undefined) data.grossValue = new Prisma.Decimal(String(input.grossValue));

  const updated = await prisma.$transaction(async (tx) => {
    await tx.invoiceItem.update({ where: { id: itemId }, data });
    const items = await tx.invoiceItem.findMany({ where: { invoiceId } });
    const { netTotal, vatTotal, grossTotal } = sumTotalsFromItems(items);
    const full = await tx.invoice.update({
      where: { id: invoiceId },
      data: { netTotal, vatTotal, grossTotal },
      include: {
        contractor: true,
        items: { orderBy: { id: "asc" } },
        files: true,
      },
    });
    await createInvoiceEvent(tx, {
      invoiceId,
      actorUserId: userId,
      type: "UPDATED",
      payload: { scope: "items", action: "UPDATE", itemId },
    });
    return full;
  });
  await regenerateSalesInvoicePreviewDocuments(prisma, tenantId, invoiceId);
  return serializeInvoiceDetail(updated);
}

export async function deleteInvoiceItem(
  prisma: PrismaClient,
  tenantId: string,
  userId: string,
  invoiceId: string,
  itemId: string,
) {
  const inv = await prisma.invoice.findFirst({ where: { id: invoiceId, tenantId } });
  if (!inv) throw AppError.notFound("Invoice not found");
  const item = await prisma.invoiceItem.findFirst({ where: { id: itemId, invoiceId } });
  if (!item) throw AppError.notFound("Invoice item not found");

  const updated = await prisma.$transaction(async (tx) => {
    await tx.invoiceItem.delete({ where: { id: itemId } });
    const items = await tx.invoiceItem.findMany({ where: { invoiceId } });
    const { netTotal, vatTotal, grossTotal } =
      items.length > 0
        ? sumTotalsFromItems(items)
        : {
            netTotal: new Prisma.Decimal(0),
            vatTotal: new Prisma.Decimal(0),
            grossTotal: new Prisma.Decimal(0),
          };
    const full = await tx.invoice.update({
      where: { id: invoiceId },
      data: { netTotal, vatTotal, grossTotal },
      include: {
        contractor: true,
        items: { orderBy: { id: "asc" } },
        files: true,
      },
    });
    await createInvoiceEvent(tx, {
      invoiceId,
      actorUserId: userId,
      type: "UPDATED",
      payload: { scope: "items", action: "DELETE", itemId },
    });
    return full;
  });
  await regenerateSalesInvoicePreviewDocuments(prisma, tenantId, invoiceId);
  return serializeInvoiceDetail(updated);
}

export async function listInvoiceEvents(prisma: PrismaClient, tenantId: string, invoiceId: string) {
  const inv = await prisma.invoice.findFirst({ where: { id: invoiceId, tenantId } });
  if (!inv) throw AppError.notFound("Invoice not found");
  return prisma.invoiceEvent.findMany({
    where: { invoiceId },
    orderBy: { createdAt: "asc" },
  });
}

/** Usuwa prefiks `[GTU_xx]` doklejany przy zapisie faktury sprzedaży — spójnie z polem „Nazwa” w formularzu. */
const STORED_LINE_GTU_PREFIX = /^\[[^\]]+\]\s*/;

function stripGtuPrefixFromStoredLineName(stored: string): string {
  return stored.replace(STORED_LINE_GTU_PREFIX, "").trim();
}

const SALES_LINE_NAME_SUGGESTIONS_LIMIT = 150;
const SALES_LINE_NAME_SUGGESTIONS_RAW_FETCH = 4000;

/** Unikalne nazwy pozycji z faktur sprzedaży (tenant), od najnowszej daty wystawienia. */
export async function listSalesLineNameSuggestions(prisma: PrismaClient, tenantId: string) {
  const rows = await prisma.invoiceItem.findMany({
    where: {
      invoice: { tenantId, ledgerKind: "SALE" },
      NOT: { name: "" },
    },
    select: { name: true },
    orderBy: { invoice: { issueDate: "desc" } },
    take: SALES_LINE_NAME_SUGGESTIONS_RAW_FETCH,
  });

  const best = new Map<string, string>();
  for (const row of rows) {
    const display = stripGtuPrefixFromStoredLineName(row.name);
    const trimmed = display.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (best.has(key)) continue;
    best.set(key, trimmed);
    if (best.size >= SALES_LINE_NAME_SUGGESTIONS_LIMIT) break;
  }

  return { names: Array.from(best.values()) };
}

async function assertContractor(prisma: PrismaClient, tenantId: string, contractorId: string) {
  const c = await prisma.contractor.findFirst({
    where: { id: contractorId, tenantId, deletedAt: null },
  });
  if (!c) throw AppError.validation("Invalid contractor for tenant");
}
