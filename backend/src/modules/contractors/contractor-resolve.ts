import type { Prisma, PrismaClient } from "@prisma/client";

type DbClient = PrismaClient | Prisma.TransactionClient;

/** Z pola NIP / VAT: same cyfry; dla PL zwykle dokładnie 10 cyfr. */
export function polishNipDigits10(raw: string | null | undefined): string | null {
  const d = (raw ?? "").replace(/\D/g, "");
  if (d.length === 10) return d;
  if (d.length === 11 && d.startsWith("0")) {
    const rest = d.slice(1);
    if (rest.length === 10) return rest;
  }
  if (d.length > 10) {
    const tail = d.slice(-10);
    if (/^\d{10}$/.test(tail)) return tail;
  }
  return null;
}

/**
 * Szuka kontrahenta po NIP niezależnie od formatu zapisu w bazie (myślniki, spacje).
 * Zakładamy listę kontrahentów na poziomie pojedynczej firmy — rząd setek wpisów jest OK.
 */
export async function findContractorByNormalizedNip(
  db: DbClient,
  tenantId: string,
  nip10: string,
): Promise<{ id: string } | null> {
  if (!/^\d{10}$/.test(nip10)) return null;
  const rows = await db.contractor.findMany({
    where: { tenantId, deletedAt: null },
    select: { id: true, nip: true },
  });
  for (const r of rows) {
    const stored = polishNipDigits10(r.nip);
    if (stored === nip10) return { id: r.id };
  }
  return null;
}
