import type { PrismaClient } from "@prisma/client";
import { ConnectorType, IntegrationCredentialKind } from "@prisma/client";
import { loadConfig } from "../../config.js";
import { AppError } from "../../lib/errors.js";
import { decryptSecret, encryptSecret } from "../../lib/encryption.js";
import type { TenantKsefUpsertInput } from "../tenant/tenant.schema.js";
import { patchPortalIntegrations } from "../tenant/tenant.service.js";
import { KsefClient } from "./ksef-client.js";
import { getEffectiveKsefApiEnv, readKsefEnvOverrideFromMetadata, type KsefApiEnv } from "./ksef-effective-env.js";

/** Jedna konfiguracja KSeF na tenant (`integration_credentials`). */
export const KSEF_TENANT_CREDENTIAL_LABEL = "tenant-primary";

export type TenantKsefSecretPayloadV1 = {
  v: 1;
  /** Zaszyfrowany PKCS#5 blob z portalu MF, PEM klucza lub surowy token KSeF (gdy brak PIN). */
  ksefTokenOrEncryptedBlob: string;
  tokenPassword: string;
  certPemOrDerBase64?: string | null;
};

export function buildGlobalKsefClient(
  cfg: ReturnType<typeof loadConfig>,
  apiEnv: "production" | "sandbox",
): KsefClient | null {
  if (!cfg.KSEF_TOKEN || !cfg.KSEF_NIP) return null;
  try {
    if (cfg.KSEF_CERT && cfg.KSEF_TOKEN_PASSWORD) {
      return KsefClient.fromEncryptedCertificate(
        apiEnv,
        cfg.KSEF_TOKEN,
        cfg.KSEF_TOKEN_PASSWORD,
        cfg.KSEF_CERT,
        cfg.KSEF_NIP,
      );
    }
    if (cfg.KSEF_TOKEN_PASSWORD) {
      return KsefClient.fromEncryptedToken(apiEnv, cfg.KSEF_TOKEN, cfg.KSEF_TOKEN_PASSWORD, cfg.KSEF_NIP);
    }
    return new KsefClient(apiEnv, cfg.KSEF_NIP, { kind: "token", ksefToken: cfg.KSEF_TOKEN });
  } catch {
    return null;
  }
}

function tryBuildClientFromPayload(
  apiEnv: "production" | "sandbox",
  payload: TenantKsefSecretPayloadV1,
  nipDigits: string,
): KsefClient | null {
  if (nipDigits.length !== 10) return null;
  const tok = payload.ksefTokenOrEncryptedBlob.trim();
  const pwd = (payload.tokenPassword ?? "").trim();
  const cert = (payload.certPemOrDerBase64 ?? "").trim();
  try {
    if (cert) {
      if (!pwd) return null;
      return KsefClient.fromEncryptedCertificate(apiEnv, tok, pwd, cert, nipDigits);
    }
    if (pwd) {
      return KsefClient.fromEncryptedToken(apiEnv, tok, pwd, nipDigits);
    }
    return new KsefClient(apiEnv, nipDigits, { kind: "token", ksefToken: tok });
  } catch {
    return null;
  }
}

/** Tylko dane tenanta — bez fallbacku do `KSEF_*` z .env. */
export async function tryLoadTenantOnlyKsefClient(
  prisma: PrismaClient,
  tenantId: string,
  apiEnv: "production" | "sandbox",
): Promise<KsefClient | null> {
  const cfg = loadConfig();

  const tenant = await prisma.tenant.findFirst({
    where: { id: tenantId, deletedAt: null },
    select: { nip: true },
  });
  const nipDigits = (tenant?.nip ?? "").replace(/\D/g, "");
  if (nipDigits.length !== 10) return null;

  const row = await prisma.integrationCredential.findFirst({
    where: {
      tenantId,
      connector: ConnectorType.KSEF,
      label: KSEF_TENANT_CREDENTIAL_LABEL,
      isActive: true,
    },
  });
  if (!row || row.kind !== IntegrationCredentialKind.GENERIC_SECRET) return null;

  try {
    const plain = decryptSecret(row.secretEncrypted, cfg.ENCRYPTION_KEY);
    const payload = JSON.parse(plain) as TenantKsefSecretPayloadV1;
    if (payload.v !== 1 || !payload.ksefTokenOrEncryptedBlob?.trim()) return null;
    return tryBuildClientFromPayload(apiEnv, payload, nipDigits);
  } catch {
    return null;
  }
}

/** Tenant (jeśli skonfigurowany i poprawny) albo globalny `.env`. */
export async function loadKsefClientForTenant(
  prisma: PrismaClient,
  tenantId: string,
): Promise<KsefClient | null> {
  const cfg = loadConfig();
  const effective = await getEffectiveKsefApiEnv(prisma, tenantId);
  if (effective === "mock") return null;
  const tenantClient = await tryLoadTenantOnlyKsefClient(prisma, tenantId, effective);
  if (tenantClient) return tenantClient;
  if (cfg.KSEF_DISABLE_GLOBAL_FALLBACK) return null;
  return buildGlobalKsefClient(cfg, effective);
}

export type KsefCredentialSource = "tenant" | "global" | "none";

export async function resolveKsefCredentialSource(
  prisma: PrismaClient,
  tenantId: string,
): Promise<{ source: KsefCredentialSource; client: KsefClient | null }> {
  const cfg = loadConfig();
  const effective = await getEffectiveKsefApiEnv(prisma, tenantId);
  if (effective === "mock") return { source: "none", client: null };
  const tenantClient = await tryLoadTenantOnlyKsefClient(prisma, tenantId, effective);
  if (tenantClient) return { source: "tenant", client: tenantClient };
  if (cfg.KSEF_DISABLE_GLOBAL_FALLBACK) return { source: "none", client: null };
  const global = buildGlobalKsefClient(cfg, effective);
  if (global) return { source: "global", client: global };
  return { source: "none", client: null };
}

export async function upsertTenantKsefCredentials(
  prisma: PrismaClient,
  tenantId: string,
  userId: string,
  input: {
    ksefTokenOrEncryptedBlob: string;
    tokenPassword?: string | null;
    certPemOrDerBase64?: string | null;
  },
): Promise<void> {
  const cfg = loadConfig();
  const effective = await getEffectiveKsefApiEnv(prisma, tenantId);
  if (effective === "mock") {
    throw AppError.validation(
      "KSeF bez realnego API (mock): ustaw środowisko sandbox lub produkcja w sekcji KSeF albo zmień KSEF_ENV na serwerze, potem zapisz poświadczenia.",
    );
  }
  const tenant = await prisma.tenant.findFirst({
    where: { id: tenantId, deletedAt: null },
    select: { nip: true },
  });
  const nipDigits = (tenant?.nip ?? "").replace(/\D/g, "");
  if (nipDigits.length !== 10) {
    throw AppError.validation("Uzupełnij poprawny 10-cyfrowy NIP firmy w zakładce Firma — KSeF wymaga NIP kontekstu.");
  }

  const cert = (input.certPemOrDerBase64 ?? "").trim();
  const pwd = (input.tokenPassword ?? "").trim();
  if (cert && !pwd) {
    throw AppError.validation("Przy certyfikacie podaj hasło / PIN do zaszyfrowanego klucza prywatnego.");
  }

  const payload: TenantKsefSecretPayloadV1 = {
    v: 1,
    ksefTokenOrEncryptedBlob: input.ksefTokenOrEncryptedBlob.trim(),
    tokenPassword: pwd,
    certPemOrDerBase64: cert || null,
  };

  const probe = tryBuildClientFromPayload(effective, payload, nipDigits);
  if (!probe) {
    throw AppError.validation(
      "Nie udało się zinterpretować poświadczeń KSeF (token + PIN / certyfikat). Sprawdź format danych z portalu MF.",
    );
  }

  const secretJson = JSON.stringify(payload);
  const enc = encryptSecret(secretJson, cfg.ENCRYPTION_KEY);
  const authMode = cert ? "certificate" : pwd ? "encrypted_token" : "raw_token";

  await prisma.integrationCredential.upsert({
    where: {
      tenantId_connector_label: {
        tenantId,
        connector: ConnectorType.KSEF,
        label: KSEF_TENANT_CREDENTIAL_LABEL,
      },
    },
    create: {
      tenantId,
      connector: ConnectorType.KSEF,
      kind: IntegrationCredentialKind.GENERIC_SECRET,
      label: KSEF_TENANT_CREDENTIAL_LABEL,
      secretEncrypted: enc,
      metadata: { authMode } as object,
      isActive: true,
      createdById: userId,
    },
    update: {
      secretEncrypted: enc,
      metadata: { authMode } as object,
      isActive: true,
      createdById: userId,
    },
  });

  await patchPortalIntegrations(prisma, tenantId, userId, { ksefConfigured: true });

  await prisma.auditLog.create({
    data: {
      tenantId,
      actorId: userId,
      action: "TENANT_KSEF_CREDENTIALS_UPSERTED",
      entityType: "INTEGRATION",
      entityId: tenantId,
      metadata: { authMode } as object,
    },
  });
}

export async function deleteTenantKsefCredentials(
  prisma: PrismaClient,
  tenantId: string,
  userId: string,
): Promise<void> {
  await prisma.integrationCredential.deleteMany({
    where: {
      tenantId,
      connector: ConnectorType.KSEF,
      label: KSEF_TENANT_CREDENTIAL_LABEL,
    },
  });
  await patchPortalIntegrations(prisma, tenantId, userId, { ksefConfigured: false });
  await prisma.auditLog.create({
    data: {
      tenantId,
      actorId: userId,
      action: "TENANT_KSEF_CREDENTIALS_DELETED",
      entityType: "INTEGRATION",
      entityId: tenantId,
      metadata: {},
    },
  });
}

export async function getTenantKsefCredentialsPublic(
  prisma: PrismaClient,
  tenantId: string,
): Promise<{
  environment: KsefApiEnv;
  serverEnvironment: string;
  ksefEnvOverride: "sandbox" | "production" | null;
  tenantNip: string | null;
  tenantNipOk: boolean;
  storedCredential: boolean;
  authMode: string | null;
}> {
  const cfg = loadConfig();
  const effective = await getEffectiveKsefApiEnv(prisma, tenantId);
  const source = await prisma.ingestionSource.findFirst({
    where: { tenantId, kind: "KSEF" },
    orderBy: { updatedAt: "desc" },
    select: { metadata: true },
  });
  const ksefEnvOverride = readKsefEnvOverrideFromMetadata(source?.metadata ?? null);
  const tenant = await prisma.tenant.findFirst({
    where: { id: tenantId, deletedAt: null },
    select: { nip: true },
  });
  const nipDigits = (tenant?.nip ?? "").replace(/\D/g, "");
  const row = await prisma.integrationCredential.findFirst({
    where: {
      tenantId,
      connector: ConnectorType.KSEF,
      label: KSEF_TENANT_CREDENTIAL_LABEL,
      isActive: true,
    },
    select: { metadata: true },
  });
  const meta = row?.metadata as { authMode?: string } | null;
  return {
    environment: effective,
    serverEnvironment: cfg.KSEF_ENV,
    ksefEnvOverride,
    tenantNip: tenant?.nip ?? null,
    tenantNipOk: nipDigits.length === 10,
    storedCredential: Boolean(row),
    authMode: typeof meta?.authMode === "string" ? meta.authMode : null,
  };
}

/** Czy dla tenanta można zaplanować auto-sync (tenant albo global). */
export async function tenantCanRunKsefSync(prisma: PrismaClient, tenantId: string): Promise<boolean> {
  const { client } = await resolveKsefCredentialSource(prisma, tenantId);
  return client !== null;
}

export type TenantKsefTestResult = {
  ok: boolean;
  credentialSource: KsefCredentialSource;
  /** Czy testowałeś zapis w bazie, czy tylko pola formularza. */
  probe: "saved" | "draft";
  accessValidUntil?: string;
  message?: string;
};

/**
 * Wywołuje pełny handshake KSeF (`authenticate`).
 * Bez `draft` — używa zapisanych poświadczeń tenanta lub fallbacku `.env`.
 * Z `draft` — tylko dane z żądania (bez zapisu), NIP z profilu tenanta.
 */
export async function testTenantKsefConnection(
  prisma: PrismaClient,
  tenantId: string,
  draft?: TenantKsefUpsertInput,
): Promise<TenantKsefTestResult> {
  const effective = await getEffectiveKsefApiEnv(prisma, tenantId);
  if (effective === "mock") {
    return {
      ok: false,
      credentialSource: "none",
      probe: draft ? "draft" : "saved",
      message:
        "Brak realnego API KSeF (mock): ustaw środowisko sandbox/produkcja dla firmy lub KSEF_ENV na serwerze.",
    };
  }

  if (draft?.ksefTokenOrEncryptedBlob?.trim()) {
    const tenant = await prisma.tenant.findFirst({
      where: { id: tenantId, deletedAt: null },
      select: { nip: true },
    });
    const nipDigits = (tenant?.nip ?? "").replace(/\D/g, "");
    if (nipDigits.length !== 10) {
      return {
        ok: false,
        credentialSource: "none",
        probe: "draft",
        message: "Uzupełnij poprawny 10-cyfrowy NIP firmy w zakładce Firma.",
      };
    }
    const cert = (draft.certPemOrDerBase64 ?? "").trim();
    const pwd = (draft.tokenPassword ?? "").trim();
    if (cert && !pwd) {
      return {
        ok: false,
        credentialSource: "none",
        probe: "draft",
        message: "Przy certyfikacie podaj hasło / PIN do klucza prywatnego.",
      };
    }
    const payload: TenantKsefSecretPayloadV1 = {
      v: 1,
      ksefTokenOrEncryptedBlob: draft.ksefTokenOrEncryptedBlob.trim(),
      tokenPassword: pwd,
      certPemOrDerBase64: cert || null,
    };
    const client = tryBuildClientFromPayload(effective, payload, nipDigits);
    if (!client) {
      return {
        ok: false,
        credentialSource: "none",
        probe: "draft",
        message: "Nie udało się utworzyć klienta KSeF z podanych danych (format / PIN / certyfikat).",
      };
    }
    try {
      const tokens = await client.authenticate();
      return {
        ok: true,
        credentialSource: "tenant",
        probe: "draft",
        accessValidUntil: tokens.accessValidUntil,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, credentialSource: "tenant", probe: "draft", message: msg.slice(0, 800) };
    }
  }

  const { source, client } = await resolveKsefCredentialSource(prisma, tenantId);
  if (!client) {
    return {
      ok: false,
      credentialSource: "none",
      probe: "saved",
      message:
        "Brak poświadczeń: zapisz KSeF w Ustawieniach lub ustaw na serwerze zmienne KSEF_TOKEN i KSEF_NIP (oraz ewent. KSEF_TOKEN_PASSWORD / KSEF_CERT).",
    };
  }
  try {
    const tokens = await client.authenticate();
    return {
      ok: true,
      credentialSource: source,
      probe: "saved",
      accessValidUntil: tokens.accessValidUntil,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, credentialSource: source, probe: "saved", message: msg.slice(0, 800) };
  }
}
