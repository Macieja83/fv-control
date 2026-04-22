import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { AppError } from "../../lib/errors.js";
import { manualUploadAndEnqueue } from "./manual-upload.service.js";

const HANDOFF_TTL_MS = 20 * 60 * 1000;
const MAX_UPLOADS_PER_HANDOFF = 32;

function randomToken(): string {
  return randomBytes(32).toString("hex");
}

export async function createMobileCaptureHandoff(
  prisma: PrismaClient,
  params: { tenantId: string; userId: string },
): Promise<{ token: string; expiresAt: string }> {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + HANDOFF_TTL_MS);
  await prisma.mobileCaptureHandoff.create({
    data: {
      token,
      tenantId: params.tenantId,
      userId: params.userId,
      expiresAt,
    },
  });
  return { token, expiresAt: expiresAt.toISOString() };
}

async function getValidHandoffOrThrow(prisma: PrismaClient, token: string) {
  const t = token.trim();
  if (t.length < 32) throw AppError.notFound("Nieprawidłowy link");
  const row = await prisma.mobileCaptureHandoff.findUnique({
    where: { token: t },
  });
  if (!row) throw AppError.notFound("Sesja nie istnieje lub wygasła");
  if (row.expiresAt.getTime() < Date.now()) {
    throw AppError.validation("Sesja wygasła — wygeneruj nowy kod QR na komputerze.");
  }
  if (row.uploadCount >= MAX_UPLOADS_PER_HANDOFF) {
    throw AppError.validation("Osiągnięto limit przesłań w tej sesji.");
  }
  return row;
}

export async function getMobileCaptureHandoffStatus(
  prisma: PrismaClient,
  token: string,
): Promise<{
  valid: boolean;
  expiresAt: string;
  uploadCount: number;
  maxUploads: number;
}> {
  const t = token.trim();
  if (t.length < 32) {
    return {
      valid: false,
      expiresAt: new Date(0).toISOString(),
      uploadCount: 0,
      maxUploads: MAX_UPLOADS_PER_HANDOFF,
    };
  }
  const row = await prisma.mobileCaptureHandoff.findUnique({
    where: { token: t },
  });
  if (!row || row.expiresAt.getTime() < Date.now()) {
    return {
      valid: false,
      expiresAt: row?.expiresAt.toISOString() ?? new Date(0).toISOString(),
      uploadCount: row?.uploadCount ?? 0,
      maxUploads: MAX_UPLOADS_PER_HANDOFF,
    };
  }
  return {
    valid: true,
    expiresAt: row.expiresAt.toISOString(),
    uploadCount: row.uploadCount,
    maxUploads: MAX_UPLOADS_PER_HANDOFF,
  };
}

export async function uploadViaMobileCaptureHandoff(
  prisma: PrismaClient,
  params: { token: string; buffer: Buffer; filename: string; mimeType: string },
) {
  const row = await getValidHandoffOrThrow(prisma, params.token);

  const result = await manualUploadAndEnqueue(prisma, {
    tenantId: row.tenantId,
    userId: row.userId,
    buffer: params.buffer,
    filename: params.filename,
    mimeType: params.mimeType,
  });

  await prisma.mobileCaptureHandoff.update({
    where: { id: row.id },
    data: { uploadCount: { increment: 1 } },
  });

  return result;
}
