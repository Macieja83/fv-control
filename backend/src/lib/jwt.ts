import jwt from "jsonwebtoken";
import type { UserRole } from "@prisma/client";
import { AppError } from "./errors.js";

export type AccessPayload = {
  sub: string;
  tid: string;
  role: UserRole;
  impBy?: string;
  typ: "access" | "impersonation";
};

export function signAccessToken(
  payload: Omit<AccessPayload, "typ"> & { typ?: AccessPayload["typ"] },
  secret: string,
  expiresInMinutes: number,
): string {
  const body: AccessPayload = { ...payload, typ: payload.typ ?? "access" };
  return jwt.sign(body, secret, { expiresIn: `${expiresInMinutes}m`, algorithm: "HS256" });
}

export function verifyAccessToken(token: string, secret: string): AccessPayload {
  try {
    const decoded = jwt.verify(token, secret, { algorithms: ["HS256"] });
    if (typeof decoded !== "object" || decoded === null) {
      throw AppError.unauthorized("Invalid token");
    }
    const o = decoded as Record<string, unknown>;
    if (
      (o.typ !== "access" && o.typ !== "impersonation") ||
      typeof o.sub !== "string" ||
      typeof o.tid !== "string"
    ) {
      throw AppError.unauthorized("Invalid token");
    }
    if (o.typ === "impersonation" && (typeof o.impBy !== "string" || o.impBy.length === 0)) {
      throw AppError.unauthorized("Invalid impersonation token");
    }
    return {
      sub: o.sub,
      tid: o.tid,
      role: o.role as UserRole,
      typ: o.typ,
      ...(typeof o.impBy === "string" && o.impBy.length > 0 ? { impBy: o.impBy } : {}),
    };
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw AppError.unauthorized("Invalid or expired token");
  }
}
