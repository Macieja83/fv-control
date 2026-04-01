import type { PrismaClient, UserRole } from "@prisma/client";
import { loadConfig } from "../../config.js";
import { AppError } from "../../lib/errors.js";
import { signAccessToken } from "../../lib/jwt.js";
import { hashPassword, verifyPassword } from "../../lib/password.js";
import { generateRefreshToken, hashOpaqueToken } from "../../lib/token-hash.js";
import type { LoginInput, RegisterInput } from "./auth.schema.js";

export async function registerBootstrap(prisma: PrismaClient, input: RegisterInput) {
  const count = await prisma.user.count();
  if (count > 0) {
    throw AppError.bootstrapClosed();
  }

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
      },
    });
    return { tenant, user };
  });

  const tokens = await issueTokens(prisma, result.user.id, result.user.tenantId, result.user.role);

  return {
    tenant: { id: result.tenant.id, name: result.tenant.name, nip: result.tenant.nip },
    user: sanitizeUser(result.user),
    ...tokens,
  };
}

export async function login(prisma: PrismaClient, input: LoginInput) {
  const user = await prisma.user.findUnique({
    where: { email: input.email.toLowerCase() },
  });
  if (!user?.isActive) {
    throw AppError.unauthorized("Invalid credentials");
  }
  const ok = await verifyPassword(input.password, user.passwordHash);
  if (!ok) {
    throw AppError.unauthorized("Invalid credentials");
  }
  const tokens = await issueTokens(prisma, user.id, user.tenantId, user.role);
  return { user: sanitizeUser(user), ...tokens };
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

export async function getMe(prisma: PrismaClient, userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.isActive) {
    throw AppError.unauthorized();
  }
  return sanitizeUser(user);
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
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: user.id,
    tenantId: user.tenantId,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
