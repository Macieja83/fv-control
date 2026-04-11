import { z } from "zod";

const nipLike = z
  .string()
  .max(20)
  .optional()
  .nullable()
  .transform((v) => (v == null || v === "" ? null : v.replace(/\s/g, "")));

export const tenantUpdateSchema = z.object({
  name: z.string().min(1).max(300).optional(),
  nip: nipLike,
});

export type TenantUpdateInput = z.infer<typeof tenantUpdateSchema>;

export const portalIntegrationsPatchSchema = z.object({
  bankConnected: z.boolean().optional(),
  bankLabel: z.string().max(120).optional().nullable(),
  ksefConfigured: z.boolean().optional(),
  ksefClientNote: z.string().max(2000).optional().nullable(),
});

export type PortalIntegrationsPatchInput = z.infer<typeof portalIntegrationsPatchSchema>;
