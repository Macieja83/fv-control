import type { Prisma, PrismaClient } from "@prisma/client";

type DbClient = PrismaClient | Prisma.TransactionClient;

/** Nazwa z pipeline („Kontrahent 1234567890”) — przy kilku rekordach z tym samym NIP wybieramy wpis ręczny. */
const AUTO_CONTRACTOR_NAME = /^Kontrahent\s+\d{10}$/i;

export type ContractorNipMatchRow = {
  id: string;
  nip: string;
  name: string;
  createdAt: Date;
};

/**
 * Przy kilku wierszach z tym samym NIP po normalizacji (np. „525-00…" vs „525000…")
 * wybierz sensowny wpis: nie-auto-nazwa, potem starszy rekord.
 */
export function pickContractorIdForNormalizedNip(
  rows: ContractorNipMatchRow[],
  nip10: string,
): string | null {
  if (!/^\d{10}$/.test(nip10)) return null;
  const matches = rows.filter((r) => polishNipDigits10(r.nip) === nip10);
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0]!.id;
  const generic = (r: ContractorNipMatchRow) => AUTO_CONTRACTOR_NAME.test(r.name.trim());
  matches.sort((a, b) => {
    const ga = generic(a);
    const gb = generic(b);
    if (ga !== gb) return ga ? 1 : -1;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });
  return matches[0]!.id;
}

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
    select: { id: true, nip: true, name: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  const id = pickContractorIdForNormalizedNip(rows, nip10);
  return id ? { id } : null;
}
