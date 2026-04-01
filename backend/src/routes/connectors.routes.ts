import type { FastifyPluginAsync } from "fastify";
import { assertCanManageIntegrations } from "../lib/roles.js";
import { createStubGmailConnector, createStubImapConnector, createStubKsefConnector, createStubRestaConnector } from "../connectors/connector.interfaces.js";
import { loadConfig } from "../config.js";

const connectorsRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/connectors/status",
    { preHandler: [app.authenticate], schema: { tags: ["Connectors"], summary: "Connector health + stub ping" } },
    async (request) => {
      assertCanManageIntegrations(request.authUser!.role);
      const cfg = loadConfig();
      const gmail = createStubGmailConnector();
      const imap = createStubImapConnector();
      const ksef = createStubKsefConnector();
      const resta = createStubRestaConnector();
      const [g, i, k, r] = await Promise.all([
        gmail.fetchIncremental("mailbox-stub", {}),
        imap.poll("mailbox-stub", {}),
        ksef.listSince(new Date(Date.now() - 86400000)),
        resta.listInvoices({}),
      ]);
      return {
        environment: {
          ksefEnv: cfg.KSEF_ENV,
          restaConfigured: Boolean(cfg.RESTA_API_BASE_URL),
          googleOAuthConfigured: Boolean(cfg.GOOGLE_CLIENT_ID && cfg.GOOGLE_CLIENT_SECRET),
        },
        stubs: {
          gmail: { nextHistoryId: g.nextCursor.historyId, pendingAttachments: g.attachmentRefs.length },
          imapZenbox: { nextUidNext: i.nextCursor.uidNext, pendingMime: i.rawMimeIds.length },
          ksef: { count: k.length },
          resta: { count: r.length },
        },
      };
    },
  );
};

export default connectorsRoutes;
