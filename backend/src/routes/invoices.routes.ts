import type { FastifyPluginAsync } from "fastify";
import { assertCanMutate } from "../lib/roles.js";
import { parseOrThrow } from "../lib/validate.js";
import {
  accountingExportBatchSchema,
  invoiceClassifyBodySchema,
  invoiceCreateSchema,
  invoiceAdoptVendorBodySchema,
  invoiceIdParamSchema,
  invoiceIntakeSchema,
  invoiceItemCreateSchema,
  invoiceItemUpdateSchema,
  invoiceListQuerySchema,
  invoiceStatusPatchSchema,
  invoiceUpdateSchema,
} from "../modules/invoices/invoice.schema.js";
import { exportAccountingBatch } from "../modules/accounting/accounting-export.service.js";
import {
  classifyInvoice,
  sendInvoiceToKsef,
  validateInvoiceCompliance,
} from "../modules/invoices/invoice-compliance-api.service.js";
import { intakeInvoice } from "../modules/invoices/invoice-intake.service.js";
import * as invoiceService from "../modules/invoices/invoice.service.js";
import { openInvoicePrimaryDocumentStream } from "../modules/invoices/invoice-primary-document.service.js";
import { adoptInvoiceVendor } from "../modules/invoices/invoice-adopt-vendor.service.js";
import { retryInvoiceExtraction } from "../modules/pipeline/retry-invoice-extraction.service.js";
import { rehydrateKsefInvoiceFromApi } from "../modules/ksef/ksef-invoice-rehydrate.service.js";
import { getInvoicePispPaymentState } from "../modules/billing/pisp-invoice.service.js";
const invoicesRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/invoices",
    { preHandler: [app.authenticate], schema: { tags: ["Invoices"], summary: "List invoices" } },
    async (request) => {
      const q = parseOrThrow(invoiceListQuerySchema, request.query);
      return invoiceService.listInvoices(app.prisma, request.authUser!.tenantId, q);
    },
  );

  app.get(
    "/invoices/sales-line-name-suggestions",
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ["Invoices"],
        summary: "Distinct line names from sales invoices (tenant), newest first",
      },
    },
    async (request) =>
      invoiceService.listSalesLineNameSuggestions(app.prisma, request.authUser!.tenantId),
  );

  app.post(
    "/invoices",
    {
      preHandler: [app.authenticate, app.checkIdempotency],
      schema: { tags: ["Invoices"], summary: "Create invoice" },
    },
    async (request, reply) => {
      assertCanMutate(request.authUser!.role);
      const body = parseOrThrow(invoiceCreateSchema, request.body);
      const row = await invoiceService.createInvoice(
        app.prisma,
        request.authUser!.tenantId,
        request.authUser!.id,
        body,
      );
      return reply.status(201).send(row);
    },
  );

  app.post(
    "/invoices/intake",
    {
      preHandler: [app.authenticate, app.checkIdempotency],
      schema: { tags: ["Invoices"], summary: "Intake invoice (compliance + source record)" },
    },
    async (request, reply) => {
      assertCanMutate(request.authUser!.role);
      const body = parseOrThrow(invoiceIntakeSchema, request.body);
      const row = await intakeInvoice(app.prisma, request.authUser!.tenantId, request.authUser!.id, body);
      return reply.status(201).send(row);
    },
  );

  app.post(
    "/invoices/:id/retry-extraction",
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ["Invoices"],
        summary: "Re-queue OCR / AI extraction for invoice (by invoice id or primary document id)",
      },
    },
    async (request, reply) => {
      assertCanMutate(request.authUser!.role);
      const { id } = parseOrThrow(invoiceIdParamSchema, request.params, "Invalid id");
      const result = await retryInvoiceExtraction(
        app.prisma,
        request.authUser!.tenantId,
        id,
      );
      return reply.status(202).send(result);
    },
  );

  app.post(
    "/invoices/:id/rehydrate-from-ksef",
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ["Invoices"],
        summary: "Re-download KSeF FA XML from MF, store in storage, reset primary to XML, re-queue pipeline",
      },
    },
    async (request, reply) => {
      assertCanMutate(request.authUser!.role);
      const { id } = parseOrThrow(invoiceIdParamSchema, request.params, "Invalid id");
      const result = await rehydrateKsefInvoiceFromApi(app.prisma, request.authUser!.tenantId, id);
      return reply.status(202).send(result);
    },
  );

  app.post(
    "/invoices/:id/adopt-vendor",
    {
      preHandler: [app.authenticate, app.checkIdempotency],
      schema: {
        tags: ["Invoices"],
        summary: "Create or link contractor from invoice (trusted vendor / new NIP)",
      },
    },
    async (request, reply) => {
      assertCanMutate(request.authUser!.role);
      const { id } = parseOrThrow(invoiceIdParamSchema, request.params, "Invalid id");
      const body = parseOrThrow(invoiceAdoptVendorBodySchema, request.body ?? {});
      const result = await adoptInvoiceVendor(
        app.prisma,
        request.authUser!.tenantId,
        id,
        body,
      );
      return reply.status(200).send(result);
    },
  );

  app.get(
    "/invoices/:id/primary-document",
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ["Invoices"],
        summary: "Primary document file (preview or download)",
        querystring: {
          type: "object",
          properties: {
            disposition: { type: "string", enum: ["inline", "attachment"] },
            /** Dla KSeF: `ksef-fa-xml` — strumień oryginalnego FA XML zamiast PDF podsumowania (pełny podgląd w UI). */
            /** `accountant-pdf` — zawsze PDF (oryginał lub ten sam podgląd co w UI / skan w PDF). */
            source: { type: "string", enum: ["primary", "ksef-fa-xml", "accountant-pdf"] },
          },
        },
      },
    },
    async (request, reply) => {
      const { id } = parseOrThrow(invoiceIdParamSchema, request.params, "Invalid invoice id");
      const q = request.query as { disposition?: string; source?: string };
      const disposition = q.disposition === "attachment" ? "attachment" : "inline";
      const ksefFaXml = q.source === "ksef-fa-xml";
      const accountantPdf = q.source === "accountant-pdf";
      const { stream, mimeType, downloadName, contentLength } = await openInvoicePrimaryDocumentStream(
        app.prisma,
        request.authUser!.tenantId,
        id,
        accountantPdf
          ? { accountantPdf: true }
          : ksefFaXml
            ? { ksefFaXml: true }
            : undefined,
      );
      const asciiFallback = downloadName.replace(/[^\w.-]+/g, "_").slice(0, 180) || "document.bin";
      reply.header("Content-Type", mimeType);
      reply.header("X-Content-Type-Options", "nosniff");
      reply.header("Cache-Control", "private, max-age=60");
      if (contentLength !== undefined) {
        reply.header("Content-Length", String(contentLength));
      }
      reply.header(
        "Content-Disposition",
        `${disposition}; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(downloadName)}`,
      );
      return reply.send(stream);
    },
  );

  app.get(
    "/invoices/:id",
    { preHandler: [app.authenticate], schema: { tags: ["Invoices"], summary: "Get invoice" } },
    async (request) => {
      const { id } = request.params as { id: string };
      return invoiceService.getInvoice(app.prisma, request.authUser!.tenantId, id);
    },
  );

  app.get(
    "/invoices/:id/payment/pisp",
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ["Invoices"],
        summary: "PISP / open banking — status inicjacji przelewu (stub do podłączenia TPP)",
      },
    },
    async (request) => {
      const { id } = parseOrThrow(invoiceIdParamSchema, request.params, "Invalid invoice id");
      return getInvoicePispPaymentState(app.prisma, request.authUser!.tenantId, id);
    },
  );

  app.post(
    "/invoices/:id/classify",
    {
      preHandler: [app.authenticate, app.checkIdempotency],
      schema: { tags: ["Invoices"], summary: "Run legal / document classification" },
    },
    async (request) => {
      assertCanMutate(request.authUser!.role);
      const { id } = request.params as { id: string };
      const body = parseOrThrow(invoiceClassifyBodySchema, request.body ?? {});
      return classifyInvoice(app.prisma, request.authUser!.tenantId, id, body);
    },
  );

  app.post(
    "/invoices/:id/validate-compliance",
    {
      preHandler: [app.authenticate, app.checkIdempotency],
      schema: { tags: ["Invoices"], summary: "Re-run compliance rules" },
    },
    async (request) => {
      assertCanMutate(request.authUser!.role);
      const { id } = request.params as { id: string };
      return validateInvoiceCompliance(app.prisma, request.authUser!.tenantId, id);
    },
  );

  app.post(
    "/invoices/:id/send-to-ksef",
    {
      preHandler: [app.authenticate, app.checkIdempotency],
      schema: {
        tags: ["Invoices"],
        summary: "Submit sales invoice to KSeF (stub or live — see KSEF_ISSUANCE_MODE)",
      },
    },
    async (request) => {
      assertCanMutate(request.authUser!.role);
      const { id } = request.params as { id: string };
      return sendInvoiceToKsef(app.prisma, request.authUser!.tenantId, id);
    },
  );

  app.post(
    "/accounting/export-batch",
    {
      preHandler: [app.authenticate, app.checkIdempotency],
      schema: { tags: ["Accounting"], summary: "Export batch to accounting package" },
    },
    async (request) => {
      assertCanMutate(request.authUser!.role);
      const body = parseOrThrow(accountingExportBatchSchema, request.body);
      return exportAccountingBatch(app.prisma, request.authUser!.tenantId, request.authUser!.id, body.invoiceIds);
    },
  );

  app.patch(
    "/invoices/:id",
    {
      preHandler: [app.authenticate, app.checkIdempotency],
      schema: { tags: ["Invoices"], summary: "Update invoice" },
    },
    async (request) => {
      assertCanMutate(request.authUser!.role);
      const { id } = request.params as { id: string };
      const body = parseOrThrow(invoiceUpdateSchema, request.body);
      return invoiceService.updateInvoice(
        app.prisma,
        request.authUser!.tenantId,
        request.authUser!.id,
        id,
        body,
      );
    },
  );

  app.patch(
    "/invoices/:id/status",
    {
      preHandler: [app.authenticate, app.checkIdempotency],
      schema: { tags: ["Invoices"], summary: "Change invoice status" },
    },
    async (request) => {
      assertCanMutate(request.authUser!.role);
      const { id } = request.params as { id: string };
      const body = parseOrThrow(invoiceStatusPatchSchema, request.body);
      return invoiceService.patchInvoiceStatus(
        app.prisma,
        request.authUser!.tenantId,
        request.authUser!.id,
        id,
        body.status,
      );
    },
  );

  app.delete(
    "/invoices/:id",
    { preHandler: [app.authenticate], schema: { tags: ["Invoices"], summary: "Delete invoice" } },
    async (request, reply) => {
      assertCanMutate(request.authUser!.role);
      const { id } = request.params as { id: string };
      await invoiceService.deleteInvoice(
        app.prisma,
        request.authUser!.tenantId,
        request.authUser!.id,
        id,
      );
      return reply.status(204).send();
    },
  );

  app.post(
    "/invoices/:id/items",
    {
      preHandler: [app.authenticate, app.checkIdempotency],
      schema: { tags: ["Invoices"], summary: "Add invoice line" },
    },
    async (request, reply) => {
      assertCanMutate(request.authUser!.role);
      const { id } = request.params as { id: string };
      const body = parseOrThrow(invoiceItemCreateSchema, request.body);
      const row = await invoiceService.addInvoiceItem(
        app.prisma,
        request.authUser!.tenantId,
        request.authUser!.id,
        id,
        body,
      );
      return reply.status(201).send(row);
    },
  );

  app.patch(
    "/invoices/:id/items/:itemId",
    {
      preHandler: [app.authenticate, app.checkIdempotency],
      schema: { tags: ["Invoices"], summary: "Update invoice line" },
    },
    async (request) => {
      assertCanMutate(request.authUser!.role);
      const { id, itemId } = request.params as { id: string; itemId: string };
      const body = parseOrThrow(invoiceItemUpdateSchema, request.body);
      return invoiceService.updateInvoiceItem(
        app.prisma,
        request.authUser!.tenantId,
        request.authUser!.id,
        id,
        itemId,
        body,
      );
    },
  );

  app.delete(
    "/invoices/:id/items/:itemId",
    { preHandler: [app.authenticate], schema: { tags: ["Invoices"], summary: "Delete invoice line" } },
    async (request, reply) => {
      assertCanMutate(request.authUser!.role);
      const { id, itemId } = request.params as { id: string; itemId: string };
      await invoiceService.deleteInvoiceItem(
        app.prisma,
        request.authUser!.tenantId,
        request.authUser!.id,
        id,
        itemId,
      );
      return reply.status(204).send();
    },
  );

  app.get(
    "/invoices/:id/events",
    { preHandler: [app.authenticate], schema: { tags: ["Invoices"], summary: "Invoice audit trail" } },
    async (request) => {
      const { id } = request.params as { id: string };
      return invoiceService.listInvoiceEvents(app.prisma, request.authUser!.tenantId, id);
    },
  );
};

export default invoicesRoutes;
