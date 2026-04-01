import type { FastifyPluginAsync } from "fastify";
import { assertCanMutate } from "../lib/roles.js";
import { parseOrThrow } from "../lib/validate.js";
import {
  invoiceCreateSchema,
  invoiceItemCreateSchema,
  invoiceItemUpdateSchema,
  invoiceListQuerySchema,
  invoiceStatusPatchSchema,
  invoiceUpdateSchema,
} from "../modules/invoices/invoice.schema.js";
import * as invoiceService from "../modules/invoices/invoice.service.js";

const invoicesRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/invoices",
    { preHandler: [app.authenticate], schema: { tags: ["Invoices"], summary: "List invoices" } },
    async (request) => {
      const q = parseOrThrow(invoiceListQuerySchema, request.query);
      return invoiceService.listInvoices(app.prisma, request.authUser!.tenantId, q);
    },
  );

  app.post(
    "/invoices",
    { preHandler: [app.authenticate], schema: { tags: ["Invoices"], summary: "Create invoice" } },
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

  app.get(
    "/invoices/:id",
    { preHandler: [app.authenticate], schema: { tags: ["Invoices"], summary: "Get invoice" } },
    async (request) => {
      const { id } = request.params as { id: string };
      return invoiceService.getInvoice(app.prisma, request.authUser!.tenantId, id);
    },
  );

  app.patch(
    "/invoices/:id",
    { preHandler: [app.authenticate], schema: { tags: ["Invoices"], summary: "Update invoice" } },
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
    { preHandler: [app.authenticate], schema: { tags: ["Invoices"], summary: "Change invoice status" } },
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
    { preHandler: [app.authenticate], schema: { tags: ["Invoices"], summary: "Add invoice line" } },
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
    { preHandler: [app.authenticate], schema: { tags: ["Invoices"], summary: "Update invoice line" } },
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
