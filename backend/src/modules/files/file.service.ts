import { createHash, randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MultipartFile } from "@fastify/multipart";
import type { PrismaClient } from "@prisma/client";
import { loadConfig } from "../../config.js";
import { AppError } from "../../lib/errors.js";
import { createInvoiceEvent } from "../invoices/invoice-events.js";

export async function listInvoiceFiles(prisma: PrismaClient, tenantId: string, invoiceId: string) {
  const inv = await prisma.invoice.findFirst({ where: { id: invoiceId, tenantId } });
  if (!inv) throw AppError.notFound("Invoice not found");
  return prisma.invoiceFile.findMany({
    where: { invoiceId },
    orderBy: { uploadedAt: "desc" },
  });
}

export async function saveInvoiceFile(
  prisma: PrismaClient,
  tenantId: string,
  userId: string,
  invoiceId: string,
  file: MultipartFile,
) {
  const inv = await prisma.invoice.findFirst({ where: { id: invoiceId, tenantId } });
  if (!inv) throw AppError.notFound("Invoice not found");

  const cfg = loadConfig();
  const maxBytes = cfg.MAX_UPLOAD_MB * 1024 * 1024;
  const mimeType = file.mimetype || "application/octet-stream";
  const ext = safeExt(file.filename);
  const relativeDir = path.join(tenantId, invoiceId);
  const absDir = path.join(cfg.UPLOAD_DIR, relativeDir);
  await mkdir(absDir, { recursive: true });

  const storedName = `${randomUUID()}${ext}`;
  const relativePath = path.join(relativeDir, storedName);
  const absPath = path.join(cfg.UPLOAD_DIR, relativePath);

  const hash = createHash("sha256");
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of file.file) {
    const buf: Buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    size += buf.length;
    if (size > maxBytes) {
      throw AppError.validation(`File exceeds max size of ${cfg.MAX_UPLOAD_MB} MB`);
    }
    hash.update(buf);
    chunks.push(buf);
  }
  await writeFile(absPath, Buffer.concat(chunks));
  const sha256 = hash.digest("hex");

  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.invoiceFile.create({
      data: {
        invoiceId,
        storageType: "LOCAL",
        path: relativePath.replace(/\\/g, "/"),
        mimeType,
        sizeBytes: size,
        sha256,
      },
    });
    await createInvoiceEvent(tx, {
      invoiceId,
      actorUserId: userId,
      type: "FILE_ADDED",
      payload: { fileId: created.id, mimeType, sizeBytes: size },
    });
    return created;
  });

  return row;
}

export async function deleteInvoiceFile(
  prisma: PrismaClient,
  tenantId: string,
  userId: string,
  invoiceId: string,
  fileId: string,
) {
  const inv = await prisma.invoice.findFirst({ where: { id: invoiceId, tenantId } });
  if (!inv) throw AppError.notFound("Invoice not found");
  const row = await prisma.invoiceFile.findFirst({ where: { id: fileId, invoiceId } });
  if (!row) throw AppError.notFound("File not found");

  const cfg = loadConfig();
  if (row.storageType === "LOCAL") {
    const abs = path.join(cfg.UPLOAD_DIR, row.path);
    try {
      await unlink(abs);
    } catch {
      /* file may already be missing */
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.invoiceFile.delete({ where: { id: fileId } });
    await createInvoiceEvent(tx, {
      invoiceId,
      actorUserId: userId,
      type: "FILE_REMOVED",
      payload: { fileId },
    });
  });
}

export async function resolveDownload(
  prisma: PrismaClient,
  tenantId: string,
  fileId: string,
): Promise<{ absPath: string; mimeType: string; downloadName: string }> {
  const row = await prisma.invoiceFile.findFirst({
    where: { id: fileId },
    include: { invoice: true },
  });
  if (!row || row.invoice.tenantId !== tenantId) {
    throw AppError.notFound("File not found");
  }
  if (row.storageType !== "LOCAL") {
    throw AppError.validation("Only LOCAL files can be downloaded in this deployment");
  }
  const cfg = loadConfig();
  const absPath = path.join(cfg.UPLOAD_DIR, row.path);
  return {
    absPath,
    mimeType: row.mimeType,
    downloadName: path.basename(row.path),
  };
}

function safeExt(filename: string | undefined): string {
  if (!filename) return "";
  const base = path.basename(filename);
  const m = /^(.+?)(\.[a-zA-Z0-9]{1,8})$/.exec(base);
  return m?.[2] ?? "";
}
