import type { FastifyPluginAsync } from "fastify";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import * as fileService from "../modules/files/file.service.js";

const filesDownloadRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/files/:fileId/download",
    { preHandler: [app.authenticate], schema: { tags: ["Files"], summary: "Download stored file" } },
    async (request, reply) => {
      const { fileId } = request.params as { fileId: string };
      const { absPath, mimeType, downloadName } = await fileService.resolveDownload(
        app.prisma,
        request.authUser!.tenantId,
        fileId,
      );
      try {
        const s = await stat(absPath);
        if (!s.isFile()) {
          return reply.status(404).send({
            error: { code: "NOT_FOUND", message: "File not found on disk", details: null },
          });
        }
      } catch {
        return reply.status(404).send({
          error: { code: "NOT_FOUND", message: "File not found on disk", details: null },
        });
      }
      reply.header("Content-Type", mimeType);
      reply.header("Content-Disposition", `attachment; filename="${encodeURIComponent(downloadName)}"`);
      return reply.send(createReadStream(absPath));
    },
  );
};

export default filesDownloadRoutes;
