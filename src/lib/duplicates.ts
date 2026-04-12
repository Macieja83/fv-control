import type { InvoiceRecord } from '../types/invoice'

/**
 * Reguły: ten sam numer KSeF = twardy duplikat;
 * ten sam NIP + numer faktury + kwota brutto = mocny kandydat.
 */
export function enrichDuplicateMetadata(
  rows: InvoiceRecord[],
): InvoiceRecord[] {
  const byKsef = new Map<string, InvoiceRecord[]>()
  const byTriple = new Map<string, InvoiceRecord[]>()
  /** Ten sam NIP (10 cyfr) + data wystawienia + brutto — łapie np. KSeF vs e-mail z innym numerem w polu. */
  const byNipDayGross = new Map<string, InvoiceRecord[]>()

  for (const r of rows) {
    if (r.ksef_number) {
      const k = r.ksef_number.trim().toUpperCase()
      if (!byKsef.has(k)) byKsef.set(k, [])
      byKsef.get(k)!.push(r)
    }
    const tripleKey = `${r.supplier_nip.replace(/\s/g, '')}|${r.invoice_number.trim().toUpperCase()}|${r.gross_amount.toFixed(2)}`
    if (!byTriple.has(tripleKey)) byTriple.set(tripleKey, [])
    byTriple.get(tripleKey)!.push(r)
    const nip10 = (r.supplier_nip || r.extracted_vendor_nip || '').replace(/\D/g, '').slice(0, 10)
    if (nip10.length === 10) {
      const dayGross = `${nip10}|${r.issue_date}|${r.gross_amount.toFixed(2)}`
      if (!byNipDayGross.has(dayGross)) byNipDayGross.set(dayGross, [])
      byNipDayGross.get(dayGross)!.push(r)
    }
  }

  const canonicalRank = (x: InvoiceRecord) => {
    if (x.ksef_number?.trim()) return 0
    if (x.source_type === 'ksef') return 1
    return 2
  }

  return rows.map((r) => {
    const fromApiScore = r.duplicate_score ?? 0
    let duplicate_score = fromApiScore
    let duplicate_of_id: string | null = r.duplicate_of_id ?? null
    let duplicate_canonical_number: string | null = r.duplicate_canonical_number ?? null
    let duplicate_reason: string | null = r.duplicate_reason ?? null

    if (r.ksef_number) {
      const group = byKsef.get(r.ksef_number.trim().toUpperCase()) ?? []
      if (group.length > 1) {
        const sorted = [...group].sort((a, b) => {
          const ch = canonicalRank(a) - canonicalRank(b)
          if (ch !== 0) return ch
          return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        })
        const first = sorted[0]!
        /** Tylko „drugi” rekord w parze — oryginał KSeF nie dostaje % duplikatu z heurystyki listy. */
        if (first.id !== r.id) {
          duplicate_score = 1
          duplicate_of_id = first.id
          duplicate_canonical_number = duplicate_canonical_number ?? first.invoice_number
          duplicate_reason = `Ten sam numer KSeF (${r.ksef_number}) co inny rekord na liście faktur.`
        }
      }
    }

    if (duplicate_score < 1) {
      const tripleKey = `${r.supplier_nip.replace(/\s/g, '')}|${r.invoice_number.trim().toUpperCase()}|${r.gross_amount.toFixed(2)}`
      const group = byTriple.get(tripleKey) ?? []
      if (group.length > 1) {
        const sorted = [...group].sort((a, b) => {
          const ch = canonicalRank(a) - canonicalRank(b)
          if (ch !== 0) return ch
          return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        })
        const first = sorted[0]!
        if (first.id !== r.id) {
          duplicate_score = Math.max(duplicate_score, 0.85)
          duplicate_of_id = duplicate_of_id ?? first.id
          duplicate_canonical_number = duplicate_canonical_number ?? first.invoice_number
          duplicate_reason =
            duplicate_reason ??
            (duplicate_canonical_number
              ? `Duplikat faktury nr „${duplicate_canonical_number}” (NIP + numer + kwota brutto).`
              : `Powtarzający się zestaw: NIP + numer faktury + kwota brutto (${group.length} wpisów).`)
        }
      }
    }

    if (duplicate_score < 0.72) {
      const nip10 = (r.supplier_nip || r.extracted_vendor_nip || '').replace(/\D/g, '').slice(0, 10)
      if (nip10.length === 10) {
        const dayGross = `${nip10}|${r.issue_date}|${r.gross_amount.toFixed(2)}`
        const group = byNipDayGross.get(dayGross) ?? []
        if (group.length > 1) {
          const sorted = [...group].sort((a, b) => {
            const ch = canonicalRank(a) - canonicalRank(b)
            if (ch !== 0) return ch
            return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          })
          const first = sorted[0]!
          if (first.id !== r.id) {
            duplicate_score = Math.max(duplicate_score, 0.76)
            duplicate_of_id = duplicate_of_id ?? first.id
            duplicate_canonical_number = duplicate_canonical_number ?? first.invoice_number
            duplicate_reason =
              duplicate_reason ??
              (duplicate_canonical_number
                ? `Podejrzenie duplikatu względem „${duplicate_canonical_number}” (ten sam NIP, data i kwota brutto).`
                : `Ten sam NIP, data wystawienia i kwota brutto (${group.length} wpisy).`)
          }
        }
      }
    }

    /** Faktura z KSeF bez powiązania „jestem duplikatem” — nie pokazujemy % z heurystyki ani starego zapisu w API. */
    const isKsefLike = Boolean(r.ksef_number?.trim()) || r.source_type === 'ksef'
    if (isKsefLike && duplicate_of_id == null && duplicate_score >= 0.72) {
      if (fromApiScore < 0.72) {
        duplicate_score = fromApiScore
      } else {
        duplicate_score = 0
        duplicate_reason = null
      }
    }

    if (r.duplicate_resolution === 'rejected') {
      duplicate_score = 0
      duplicate_of_id = null
      duplicate_canonical_number = null
      duplicate_reason = null
    }

    return {
      ...r,
      duplicate_score,
      duplicate_of_id:
        r.duplicate_resolution === 'rejected' ? null : duplicate_of_id,
      duplicate_canonical_number:
        r.duplicate_resolution === 'rejected' ? null : duplicate_canonical_number,
      duplicate_reason:
        r.duplicate_resolution === 'rejected' ? null : duplicate_reason,
    }
  })
}

/** Zgodnie z progiem tworzenia `invoice_duplicates` w pipeline (≥ 0.72). */
export function isDuplicateFlagged(r: InvoiceRecord): boolean {
  if (r.duplicate_resolution === 'confirmed') return true
  if (r.duplicate_resolution === 'rejected') return false
  return r.duplicate_score >= 0.72
}
