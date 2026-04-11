import type { FastifyPluginAsync } from "fastify";
import { assertCanMutate } from "../lib/roles.js";
import { parseOrThrow } from "../lib/validate.js";
import { agreementIdParamSchema, agreementPatchSchema } from "../modules/agreements/agreement.schema.js";
import * as agreementService from "../modules/agreements/agreement.service.js";
import { createObjectStorage } from "../adapters/storage/create-storage.js";

const agreementsRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/agreements",
    { preHandler: [app.authenticate], schema: { tags: ["Agreements"], summary: "List agreements (contracts)" } },
    async (request) => {
      return agreementService.listAgreements(app.prisma, request.authUser!.tenantId);
    },
  );

  app.get(
    "/agreements/:id",
    { preHandler: [app.authenticate], schema: { tags: ["Agreements"], summary: "Get agreement" } },
    async (request) => {
      const { id } = parseOrThrow(agreementIdParamSchema, request.params);
      return agreementService.getAgreement(app.prisma, request.authUser!.tenantId, id);
    },
  );

  app.patch(
    "/agreements/:id",
    {
      preHandler: [app.authenticate, app.checkIdempotency],
      schema: { tags: ["Agreements"], summary: "Update agreement metadata" },
    },
    async (request) => {
      assertCanMutate(request.authUser!.role);
      const { id } = parseOrThrow(agreementIdParamSchema, request.params);
      const body = parseOrThrow(agreementPatchSchema, request.body);
      return agreementService.patchAgreement(app.prisma, request.authUser!.tenantId, id, body);
    },
  );

  app.get(
    "/agreements/:id/download",
    { preHandler: [app.authenticate], schema: { tags: ["Agreements"], summary: "Download agreement file" } },
    async (request, reply) => {
      const { id } = parseOrThrow(agreementIdParamSchema, request.params);
      const row = await agreementService.getAgreement(app.prisma, request.authUser!.tenantId, id);
      const doc = row.primaryDoc;
      const storage = createObjectStorage();
      const { stream, contentLength } = await storage.getObjectStream({
        key: doc.storageKey,
        bucket: doc.storageBucket,
      });
      const meta = doc.metadata as { filename?: string } | null;
      const rawName =
        typeof meta?.filename === "string" && meta.filename.trim()
          ? meta.filename
          : `umowa-${id.slice(0, 8)}.pdf`;
      const safeName = rawName.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "_").slice(0, 180) || "document.bin";
      reply.header("Content-Type", doc.mimeType);
      if (contentLength != null) reply.header("Content-Length", String(contentLength));
      reply.header("Content-Disposition", `inline; filename="${safeName}"`);
      return reply.send(stream);
    },
  );

  app.post(
    "/agreements/upload",
    {
      preHandler: [app.authenticate, app.checkIdempotency],
      schema: { tags: ["Agreements"], summary: "Upload contract PDF/image and run OCR extraction" },
    },
    async (request, reply) => {
      assertCanMutate(request.authUser!.role);
      const data = await request.file();
      if (!data) {
        return reply.status(400).send({ error: { code: "VALIDATION", message: "Missing file field", details: null } });
      }
      const buf = await data.toBuffer();
      const tenantId = request.authUser!.tenantId;
      const userId = request.authUser!.id;
      const created = await agreementService.uploadAgreement(app.prisma, {
        tenantId,
        userId,
        buffer: buf,
        filename: data.filename || "umowa.pdf",
        mimeType: data.mimetype || "application/octet-stream",
      });
      await agreementService.runAgreementExtraction(app.prisma, tenantId, created.agreementId);
      const full = await agreementService.getAgreement(app.prisma, tenantId, created.agreementId);
      return reply.status(201).send(full);
    },
  );
};

export default agreementsRoutes;
