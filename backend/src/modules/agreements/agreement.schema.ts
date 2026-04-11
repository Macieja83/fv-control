import { z } from "zod";

export const agreementIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const agreementPatchSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  subject: z.string().max(2000).optional().nullable(),
  counterpartyName: z.string().max(500).optional().nullable(),
  counterpartyNip: z.string().max(20).optional().nullable(),
  signedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
  contractorId: z.string().uuid().optional().nullable(),
});

export type AgreementPatchInput = z.infer<typeof agreementPatchSchema>;
