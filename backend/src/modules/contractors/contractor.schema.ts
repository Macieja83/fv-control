import { z } from "zod";

export const contractorCreateSchema = z.object({
  name: z.string().min(1).max(300),
  nip: z.string().min(1).max(20),
  address: z.string().max(500).optional().nullable(),
  email: z.string().email().max(320).optional().nullable(),
  phone: z.string().max(50).optional().nullable(),
});

export const contractorUpdateSchema = contractorCreateSchema.partial();

export type ContractorCreateInput = z.infer<typeof contractorCreateSchema>;
export type ContractorUpdateInput = z.infer<typeof contractorUpdateSchema>;
