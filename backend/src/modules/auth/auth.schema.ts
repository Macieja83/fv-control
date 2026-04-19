import { z } from "zod";

const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128);

export const registerSchema = z.object({
  tenantName: z.string().min(1).max(200),
  tenantNip: z.string().max(20).optional().nullable(),
  email: z.string().email().max(320),
  password: passwordSchema,
  planCode: z.enum(["free", "pro"]).default("free"),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(128),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(10),
});

export const logoutBodySchema = z.object({
  refreshToken: z.string().min(10).optional(),
});

export const verifyEmailSchema = z.object({
  token: z.string().min(20),
});

export const googleStartSchema = z.object({
  mode: z.enum(["login", "register"]).default("login"),
});

export const googleCallbackSchema = z.object({
  code: z.string().min(1),
  state: z.string().min(10),
});

/** Pierwsze hasło dla konta utworzonego wyłącznie przez Google (passwordHash = null). */
export const setInitialPasswordSchema = z.object({
  password: passwordSchema,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  password: passwordSchema,
});

export const forgotPasswordSchema = z.object({
  email: z.string().email().max(320),
});

export const resetPasswordWithTokenSchema = z.object({
  token: z.string().min(20),
  password: passwordSchema,
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
