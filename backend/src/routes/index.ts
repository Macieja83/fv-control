import type { FastifyInstance } from "fastify";
import authRoutes from "./auth.routes.js";
import contractorsRoutes from "./contractors.routes.js";
import filesDownloadRoutes from "./files-download.routes.js";
import healthRoutes from "./health.routes.js";
import invoiceFilesRoutes from "./invoice-files.routes.js";
import invoicesRoutes from "./invoices.routes.js";
import integrationsRoutes from "./integrations.routes.js";

export async function registerApiRoutes(app: FastifyInstance): Promise<void> {
  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(contractorsRoutes);
  await app.register(invoicesRoutes);
  await app.register(invoiceFilesRoutes);
  await app.register(filesDownloadRoutes);
  await app.register(integrationsRoutes);
}
