import type { UserRole } from "@prisma/client";
import { AppError } from "./errors.js";

const MUTATION_ROLES: UserRole[] = ["OWNER", "ADMIN", "ACCOUNTANT"];
const INTEGRATION_ROLES: UserRole[] = ["OWNER", "ADMIN"];

export function assertCanMutate(role: UserRole): void {
  if (!MUTATION_ROLES.includes(role)) {
    throw AppError.forbidden("Insufficient permissions for this operation");
  }
}

export function assertCanManageIntegrations(role: UserRole): void {
  if (!INTEGRATION_ROLES.includes(role)) {
    throw AppError.forbidden("Insufficient permissions for integrations");
  }
}
