import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";
import { createObjectStorage } from "../../adapters/storage/create-storage.js";
import { loadConfig } from "../../config.js";
import {
  imapAttachmentsFetchedTotal,
  imapDuplicatesSkippedTotal,
  imapLastUidGauge,
  imapMessagesFetchedTotal,
  imapSyncDurationSeconds,
  imapSyncRunsTotal,
} from "../../lib/metrics.js";
import { releaseImapZenboxLock, tryAcquireImapZenboxLock } from "../../lib/imap-zenbox-lock.js";
import type { ImapZenboxSyncJobData } from "../../lib/imap-sync-queue.js";
import { ingestAttachmentAndEnqueue } from "../ingestion/attachment-intake.service.js";
import { getZenboxCredentialsDecrypted, loadMailboxWithCredential } from "./zenbox-credentials.service.js";
import type { ZenboxImapCredentialsPlain } from "./zenbox-credentials.service.js";
import { createZenboxImapTransport, type ZenboxImapTransport } from "./zenbox-imap.connector.js";
import {
  classifyImapFailure,
  describeErrorWithCause,
  ZenboxImapPermanentError,
  ZenboxImapRetryableError,
} from "./zenbox-imap-errors.js";
import { parseImapRawSource } from "./zenbox-imap-mailparse.js";
import {
  shouldResetCursorOnUidValidityChange,
  stableExternalMessageId,
} from "./zenbox-imap.parser.js";
import { resolveIntegrationActorUserId } from "./integration-actor.js";

function sha256Buffer(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function isPrismaUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

function formatZenboxImapLastError(stage: string, err: unknown): string {
  const detail = describeErrorWithCause(err);
  const stack =
    err instanceof Error && err.stack ? err.stack.split("\n").slice(0, 8).join(" ") : "";
  return `[${stage}] ${detail}${stack ? ` || ${stack.slice(0, 800)}` : ""}`.slice(0, 4000);
}

function logZenboxImapSyncFailure(
  stage: string,
  err: unknown,
  ctx: { tenantId: string; accountKey: string },
): void {
  console.error(
    JSON.stringify({
      msg: "zenbox_imap_sync_failed",
      stage,
      tenantId: ctx.tenantId,
      accountKey: ctx.accountKey,
      detail: describeErrorWithCause(err),
      stack: err instanceof Error ? err.stack : undefined,
    }),
  );
}

export type ZenboxImapSyncDeps = {
  createTransport?: (creds: ZenboxImapCredentialsPlain) => ZenboxImapTransport;
};

export async function runZenboxImapSyncJob(
  prisma: PrismaClient,
  redis: Redis,
  data: ImapZenboxSyncJobData,
  deps: ZenboxImapSyncDeps = {},
): Promise<void> {
  const cfg = loadConfig();
  const createTransport = deps.createTransport ?? createZenboxImapTransport;

  const { key: lockKey, acquired } = await tryAcquireImapZenboxLock(redis, data.tenantId, data.accountKey);
  if (!acquired) {
    imapSyncRunsTotal.inc({ status: "skipped_lock" });
    return;
  }

  const endTimer = imapSyncDurationSeconds.startTimer();
  let transport: ZenboxImapTransport | null = null;
  let mailboxId: string | null = null;
  let syncStage = "init";

  try {
    syncStage = "resolve_actor";
    const actorUserId = await resolveIntegrationActorUserId(
      prisma,
      data.tenantId,
      data.triggeredByUserId,
    );

    syncStage = "load_mailbox";
    const { mailbox } = await loadMailboxWithCredential(prisma, data.tenantId, data.accountKey);
    mailboxId = mailbox.id;
    syncStage = "decrypt_credentials";
    const creds = await getZenboxCredentialsDecrypted(prisma, data.tenantId, data.accountKey);

    syncStage = "mark_running";
    await prisma.mailboxSyncState.update({
      where: { mailboxId: mailbox.id },
      data: { imapSyncStatus: "RUNNING", lastError: null },
    });

    transport = createTransport(creds);
    syncStage = "imap_connect";
    await transport.connect();

    syncStage = "mailbox_metadata";
    const meta = await transport.fetchMailboxMetadata();
    const syncRow = await prisma.mailboxSyncState.findUniqueOrThrow({ where: { mailboxId: mailbox.id } });

    let cursorUid = syncRow.imapLastProcessedUid;
    if (shouldResetCursorOnUidValidityChange(syncRow.imapUidValidityStr, meta.uidValidityStr)) {
      cursorUid = null;
    }

    await prisma.mailboxSyncState.update({
      where: { mailboxId: mailbox.id },
      data: { imapUidValidityStr: meta.uidValidityStr },
    });

    let batches = 0;
    let maxSeenUid = cursorUid ?? 0n;

    while (batches < cfg.IMAP_ZENBOX_MAX_BATCHES_PER_JOB) {
      batches += 1;
      syncStage = "list_uids";
      const uids = await transport.listUidsAfter(cursorUid, cfg.IMAP_ZENBOX_FETCH_BATCH_SIZE);
      if (uids.length === 0) break;

      syncStage = "fetch_raw";
      const rawList = await transport.fetchRawByUids(uids);
      imapMessagesFetchedTotal.inc(rawList.length);

      for (const raw of rawList) {
        syncStage = "parse_message";
        const parsed = await parseImapRawSource(raw.rawSource);
        const envMid = raw.envelope?.messageId ?? undefined;
        const externalMessageId = stableExternalMessageId(envMid ?? parsed.messageIdHeader, meta.uidValidityStr, raw.uid);

        const subject = parsed.subject ?? raw.envelope?.subject ?? null;
        const fromAddr =
          parsed.fromAddress ??
          raw.envelope?.from?.[0]?.address ??
          raw.envelope?.from?.[0]?.name ??
          null;

        let sourceMessage = await prisma.sourceMessage.findUnique({
          where: {
            tenantId_provider_accountKey_externalMessageId: {
              tenantId: data.tenantId,
              provider: "ZENBOX_IMAP",
              accountKey: data.accountKey,
              externalMessageId,
            },
          },
        });

        if (!sourceMessage) {
          try {
            syncStage = "persist_source_message";
            sourceMessage = await prisma.sourceMessage.create({
              data: {
                tenantId: data.tenantId,
                provider: "ZENBOX_IMAP",
                accountKey: data.accountKey,
                mailboxId: mailbox.id,
                externalMessageId,
                imapUid: raw.uid,
                receivedAt: parsed.receivedAt ?? raw.internalDate ?? new Date(),
                subject,
                fromAddress: fromAddr,
                rawHeaders: parsed.rawHeaders as Prisma.InputJsonValue,
              },
            });
          } catch (e) {
            if (!isPrismaUniqueViolation(e)) throw e;
            imapDuplicatesSkippedTotal.inc({ kind: "message" });
            sourceMessage = await prisma.sourceMessage.findUniqueOrThrow({
              where: {
                tenantId_provider_accountKey_externalMessageId: {
                  tenantId: data.tenantId,
                  provider: "ZENBOX_IMAP",
                  accountKey: data.accountKey,
                  externalMessageId,
                },
              },
            });
          }
        } else {
          imapDuplicatesSkippedTotal.inc({ kind: "message" });
        }

        if (sourceMessage.processedAt) {
          if (raw.uid > maxSeenUid) maxSeenUid = raw.uid;
          continue;
        }

        const storage = createObjectStorage();

        for (const att of parsed.attachments) {
          if (!att.isInvoiceCandidate) continue;

          syncStage = "storage_put";
          const sha = sha256Buffer(att.content);
          const existingAtt = await prisma.sourceAttachment.findUnique({
            where: {
              sourceMessageId_sha256: { sourceMessageId: sourceMessage.id, sha256: sha },
            },
          });
          if (existingAtt) {
            imapDuplicatesSkippedTotal.inc({ kind: "attachment" });
            continue;
          }

          const objectKey = `imap/${data.tenantId}/${sha}-${att.fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
          const put = await storage.putObject({
            key: objectKey,
            body: att.content,
            contentType: att.mimeType,
            tenantId: data.tenantId,
          });

          const storageUrl =
            put.bucket !== undefined && put.bucket !== null ? `s3://${put.bucket}/${put.key}` : `local:${put.key}`;

          const sa = await prisma.sourceAttachment.create({
            data: {
              sourceMessageId: sourceMessage.id,
              fileName: att.fileName,
              mimeType: att.mimeType,
              sizeBytes: att.content.length,
              sha256: sha,
              storageUrl,
              isInvoiceCandidate: true,
            },
          });
          imapAttachmentsFetchedTotal.inc();

          const sourceExternalId = `zenbox:${externalMessageId}:${sha}`;
          syncStage = "ingest_attachment";
          const ingest = await ingestAttachmentAndEnqueue(prisma, {
            tenantId: data.tenantId,
            actorUserId,
            buffer: att.content,
            filename: att.fileName,
            mimeType: att.mimeType,
            ingestionSourceType: "MAIL_IMAP",
            sourceExternalId,
            intakeSourceType: "EMAIL",
            sourceAccount: data.accountKey,
            existingStorage: { storageKey: put.key, storageBucket: put.bucket ?? null },
            metadata: {
              zenboxAccount: data.accountKey,
              imapUid: raw.uid.toString(),
              externalMessageId,
              sourceAttachmentId: sa.id,
            },
          });

          await prisma.sourceAttachment.update({
            where: { id: sa.id },
            data: { documentId: ingest.documentId },
          });
        }

        syncStage = "mark_message_processed";
        await prisma.sourceMessage.update({
          where: { id: sourceMessage.id },
          data: { processedAt: new Date() },
        });

        if (raw.uid > maxSeenUid) maxSeenUid = raw.uid;
      }

      cursorUid = maxSeenUid;
      syncStage = "checkpoint_cursor";
      await prisma.mailboxSyncState.update({
        where: { mailboxId: mailbox.id },
        data: {
          imapLastProcessedUid: maxSeenUid,
          lastSyncedAt: new Date(),
          imapUidValidityStr: meta.uidValidityStr,
        },
      });
    }

    syncStage = "finalize_idle";
    await prisma.mailboxSyncState.update({
      where: { mailboxId: mailbox.id },
      data: {
        imapSyncStatus: "IDLE",
        lastError: null,
        lastSyncedAt: new Date(),
        imapLastProcessedUid: maxSeenUid,
        imapUidValidityStr: meta.uidValidityStr,
      },
    });

    imapLastUidGauge.set({ tenant_id: data.tenantId, account_key: data.accountKey }, Number(maxSeenUid));
    imapSyncRunsTotal.inc({ status: "success" });
  } catch (err) {
    logZenboxImapSyncFailure(syncStage, err, {
      tenantId: data.tenantId,
      accountKey: data.accountKey,
    });
    const lastError = formatZenboxImapLastError(syncStage, err);
    if (mailboxId) {
      await prisma.mailboxSyncState.update({
        where: { mailboxId },
        data: {
          imapSyncStatus: "ERROR",
          lastError,
        },
      });
    }
    imapSyncRunsTotal.inc({ status: "error" });
    if (err instanceof ZenboxImapPermanentError) throw err;
    if (err instanceof ZenboxImapRetryableError) throw err;
    throw classifyImapFailure(err);
  } finally {
    await transport?.disconnect().catch(() => undefined);
    await releaseImapZenboxLock(redis, lockKey);
    endTimer();
  }
}
