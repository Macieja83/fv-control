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

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
