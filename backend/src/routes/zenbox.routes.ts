import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { assertCanManageIntegrations } from "../lib/roles.js";
import { enqueueZenboxImapSync } from "../lib/imap-sync-queue.js";
import {
  loadMailboxWithCredential,
  rotateZenboxCredentials,
  setZenboxCredentials,
} from "../modules/zenbox/zenbox-credentials.service.js";
import { AppError } from "../lib/errors.js";

const accountBodySchema = z.object({
  accountKey: z.string().min(1).max(128),
  host: z.string().min(1),
  port: z.coerce.number().int().min(1).max(65535),
  username: z.string().min(1),
  password: z.string().min(1),
  tls: z.boolean(),
  mailbox: z.string().min(1).default("INBOX"),
});

const patchBodySchema = accountBodySchema.omit({ accountKey: true });

const zenboxRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    "/connectors/zenbox/accounts",
    {
      preHandler: [app.authenticate],
      schema: { tags: ["Connectors"], summary: "Register or replace Zenbox IMAP credentials" },
    },
    async (request) => {
      assertCanManageIntegrations(request.authUser!.role);
      const tenantId = request.authUser!.tenantId;
      const body = accountBodySchema.parse(request.body);
      const { accountKey, ...plain } = body;
      const result = await setZenboxCredentials(app.prisma, {
        tenantId,
        accountKey,
        plain,
        actorUserId: request.authUser!.id,
      });
      return { ok: true, credentialId: result.credentialId, mailboxId: result.mailboxId };
    },
  );

  app.patch<{ Params: { accountKey: string } }>(
    "/connectors/zenbox/accounts/:accountKey",
    {
      preHandler: [app.authenticate],
      schema: { tags: ["Connectors"], summary: "Rotate / update Zenbox IMAP credentials" },
    },
    async (request) => {
      assertCanManageIntegrations(request.authUser!.role);
      const tenantId = request.authUser!.tenantId;
      const accountKey = request.params.accountKey;
      if (!accountKey) throw AppError.validation("accountKey required");
      const body = patchBodySchema.parse(request.body);
      const result = await rotateZenboxCredentials(app.prisma, {
        tenantId,
        accountKey,
        plain: { ...body, mailbox: body.mailbox ?? "INBOX" },
        actorUserId: request.authUser!.id,
      });
      return { ok: true, credentialId: result.credentialId };
    },
  );

  app.post<{ Params: { accountKey: string } }>(
    "/connectors/zenbox/accounts/:accountKey/sync",
    {
      preHandler: [app.authenticate],
      schema: { tags: ["Connectors"], summary: "Enqueue manual Zenbox IMAP sync" },
    },
    async (request) => {
      assertCanManageIntegrations(request.authUser!.role);
      const tenantId = request.authUser!.tenantId;
      const accountKey = request.params.accountKey;
      if (!accountKey) throw AppError.validation("accountKey required");
      await loadMailboxWithCredential(app.prisma, tenantId, accountKey);
      const { jobId } = await enqueueZenboxImapSync({
        tenantId,
        accountKey,
        triggeredByUserId: request.authUser!.id,
      });
      return { ok: true, enqueued: true, jobId: jobId ?? null };
    },
  );

  app.get<{ Params: { accountKey: string } }>(
    "/connectors/zenbox/accounts/:accountKey/status",
    {
      preHandler: [app.authenticate],
      schema: { tags: ["Connectors"], summary: "Zenbox IMAP cursor and sync health" },
    },
    async (request) => {
      assertCanManageIntegrations(request.authUser!.role);
      const tenantId = request.authUser!.tenantId;
      const accountKey = request.params.accountKey;
      if (!accountKey) throw AppError.validation("accountKey required");
      const { mailbox } = await loadMailboxWithCredential(app.prisma, tenantId, accountKey);
      const sync =
        mailbox.syncState ??
        (await app.prisma.mailboxSyncState.upsert({
          where: { mailboxId: mailbox.id },
          create: { mailboxId: mailbox.id },
          update: {},
        }));

      const [messageCount, attachmentCount] = await Promise.all([
        app.prisma.sourceMessage.count({
          where: { tenantId, provider: "ZENBOX_IMAP", accountKey },
        }),
        app.prisma.sourceAttachment.count({
          where: { sourceMessage: { tenantId, provider: "ZENBOX_IMAP", accountKey } },
        }),
      ]);

      return {
        accountKey,
        cursor: {
          lastUid: sync.imapLastProcessedUid?.toString() ?? null,
          uidValidity: sync.imapUidValidityStr,
        },
        lastSyncAt: sync.lastSyncedAt,
        status: sync.imapSyncStatus,
        lastError: sync.lastError,
        counts: {
          sourceMessages: messageCount,
          sourceAttachments: attachmentCount,
        },
      };
    },
  );
};

export default zenboxRoutes;
