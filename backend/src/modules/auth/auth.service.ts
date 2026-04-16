import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import type { PrismaClient, UserRole } from "@prisma/client";
import { isPlatformAdminEmail, loadConfig } from "../../config.js";
import { AppError } from "../../lib/errors.js";
import { signAccessToken } from "../../lib/jwt.js";
import { hashPassword, verifyPassword } from "../../lib/password.js";
import { generateRefreshToken, hashOpaqueToken } from "../../lib/token-hash.js";
import type { BillingPlanCode } from "../billing/subscription-plans.js";
import type { LoginInput, RegisterInput } from "./auth.schema.js";

type GoogleStatePayload = {
  typ: "google_state";
  nonce: string;
};

export async function registerTenantAccount(prisma: PrismaClient, input: RegisterInput) {
  const exists = await prisma.user.findUnique({ where: { email: input.email.toLowerCase() } });
  if (exists) throw AppError.conflict("Email already exists");

  const passwordHash = await hashPassword(input.password);

  const result = await prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({
      data: {
        name: input.tenantName,
        nip: input.tenantNip ?? null,
      },
    });
    const user = await tx.user.create({
      data: {
        tenantId: tenant.id,
        email: input.email.toLowerCase(),
        passwordHash,
        role: "OWNER",
        isActive: true,
        emailVerified: false,
      },
    });
    await tx.subscription.create({
      data: {
        tenantId: tenant.id,
        status: input.planCode === "pro" ? "TRIALING" : "ACTIVE",
        provider: "MANUAL",
        planCode: input.planCode,
        currentPeriodStart: new Date(),
        trialEndsAt: input.planCode === "pro" ? new Date(Date.now() + 14 * 24 * 60 * 60 * 1000) : null,
      },
    });
    return { tenant, user };
  });

  const verificationToken = await issueEmailVerificationToken(prisma, result.user.id, result.user.tenantId);

  return {
    tenant: { id: result.tenant.id, name: result.tenant.name, nip: result.tenant.nip },
    user: sanitizeUser(result.user),
    needsEmailVerification: true,
    ...(loadConfig().NODE_ENV !== "production" ? { verificationToken } : {}),
  };
}

export async function login(prisma: PrismaClient, input: LoginInput) {
  try {
    const user = await prisma.user.findUnique({
      where: { email: input.email.toLowerCase() },
    });
    if (!user?.isActive) {
      throw AppError.unauthorized("Invalid credentials");
    }
    if (!user.passwordHash) {
      throw AppError.unauthorized("Use Google sign-in for this account");
    }
    const ok = await verifyPassword(input.password, user.passwordHash);
    if (!ok) {
      throw AppError.unauthorized("Invalid credentials");
    }
    if (!user.emailVerified) {
      throw AppError.forbidden("Email not verified");
    }
    const tokens = await issueTokens(prisma, user.id, user.tenantId, user.role);
    return { user: sanitizeUser(user), ...tokens };
  } catch (e) {
    if (e instanceof AppError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    if (/P1001|Can't reach database|ECONNREFUSED/i.test(msg)) {
      throw AppError.internal(
        "Brak połączenia z bazą danych. Uruchom Postgres (np. docker compose up -d postgres).",
      );
    }
    throw AppError.internal("Logowanie chwilowo niedostępne.");
  }
}

export async function refreshSession(prisma: PrismaClient, refreshToken: string) {
  const hash = hashOpaqueToken(refreshToken);
  const row = await prisma.refreshToken.findUnique({
    where: { tokenHash: hash },
    include: { user: true },
  });
  if (!row || row.revokedAt || row.expiresAt < new Date()) {
    throw AppError.unauthorized("Invalid refresh token");
  }
  if (!row.user.isActive) {
    throw AppError.unauthorized("User inactive");
  }
  if (!row.user.emailVerified) {
    throw AppError.forbidden("Email not verified");
  }

  const cfg = loadConfig();
  const newRaw = generateRefreshToken();
  const newHash = hashOpaqueToken(newRaw);
  const expiresAt = new Date(Date.now() + cfg.JWT_REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);

  const newRow = await prisma.refreshToken.create({
    data: {
      userId: row.userId,
      tokenHash: newHash,
      expiresAt,
    },
  });
  await prisma.refreshToken.update({
    where: { id: row.id },
    data: { revokedAt: new Date(), replacedById: newRow.id },
  });

  const accessToken = signAccessToken(
    { sub: row.user.id, tid: row.user.tenantId, role: row.user.role },
    cfg.JWT_ACCESS_SECRET,
    cfg.JWT_ACCESS_TTL_MIN,
  );

  return {
    accessToken,
    refreshToken: newRaw,
    expiresIn: cfg.JWT_ACCESS_TTL_MIN * 60,
  };
}

export async function logout(prisma: PrismaClient, userId: string, refreshToken?: string) {
  if (refreshToken) {
    const hash = hashOpaqueToken(refreshToken);
    await prisma.refreshToken.updateMany({
      where: { userId, tokenHash: hash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  } else {
    await prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}

type GetMeContext = {
  id: string;
  tenantId: string;
  impersonatedByUserId?: string;
};

export async function getMe(prisma: PrismaClient, ctx: GetMeContext) {
  const user = await prisma.user.findUnique({ where: { id: ctx.id } });
  if (!user?.isActive) {
    throw AppError.unauthorized();
  }
  const tenant = await prisma.tenant.findUnique({
    where: { id: ctx.tenantId },
    select: { name: true, nip: true },
  });
  const base = sanitizeUser(user);
  return {
    ...base,
    tenantId: ctx.tenantId,
    tenantName: tenant?.name ?? null,
    impersonation:
      ctx.impersonatedByUserId !== undefined
        ? {
            active: true as const,
            effectiveTenantId: ctx.tenantId,
            effectiveTenantName: tenant?.name ?? null,
            effectiveTenantNip: tenant?.nip ?? null,
          }
        : null,
  };
}

export async function verifyEmail(prisma: PrismaClient, token: string) {
  const tokenHash = hashOpaqueToken(token);
  const row = await prisma.emailVerificationToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });
  if (!row || row.consumedAt || row.expiresAt < new Date()) {
    throw AppError.validation("Invalid or expired verification token");
  }
  await prisma.$transaction([
    prisma.user.update({
      where: { id: row.userId },
      data: { emailVerified: true },
    }),
    prisma.emailVerificationToken.update({
      where: { id: row.id },
      data: { consumedAt: new Date() },
    }),
  ]);
  const tokens = await issueTokens(prisma, row.user.id, row.user.tenantId, row.user.role);
  return { user: sanitizeUser({ ...row.user, emailVerified: true }), ...tokens };
}

export async function resendEmailVerification(prisma: PrismaClient, email: string) {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user) return { sent: true };
  if (user.emailVerified) return { sent: true };
  const token = await issueEmailVerificationToken(prisma, user.id, user.tenantId);
  return { sent: true, ...(loadConfig().NODE_ENV !== "production" ? { verificationToken: token } : {}) };
}

export function buildGoogleAuthUrl(mode: "login" | "register"): string {
  const cfg = loadConfig();
  if (!cfg.GOOGLE_CLIENT_ID || !cfg.GOOGLE_CLIENT_SECRET || !cfg.GOOGLE_OAUTH_REDIRECT_URI) {
    throw AppError.unavailable("Google OAuth is not configured");
  }
  const state = jwt.sign(
    { typ: "google_state", nonce: crypto.randomUUID(), mode } as GoogleStatePayload & { mode: string },
    cfg.JWT_ACCESS_SECRET,
    { expiresIn: "10m", algorithm: "HS256" },
  );
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", cfg.GOOGLE_CLIENT_ID);
  url.searchParams.set("redirect_uri", cfg.GOOGLE_OAUTH_REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

export async function loginWithGoogleCode(prisma: PrismaClient, code: string, state: string) {
  const cfg = loadConfig();
  if (!cfg.GOOGLE_CLIENT_ID || !cfg.GOOGLE_CLIENT_SECRET || !cfg.GOOGLE_OAUTH_REDIRECT_URI) {
    throw AppError.unavailable("Google OAuth is not configured");
  }
  try {
    const decoded = jwt.verify(state, cfg.JWT_ACCESS_SECRET, { algorithms: ["HS256"] }) as Record<string, unknown>;
    if (decoded.typ !== "google_state") throw new Error("bad state");
  } catch {
    throw AppError.validation("Invalid OAuth state");
  }

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: cfg.GOOGLE_CLIENT_ID,
      client_secret: cfg.GOOGLE_CLIENT_SECRET,
      redirect_uri: cfg.GOOGLE_OAUTH_REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) throw AppError.unauthorized("Google OAuth token exchange failed");
  const tokenBody = (await tokenRes.json()) as { access_token?: string };
  if (!tokenBody.access_token) throw AppError.unauthorized("Google OAuth missing access token");

  const userInfoRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { authorization: `Bearer ${tokenBody.access_token}` },
  });
  if (!userInfoRes.ok) throw AppError.unauthorized("Google OAuth userinfo failed");
  const userInfo = (await userInfoRes.json()) as {
    sub?: string;
    email?: string;
    email_verified?: boolean;
    name?: string;
  };
  if (!userInfo.sub || !userInfo.email || userInfo.email_verified !== true) {
    throw AppError.unauthorized("Google account must have verified email");
  }

  const providerUserId = userInfo.sub;
  const email = userInfo.email.toLowerCase();
  let identity = await prisma.authIdentity.findUnique({
    where: { provider_providerUserId: { provider: "GOOGLE", providerUserId } },
    include: { user: true },
  });

  if (!identity) {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      identity = await prisma.authIdentity.create({
        data: {
          userId: existing.id,
          provider: "GOOGLE",
          providerUserId,
          email,
        },
        include: { user: true },
      });
      await prisma.user.update({ where: { id: existing.id }, data: { emailVerified: true } });
    } else {
      const tenantBase = (userInfo.name?.trim() || email.split("@")[0] || "Nowa firma").slice(0, 180);
      const created = await prisma.$transaction(async (tx) => {
        const selectedPlan: BillingPlanCode = "free";
        const tenant = await tx.tenant.create({ data: { name: tenantBase } });
        const user = await tx.user.create({
          data: {
            tenantId: tenant.id,
            email,
            passwordHash: null,
            role: "OWNER",
            isActive: true,
            emailVerified: true,
          },
        });
        await tx.subscription.create({
          data: {
            tenantId: tenant.id,
            status: "ACTIVE",
            provider: "MANUAL",
            planCode: selectedPlan,
            currentPeriodStart: new Date(),
            trialEndsAt: null,
          },
        });
        return tx.authIdentity.create({
          data: {
            userId: user.id,
            provider: "GOOGLE",
            providerUserId,
            email,
          },
          include: { user: true },
        });
      });
      identity = await prisma.authIdentity.findUnique({
        where: { id: created.id },
        include: { user: true },
      });
    }
  }

  if (!identity) throw AppError.internal("Google identity not found after login flow");
  if (!identity.user.isActive) throw AppError.unauthorized("User inactive");
  const tokens = await issueTokens(prisma, identity.user.id, identity.user.tenantId, identity.user.role);
  return { user: sanitizeUser(identity.user), ...tokens };
}

export async function listTenantsForSuperAdmin(prisma: PrismaClient, limit = 200) {
  const rows = await prisma.tenant.findMany({
    take: Math.max(1, Math.min(500, limit)),
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { users: true, invoices: true } },
      subscriptions: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  return rows.map((t) => ({
    id: t.id,
    name: t.name,
    nip: t.nip,
    deletedAt: t.deletedAt,
    createdAt: t.createdAt,
    userCount: t._count.users,
    invoiceCount: t._count.invoices,
    subscription: (() => {
      const s = t.subscriptions[0];
      if (!s) return null;
      return {
        status: s.status,
        planCode: s.planCode,
        provider: s.provider,
        providerCustomerId: s.providerCustomerId,
        providerSubscriptionId: s.providerSubscriptionId,
        currentPeriodStart: s.currentPeriodStart,
        currentPeriodEnd: s.currentPeriodEnd,
        trialEndsAt: s.trialEndsAt,
      };
    })(),
  }));
}

export async function issueTenantImpersonationAccessToken(
  prisma: PrismaClient,
  superAdminUserId: string,
  targetTenantId: string,
) {
  const user = await prisma.user.findUnique({ where: { id: superAdminUserId } });
  if (!user?.isActive || !isPlatformAdminEmail(user.email)) {
    throw AppError.forbidden("Platform admin required");
  }
  const tenant = await prisma.tenant.findUnique({ where: { id: targetTenantId } });
  if (!tenant) throw AppError.notFound("Tenant not found");
  const cfg = loadConfig();
  await prisma.auditLog.create({
    data: {
      tenantId: targetTenantId,
      actorId: user.id,
      action: "PLATFORM_ADMIN_IMPERSONATION",
      entityType: "TENANT",
      entityId: targetTenantId,
      metadata: {
        actorEmail: user.email,
        targetTenantName: tenant.name,
      } as object,
    },
  });
  return {
    accessToken: signAccessToken(
      { sub: user.id, tid: targetTenantId, role: user.role, impBy: user.id, typ: "impersonation" },
      cfg.JWT_ACCESS_SECRET,
      cfg.JWT_ACCESS_TTL_MIN,
    ),
    expiresIn: cfg.JWT_ACCESS_TTL_MIN * 60,
  };
}

async function issueTokens(
  prisma: PrismaClient,
  userId: string,
  tenantId: string,
  role: UserRole,
) {
  const cfg = loadConfig();
  const accessToken = signAccessToken(
    { sub: userId, tid: tenantId, role },
    cfg.JWT_ACCESS_SECRET,
    cfg.JWT_ACCESS_TTL_MIN,
  );
  const refreshToken = generateRefreshToken();
  const tokenHash = hashOpaqueToken(refreshToken);
  const expiresAt = new Date(Date.now() + cfg.JWT_REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);
  await prisma.refreshToken.create({
    data: { userId, tokenHash, expiresAt },
  });
  return {
    accessToken,
    refreshToken,
    expiresIn: cfg.JWT_ACCESS_TTL_MIN * 60,
  };
}

function sanitizeUser(user: {
  id: string;
  tenantId: string;
  email: string;
  role: UserRole;
  emailVerified: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: user.id,
    tenantId: user.tenantId,
    email: user.email,
    role: user.role,
    emailVerified: user.emailVerified,
    isPlatformAdmin: isPlatformAdminEmail(user.email),
    isActive: user.isActive,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

async function issueEmailVerificationToken(prisma: PrismaClient, userId: string, tenantId: string): Promise<string> {
  const token = generateRefreshToken();
  const tokenHash = hashOpaqueToken(token);
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
  await prisma.emailVerificationToken.create({
    data: {
      userId,
      tenantId,
      tokenHash,
      expiresAt,
    },
  });
  return token;
}
