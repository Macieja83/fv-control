import { createHash, randomBytes } from "node:crypto";

export function hashOpaqueToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function generateRefreshToken(): string {
  return randomBytes(48).toString("base64url");
}
