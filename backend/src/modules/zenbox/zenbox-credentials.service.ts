import { z } from "zod";
import type { ConnectorType, Prisma, PrismaClient } from "@prisma/client";
import { loadConfig } from "../../config.js";
import { AppError } from "../../lib/errors.js";
import { decryptSecret, encryptSecret } from "../../lib/encryption.js";

const zenboxSecretSchema = z.object({
  host: z.string().min(1),
  port: z.coerce.number().int().min(1).max(65535),
  username: z.string().min(1),
  password: z.string().min(1),
  tls: z.boolean(),
  mailbox: z.string().min(1).default("INBOX"),
});

export type ZenboxImapCredentialsPlain = z.infer<typeof zenboxSecretSchema>;

const ZENBOX_CONNECTOR: ConnectorType = "IMAP_ZENBOX";

/** Safe for structured logs — never includes password. */
export function redactZenboxCredentialsForLog(c: ZenboxImapCredentialsPlain): Record<string, unknown> {
  return { host: c.host, port: c.port, username: c.username, tls: c.tls, mailbox: c.mailbox };
}

export async function setZenboxCredentials(
  prisma: PrismaClient,
  params: {
    tenantId: string;
    accountKey: string;
    plain: ZenboxImapCredentialsPlain;
    actorUserId?: string | null;
  },
): Promise<{ credentialId: string; mailboxId: string }> {
  const parsed = zenboxSecretSchema.parse(params.plain);
  const cfg = loadConfig();
  const json = JSON.stringify(parsed);
  const enc = encryptSecret(json, cfg.ENCRYPTION_KEY);

  const credential = await prisma.integrationCredential.upsert({
    where: {
      tenantId_connector_label: {
        tenantId: params.tenantId,
        connector: ZENBOX_CONNECTOR,
        label: params.accountKey,
      },
    },
    create: {
      tenantId: params.tenantId,
      connector: ZENBOX_CONNECTOR,
      kind: "IMAP_PASSWORD",
      label: params.accountKey,
      secretEncrypted: enc,
      keyVersion: 1,
      isActive: true,
      createdById: params.actorUserId ?? null,
    },
    update: {
      secretEncrypted: enc,
      isActive: true,
      updatedAt: new Date(),
    },
  });

  const mailbox = await prisma.mailbox.upsert({
    where: {
      tenantId_provider_label: {
        tenantId: params.tenantId,
        provider: "IMAP",
        label: params.accountKey,
      },
    },
    create: {
      tenantId: params.tenantId,
      provider: "IMAP",
      label: params.accountKey,
      credentialId: credential.id,
      isActive: true,
    },
    update: {
      credentialId: credential.id,
      isActive: true,
      updatedAt: new Date(),
    },
  });

  await prisma.mailboxSyncState.upsert({
    where: { mailboxId: mailbox.id },
    create: { mailboxId: mailbox.id },
    update: {},
  });

  console.info(
    JSON.stringify({
      msg: "zenbox_credentials_set",
      tenantId: params.tenantId,
      accountKey: params.accountKey,
      config: redactZenboxCredentialsForLog(parsed),
    }),
  );

  return { credentialId: credential.id, mailboxId: mailbox.id };
}

export async function rotateZenboxCredentials(
  prisma: PrismaClient,
  params: {
    tenantId: string;
    accountKey: string;
    plain: ZenboxImapCredentialsPlain;
    actorUserId?: string | null;
  },
): Promise<{ credentialId: string }> {
  const parsed = zenboxSecretSchema.parse(params.plain);
  const cfg = loadConfig();
  const enc = encryptSecret(JSON.stringify(parsed), cfg.ENCRYPTION_KEY);

  const row = await prisma.integrationCredential.updateMany({
    where: {
      tenantId: params.tenantId,
      connector: ZENBOX_CONNECTOR,
      label: params.accountKey,
    },
    data: {
      secretEncrypted: enc,
      keyVersion: { increment: 1 },
      rotatedAt: new Date(),
      updatedAt: new Date(),
    },
  });

  if (row.count === 0) {
    throw AppError.notFound("Zenbox credential not found for accountKey");
  }

  const cred = await prisma.integrationCredential.findFirst({
    where: { tenantId: params.tenantId, connector: ZENBOX_CONNECTOR, label: params.accountKey },
  });
  if (!cred) throw AppError.notFound("Zenbox credential not found");

  console.info(
    JSON.stringify({
      msg: "zenbox_credentials_rotated",
      tenantId: params.tenantId,
      accountKey: params.accountKey,
      keyVersion: cred.keyVersion,
      config: redactZenboxCredentialsForLog(parsed),
    }),
  );

  return { credentialId: cred.id };
}

export async function getZenboxCredentialsDecrypted(
  prisma: PrismaClient,
  tenantId: string,
  accountKey: string,
): Promise<ZenboxImapCredentialsPlain> {
  const cfg = loadConfig();
  const row = await prisma.integrationCredential.findFirst({
    where: { tenantId, connector: ZENBOX_CONNECTOR, label: accountKey, isActive: true },
  });
  if (!row) throw AppError.notFound("Zenbox IMAP credentials not configured");
  let json: string;
  try {
    json = decryptSecret(row.secretEncrypted, cfg.ENCRYPTION_KEY);
  } catch {
    throw AppError.internal("Failed to decrypt Zenbox credentials");
  }
  return zenboxSecretSchema.parse(JSON.parse(json));
}

export async function loadMailboxWithCredential(
  prisma: PrismaClient,
  tenantId: string,
  accountKey: string,
): Promise<{
  mailbox: Prisma.MailboxGetPayload<{ include: { syncState: true; credential: true } }>;
}> {
  const mailbox = await prisma.mailbox.findFirst({
    where: { tenantId, provider: "IMAP", label: accountKey, isActive: true },
    include: { syncState: true, credential: true },
  });
  if (!mailbox?.credential || mailbox.credential.connector !== ZENBOX_CONNECTOR) {
    throw AppError.notFound("Zenbox mailbox or credential not found");
  }
  return { mailbox };
}
