import type { FastifyPluginAsync } from "fastify";
import { assertCanMutate } from "../lib/roles.js";
import { AppError } from "../lib/errors.js";
import * as manualUpload from "../modules/ingestion/manual-upload.service.js";

const ingestionRoutes: FastifyPluginAsync = async (app) => {
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
      const status = result.idempotent ? 200 : 202;
      return reply.status(status).send(result);
    },
  );
};

export default ingestionRoutes;
