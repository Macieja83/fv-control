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

  for (const r of rows) {
    if (r.ksef_number) {
      const k = r.ksef_number.trim().toUpperCase()
      if (!byKsef.has(k)) byKsef.set(k, [])
      byKsef.get(k)!.push(r)
    }
    const tripleKey = `${r.supplier_nip.replace(/\s/g, '')}|${r.invoice_number.trim().toUpperCase()}|${r.gross_amount.toFixed(2)}`
    if (!byTriple.has(tripleKey)) byTriple.set(tripleKey, [])
    byTriple.get(tripleKey)!.push(r)
  }

  return rows.map((r) => {
    let duplicate_score = 0
    let duplicate_of_id: string | null = null
    let duplicate_reason: string | null = null

    if (r.ksef_number) {
      const group = byKsef.get(r.ksef_number.trim().toUpperCase()) ?? []
      if (group.length > 1) {
        const first = group[0]
        duplicate_score = 1
        duplicate_reason = `Ten sam numer KSeF (${r.ksef_number}) co inny rekord w inboxie.`
        if (first.id !== r.id) duplicate_of_id = first.id
      }
    }

    if (duplicate_score < 1) {
      const tripleKey = `${r.supplier_nip.replace(/\s/g, '')}|${r.invoice_number.trim().toUpperCase()}|${r.gross_amount.toFixed(2)}`
      const group = byTriple.get(tripleKey) ?? []
      if (group.length > 1) {
        const sorted = [...group].sort(
          (a, b) =>
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
        )
        const first = sorted[0]
        duplicate_score = Math.max(duplicate_score, 0.85)
        duplicate_reason = `Powtarzający się zestaw: NIP + numer faktury + kwota brutto (${group.length} wpisów).`
        if (first.id !== r.id) duplicate_of_id = first.id
      }
    }

    if (r.duplicate_resolution === 'rejected') {
      duplicate_score = 0
      duplicate_of_id = null
      duplicate_reason = null
    }

    return {
      ...r,
      duplicate_score,
      duplicate_of_id:
        r.duplicate_resolution === 'rejected' ? null : duplicate_of_id,
      duplicate_reason:
        r.duplicate_resolution === 'rejected' ? null : duplicate_reason,
    }
  })
}

export function isDuplicateFlagged(r: InvoiceRecord): boolean {
  if (r.duplicate_resolution === 'confirmed') return true
  if (r.duplicate_resolution === 'rejected') return false
  return r.duplicate_score >= 0.85
}
