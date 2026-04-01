import type { PrismaClient } from "@prisma/client";

export async function listDocuments(
  prisma: PrismaClient,
  tenantId: string,
  page: number,
  limit: number,
) {
  const skip = (page - 1) * limit;
  const [total, rows] = await prisma.$transaction([
    prisma.document.count({ where: { tenantId, deletedAt: null } }),
    prisma.document.findMany({
      where: { tenantId, deletedAt: null },
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
    }),
  ]);
  return {
    data: rows,
    meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
  };
}

export async function getDocument(prisma: PrismaClient, tenantId: string, id: string) {
  const doc = await prisma.document.findFirst({
    where: { id, tenantId, deletedAt: null },
    include: {
      invoices: { select: { id: true, number: true, status: true } },
    },
  });
  return doc;
}
