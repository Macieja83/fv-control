import type { PrismaClient } from "@prisma/client";
import { AppError } from "../../lib/errors.js";
import type { ContractorCreateInput, ContractorUpdateInput } from "./contractor.schema.js";

export async function listContractors(prisma: PrismaClient, tenantId: string) {
  return prisma.contractor.findMany({
    where: { tenantId, deletedAt: null },
    orderBy: { name: "asc" },
  });
}

export async function getContractor(prisma: PrismaClient, tenantId: string, id: string) {
  const c = await prisma.contractor.findFirst({
    where: { id, tenantId, deletedAt: null },
  });
  if (!c) throw AppError.notFound("Contractor not found");
  return c;
}

export async function createContractor(
  prisma: PrismaClient,
  tenantId: string,
  input: ContractorCreateInput,
) {
  try {
    return await prisma.contractor.create({
      data: {
        tenantId,
        name: input.name,
        nip: input.nip,
        address: input.address ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
      },
    });
  } catch (e: unknown) {
    if (isUniqueViolation(e)) {
      throw AppError.conflict("Contractor with this NIP already exists for tenant");
    }
    throw e;
  }
}

export async function updateContractor(
  prisma: PrismaClient,
  tenantId: string,
  id: string,
  input: ContractorUpdateInput,
) {
  await getContractor(prisma, tenantId, id);
  try {
    return await prisma.contractor.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.nip !== undefined ? { nip: input.nip } : {}),
        ...(input.address !== undefined ? { address: input.address } : {}),
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
      },
    });
  } catch (e: unknown) {
    if (isUniqueViolation(e)) {
      throw AppError.conflict("Contractor with this NIP already exists for tenant");
    }
    throw e;
  }
}

export async function softDeleteContractor(prisma: PrismaClient, tenantId: string, id: string) {
  await getContractor(prisma, tenantId, id);
  await prisma.contractor.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && "code" in e && (e as { code: string }).code === "P2002";
}
