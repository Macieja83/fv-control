import { z } from "zod";

export const posTestConnectionSchema = z.object({
  baseUrl: z.string().url().optional(),
  apiKey: z.string().min(1).max(2000).optional(),
});

export const posUpsertSchema = z.object({
  baseUrl: z.string().url(),
  apiKey: z.string().min(1).max(2000),
  isActive: z.boolean().optional(),
});

export type PosTestConnectionInput = z.infer<typeof posTestConnectionSchema>;
