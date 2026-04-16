import { z } from "zod";

export const categoryBreakdownQuerySchema = z.object({
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  currency: z.string().min(3).max(3).optional(),
});

export type CategoryBreakdownQueryInput = z.infer<typeof categoryBreakdownQuerySchema>;
