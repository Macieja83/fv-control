import type { DuplicateResolution, PrismaClient } from "@prisma/client";
import { AppError } from "../../lib/errors.js";

export async function listDuplicates(prisma: PrismaClient, tenantId: string, page: number, limit: number) {
  const skip = (page - 1) * limit;
  const [total, rows] = await prisma.$transaction([
    prisma.invoiceDuplicate.count({ where: { tenantId } }),
    prisma.invoiceDuplicate.findMany({
      where: { tenantId },
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
      include: {
        candidate: { include: { contractor: true } },
        canonical: { include: { contractor: true } },
      },
    }),
  ]);
  return {
    data: rows.map((r) => ({
      id: r.id,
      confidence: r.confidence.toString(),
      reasonCodes: r.reasonCodes,
      resolution: r.resolution,
      candidate: r.candidate,
      canonical: r.canonical,
      createdAt: r.createdAt,
    })),
    meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
  };
}

export async function resolveDuplicate(
  prisma: PrismaClient,
  tenantId: string,
  actorId: string,
  duplicateId: string,
  resolution: DuplicateResolution,
) {
  const row = await prisma.invoiceDuplicate.findFirst({
    where: { id: duplicateId, tenantId },
  });
  if (!row) throw AppError.notFound("Duplicate record not found");

  await prisma.invoiceDuplicate.update({
    where: { id: duplicateId },
    data: {
      resolution,
      resolvedById: actorId,
      resolvedAt: new Date(),
    },
  });

  if (resolution === "MERGED") {
    await prisma.invoice.update({
      where: { id: row.candidateInvoiceId },
      data: { status: "REJECTED", notes: `Merged into ${row.canonicalInvoiceId}` },
    });
  }

  return { ok: true, id: duplicateId, resolution };
}
