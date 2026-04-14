import { createHash, randomUUID } from "node:crypto";
import { buffer as streamToBuffer } from "node:stream/consumers";
import type { PrismaClient } from "@prisma/client";
import { createObjectStorage } from "../../adapters/storage/create-storage.js";
import { extractAgreementWithOpenAI } from "../../adapters/ai/openai-agreement.extract.js";
import { AppError } from "../../lib/errors.js";
import { assertAgreementCreationAllowed } from "../billing/subscription-plans.js";
import { parseInvoiceDate } from "../invoices/invoice-dates.js";
import type { AgreementPatchInput } from "./agreement.schema.js";

function sha256Buffer(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

async function readDocumentBuffer(
  prisma: PrismaClient,
  tenantId: string,
  documentId: string,
): Promise<{ buffer: Buffer; mimeType: string }> {
  const doc = await prisma.document.findFirst({
    where: { id: documentId, tenantId, deletedAt: null },
  });
  if (!doc) throw AppError.notFound("Document not found");
  const storage = createObjectStorage();
  const { stream } = await storage.getObjectStream({
    key: doc.storageKey,
    bucket: doc.storageBucket,
  });
  const buf = await streamToBuffer(stream);
  return { buffer: buf, mimeType: doc.mimeType };
}

export async function listAgreements(prisma: PrismaClient, tenantId: string) {
  return prisma.agreement.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    include: {
      primaryDoc: { select: { id: true, mimeType: true, metadata: true } },
      contractor: { select: { id: true, name: true, nip: true } },
    },
  });
}

export async function getAgreement(prisma: PrismaClient, tenantId: string, id: string) {
  const row = await prisma.agreement.findFirst({
    where: { id, tenantId },
    include: {
      primaryDoc: true,
      contractor: true,
    },
  });
  if (!row) throw AppError.notFound("Agreement not found");
  return row;
}

export async function patchAgreement(
  prisma: PrismaClient,
  tenantId: string,
  id: string,
  input: AgreementPatchInput,
) {
  await getAgreement(prisma, tenantId, id);
  return prisma.agreement.update({
    where: { id },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.subject !== undefined ? { subject: input.subject } : {}),
      ...(input.counterpartyName !== undefined ? { counterpartyName: input.counterpartyName } : {}),
      ...(input.counterpartyNip !== undefined ? { counterpartyNip: input.counterpartyNip } : {}),
      ...(input.signedAt !== undefined
        ? { signedAt: input.signedAt ? parseInvoiceDate(input.signedAt) : null }
        : {}),
      ...(input.validUntil !== undefined
        ? { validUntil: input.validUntil ? parseInvoiceDate(input.validUntil) : null }
        : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(input.contractorId !== undefined ? { contractorId: input.contractorId } : {}),
    },
    include: { primaryDoc: true, contractor: true },
  });
}

export async function uploadAgreement(
  prisma: PrismaClient,
  params: {
    tenantId: string;
    userId: string;
    buffer: Buffer;
    filename: string;
    mimeType: string;
  },
) {
  await assertAgreementCreationAllowed(prisma, params.tenantId);
  const sha = sha256Buffer(params.buffer);
  const storage = createObjectStorage();
  const objectKey = `agreements/${sha}-${params.filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const put = await storage.putObject({
    key: objectKey,
    body: params.buffer,
    contentType: params.mimeType,
    tenantId: params.tenantId,
  });
  const storageUrl =
    put.bucket !== undefined && put.bucket !== null ? `s3://${put.bucket}/${put.key}` : `local:${put.key}`;

  const sourceExternalId = randomUUID();
  const doc = await prisma.document.create({
    data: {
      tenantId: params.tenantId,
      sha256: sha,
      storageKey: put.key,
      storageBucket: put.bucket ?? null,
      mimeType: params.mimeType,
      sizeBytes: params.buffer.length,
      sourceType: "MANUAL_UPLOAD",
      sourceExternalId,
      metadata: {
        filename: params.filename,
        storageUrl,
        kind: "agreement",
      } as object,
    },
  });

  const baseTitle = params.filename.replace(/\.[^.]+$/, "").slice(0, 200) || "Umowa";

  const agreement = await prisma.agreement.create({
    data: {
      tenantId: params.tenantId,
      primaryDocId: doc.id,
      title: baseTitle,
      status: "PROCESSING",
      createdById: params.userId,
    },
  });

  await prisma.auditLog.create({
    data: {
      tenantId: params.tenantId,
      actorId: params.userId,
      action: "AGREEMENT_UPLOADED",
      entityType: "DOCUMENT",
      entityId: doc.id,
      metadata: { agreementId: agreement.id, filename: params.filename } as object,
    },
  });

  return { agreementId: agreement.id, documentId: doc.id };
}

export async function runAgreementExtraction(prisma: PrismaClient, tenantId: string, agreementId: string) {
  const row = await prisma.agreement.findFirst({
    where: { id: agreementId, tenantId },
  });
  if (!row) return;
  try {
    const { buffer, mimeType } = await readDocumentBuffer(prisma, tenantId, row.primaryDocId);
    const { fields, raw } = await extractAgreementWithOpenAI(buffer, mimeType);
    const title = fields.title?.trim() || row.title;
    await prisma.agreement.update({
      where: { id: agreementId },
      data: {
        title,
        subject: fields.subject,
        counterpartyName: fields.counterpartyName,
        counterpartyNip: fields.counterpartyNip,
        signedAt: fields.signedAt ? parseInvoiceDate(fields.signedAt) : null,
        validUntil: fields.validUntil ? parseInvoiceDate(fields.validUntil) : null,
        normalizedPayload: raw as object,
        status: "READY",
      },
    });
    await prisma.auditLog.create({
      data: {
        tenantId,
        action: "AGREEMENT_EXTRACTED",
        entityType: "DOCUMENT",
        entityId: row.primaryDocId,
        metadata: { agreementId, confidence: fields.confidence } as object,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await prisma.agreement.update({
      where: { id: agreementId },
      data: { status: "FAILED", notes: `Ekstrakcja: ${msg.slice(0, 2000)}` },
    });
    await prisma.auditLog.create({
      data: {
        tenantId,
        action: "AGREEMENT_EXTRACT_FAILED",
        entityType: "DOCUMENT",
        entityId: row.primaryDocId,
        metadata: { agreementId, error: msg.slice(0, 500) } as object,
      },
    });
  }
}
