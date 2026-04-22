import type { FastifyPluginAsync } from "fastify";
import { assertCanMutate } from "../lib/roles.js";
import { AppError } from "../lib/errors.js";
import * as manualUpload from "../modules/ingestion/manual-upload.service.js";
import * as mobileCapture from "../modules/ingestion/mobile-capture-handoff.service.js";

const ingestionRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    "/ingestion/mobile-capture-session",
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ["Ingestion"],
        summary: "QR handoff: tworzy token (telefon → aparat → OCR na to konto)",
      },
    },
    async (request) => {
      assertCanMutate(request.authUser!.role);
      return mobileCapture.createMobileCaptureHandoff(app.prisma, {
        tenantId: request.authUser!.tenantId,
        userId: request.authUser!.id,
      });
    },
  );

  app.get(
    "/ingestion/mobile-capture/:token/status",
    {
      schema: {
        tags: ["Ingestion"],
        summary: "Status sesji QR (bez JWT — tylko token)",
        params: {
          type: "object",
          properties: { token: { type: "string" } },
          required: ["token"],
        },
      },
    },
    async (request) => {
      const { token } = request.params as { token: string };
      return mobileCapture.getMobileCaptureHandoffStatus(app.prisma, token);
    },
  );

  app.post(
    "/ingestion/mobile-capture/:token/upload",
    {
      schema: {
        tags: ["Ingestion"],
        summary: "Przesłanie pliku w sesji QR (bez JWT)",
        params: {
          type: "object",
          properties: { token: { type: "string" } },
          required: ["token"],
        },
      },
    },
    async (request, reply) => {
      const { token } = request.params as { token: string };
      const data = await request.file();
      if (!data) {
        throw AppError.validation("Brak pola file");
      }
      const buf = await data.toBuffer();
      const result = await mobileCapture.uploadViaMobileCaptureHandoff(app.prisma, {
        token,
        buffer: buf,
        filename: data.filename || "upload.bin",
        mimeType: data.mimetype || "application/octet-stream",
      });
      const status = result.kind === "idempotent_document" ? 200 : 202;
      return reply.status(status).send(result);
    },
  );

  app.post(
    "/ingestion/manual-upload",
    { preHandler: [app.authenticate], schema: { tags: ["Ingestion"], summary: "Manual file → document + pipeline job" } },
    async (request, reply) => {
      assertCanMutate(request.authUser!.role);
      const data = await request.file();
      if (!data) {
        throw AppError.validation("Missing file field");
      }
      const buf = await data.toBuffer();
      const result = await manualUpload.manualUploadAndEnqueue(app.prisma, {
        tenantId: request.authUser!.tenantId,
        userId: request.authUser!.id,
        buffer: buf,
        filename: data.filename || "upload.bin",
        mimeType: data.mimetype || "application/octet-stream",
      });
      const status = result.kind === "idempotent_document" ? 200 : 202;
      return reply.status(status).send(result);
    },
  );
};

export default ingestionRoutes;
