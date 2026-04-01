import type { Prisma } from "@prisma/client";

export function jsonPayload(data: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(data)) as Prisma.InputJsonValue;
}
