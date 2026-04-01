import type { PrismaClient } from "@prisma/client";
import { loadConfig } from "../../config.js";
import { AppError } from "../../lib/errors.js";
import { decryptSecret, encryptSecret } from "../../lib/encryption.js";
import type { PosTestConnectionInput } from "./pos.schema.js";

export async function getPosStatus(prisma: PrismaClient, tenantId: string) {
  const row = await prisma.integrationPos.findUnique({
    where: { tenantId_provider: { tenantId, provider: "POS_RESTA" } },
  });
  if (!row) {
    return {
      configured: false,
      provider: "POS_RESTA" as const,
      isActive: false,
      baseUrl: null,
    };
  }
  let host: string | null = null;
  try {
    host = new URL(row.baseUrl).host;
  } catch {
    host = null;
  }
  return {
    configured: true,
    provider: row.provider,
    isActive: row.isActive,
    baseUrl: row.baseUrl,
    baseUrlHost: host,
    updatedAt: row.updatedAt,
  };
}

export async function upsertPosIntegration(
  prisma: PrismaClient,
  tenantId: string,
  baseUrl: string,
  apiKey: string,
  isActive?: boolean,
) {
  const cfg = loadConfig();
  const enc = encryptSecret(apiKey, cfg.ENCRYPTION_KEY);
  return prisma.integrationPos.upsert({
    where: { tenantId_provider: { tenantId, provider: "POS_RESTA" } },
    create: {
      tenantId,
      provider: "POS_RESTA",
      baseUrl,
      apiKeyEncrypted: enc,
      isActive: isActive ?? true,
    },
    update: {
      baseUrl,
      apiKeyEncrypted: enc,
      ...(isActive !== undefined ? { isActive } : {}),
    },
  });
}

export async function testPosConnection(
  prisma: PrismaClient,
  tenantId: string,
  input: PosTestConnectionInput,
): Promise<{ ok: boolean; statusCode?: number; message: string }> {
  const cfg = loadConfig();
  let baseUrl = input.baseUrl;
  let apiKey = input.apiKey;

  if (!baseUrl || !apiKey) {
    const row = await prisma.integrationPos.findUnique({
      where: { tenantId_provider: { tenantId, provider: "POS_RESTA" } },
    });
    if (!row) {
      throw AppError.validation("No saved POS integration — provide baseUrl and apiKey in the body");
    }
    baseUrl = row.baseUrl;
    apiKey = decryptSecret(row.apiKeyEncrypted, cfg.ENCRYPTION_KEY);
  }

  const url = new URL("/health", baseUrl).toString();
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 8000);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "X-API-Key": apiKey,
      },
      signal: ac.signal,
    });
    clearTimeout(t);
    if (res.ok) {
      return { ok: true, statusCode: res.status, message: "POS endpoint reachable" };
    }
    return {
      ok: false,
      statusCode: res.status,
      message: `POS responded with HTTP ${res.status}`,
    };
  } catch (e) {
    clearTimeout(t);
    const msg = e instanceof Error ? e.message : "Unknown error";
    return { ok: false, message: `Connection failed: ${msg}` };
  }
}

export function syncPosContractors(
  _prisma: PrismaClient,
  _tenantId: string,
): { queued: boolean; message: string } {
  return {
    queued: false,
    message:
      "Sync is not enabled yet. When POS-Resta exposes contractor export, this endpoint will pull and upsert contractors.",
  };
}
