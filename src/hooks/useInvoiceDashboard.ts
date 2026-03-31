import { useCallback, useMemo, useState } from 'react'
import type { InvoiceFilters, InvoiceRecord } from '../types/invoice'
import { EMPTY_FILTERS } from '../types/invoice'
import { seedInvoices } from '../data/mockInvoices'
import { enrichDuplicateMetadata, isDuplicateFlagged } from '../lib/duplicates'
import { COST_CATEGORIES } from '../data/categories'

function nowIso() {
  return new Date().toISOString()
}

function pushHistory(
  row: InvoiceRecord,
  actor: string,
  action: string,
  detail?: string,
): InvoiceRecord {
  return {
    ...row,
    updated_at: nowIso(),
    history: [
      {
        id: crypto.randomUUID(),
        at: nowIso(),
        actor,
        action,
        detail,
      },
      ...row.history,
    ],
  }
}

function matchesFilters(row: InvoiceRecord, f: InvoiceFilters): boolean {
  if (f.search.trim()) {
    const q = f.search.toLowerCase()
    const blob = [
      row.supplier_name,
      row.invoice_number,
      row.supplier_nip,
      row.ksef_number ?? '',
      row.notes,
    ]
      .join(' ')
      .toLowerCase()
    if (!blob.includes(q)) return false
  }
  if (f.dateFrom && row.issue_date < f.dateFrom) return false
  if (f.dateTo && row.issue_date > f.dateTo) return false
  if (f.supplier && row.supplier_name !== f.supplier) return false
  if (f.restaurant && row.restaurant_name !== f.restaurant) return false
  if (f.reviewStatus && row.review_status !== f.reviewStatus) return false
  if (f.category) {
    if (f.category === '__none__') {
      if (row.category) return false
    } else if (row.category !== f.category) return false
  }
  if (f.payment && row.payment_status !== f.payment) return false
  if (f.scope && row.document_scope !== f.scope) return false
  if (f.source) {
    if (f.source === 'discord_ready') {
      if (row.source_type !== 'discord') return false
    } else if (row.source_type !== f.source) return false
  }
  return true
}

export type QuickFilter =
  | null
  | 'all'
  | 'unpaid'
  | 'paid'
  | 'dups'
  | 'review'
  | 'noCat'

export function useInvoiceDashboard() {
  const [invoices, setInvoices] = useState<InvoiceRecord[]>(() => seedInvoices())
  const [filters, setFilters] = useState<InvoiceFilters>(EMPTY_FILTERS)
  const [quickFilter, setQuickFilter] = useState<QuickFilter>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const filtered = useMemo(() => {
    let list = invoices.filter((r) => matchesFilters(r, filters))
    if (quickFilter === 'unpaid') {
      list = list.filter(
        (r) => r.payment_status === 'unpaid' && r.document_scope === 'business',
      )
    } else if (quickFilter === 'paid') {
      list = list.filter((r) => r.payment_status === 'paid')
    } else if (quickFilter === 'dups') {
      list = list.filter((r) => isDuplicateFlagged(r))
    } else if (quickFilter === 'review') {
      list = list.filter((r) => r.review_status === 'needs_review')
    } else if (quickFilter === 'noCat') {
      list = list.filter((r) => !r.category)
    }
    return list
  }, [invoices, filters, quickFilter])

  const kpi = useMemo(() => {
    const all = invoices.length
    const unpaidBiz = invoices.filter(
      (r) => r.payment_status === 'unpaid' && r.document_scope === 'business',
    ).length
    const paid = invoices.filter((r) => r.payment_status === 'paid').length
    const dups = invoices.filter((r) => isDuplicateFlagged(r)).length
    const review = invoices.filter((r) => r.review_status === 'needs_review').length
    const noCat = invoices.filter((r) => !r.category).length
    return { all, unpaidBiz, paid, dups, review, noCat }
  }, [invoices])

  const suppliers = useMemo(
    () => [...new Set(invoices.map((r) => r.supplier_name))].sort(),
    [invoices],
  )
  const restaurants = useMemo(
    () => [...new Set(invoices.map((r) => r.restaurant_name))].sort(),
    [invoices],
  )

  const selected = useMemo(
    () => invoices.find((r) => r.id === selectedId) ?? null,
    [invoices, selectedId],
  )

  const updateRow = useCallback((id: string, fn: (r: InvoiceRecord) => InvoiceRecord) => {
    setInvoices((prev) => {
      const next = prev.map((r) => (r.id === id ? fn(r) : r))
      return enrichDuplicateMetadata(next)
    })
  }, [])

  const setPaid = useCallback(
    (id: string) => {
      updateRow(id, (r) =>
        pushHistory(
          { ...r, payment_status: 'paid', review_status: 'cleared' },
          'operator',
          'Oznaczono jako zapłacona',
        ),
      )
    },
    [updateRow],
  )

  const setUnpaid = useCallback(
    (id: string) => {
      updateRow(id, (r) =>
        pushHistory({ ...r, payment_status: 'unpaid' }, 'operator', 'Oznaczono jako niezapłacona'),
      )
    },
    [updateRow],
  )

  const setCategory = useCallback(
    (id: string, category: string | null) => {
      updateRow(id, (r) =>
        pushHistory(
          { ...r, category },
          'operator',
          'Zmiana kategorii',
          category ?? '(brak)',
        ),
      )
    },
    [updateRow],
  )

  const setScope = useCallback(
    (id: string, scope: InvoiceRecord['document_scope']) => {
      updateRow(id, (r) =>
        pushHistory(
          { ...r, document_scope: scope },
          'operator',
          scope === 'private' ? 'Oznaczono jako prywatna' : 'Oznaczono jako firmowa',
        ),
      )
    },
    [updateRow],
  )

  const setNeedsReview = useCallback(
    (id: string) => {
      updateRow(id, (r) =>
        pushHistory(
          { ...r, review_status: 'needs_review' },
          'operator',
          'Oznaczono: do sprawdzenia',
        ),
      )
    },
    [updateRow],
  )

  const clearReview = useCallback(
    (id: string) => {
      updateRow(id, (r) =>
        pushHistory({ ...r, review_status: 'cleared' }, 'operator', 'Wyczyszczono status przeglądu'),
      )
    },
    [updateRow],
  )

  const confirmDuplicate = useCallback(
    (id: string) => {
      updateRow(id, (r) =>
        pushHistory(
          {
            ...r,
            duplicate_resolution: 'confirmed',
            review_status: 'needs_review',
          },
          'operator',
          'Potwierdzono duplikat',
          r.duplicate_reason ?? undefined,
        ),
      )
    },
    [updateRow],
  )

  const rejectDuplicate = useCallback(
    (id: string) => {
      updateRow(id, (r) =>
        pushHistory(
          {
            ...r,
            duplicate_resolution: 'rejected',
            duplicate_score: 0,
            duplicate_of_id: null,
            duplicate_reason: null,
          },
          'operator',
          'Odrzucono sugestię duplikatu',
        ),
      )
    },
    [updateRow],
  )

  const setNotes = useCallback(
    (id: string, notes: string) => {
      updateRow(id, (r) => pushHistory({ ...r, notes }, 'operator', 'Zaktualizowano notatki'))
    },
    [updateRow],
  )

  const goToLinked = useCallback(
    (targetId: string) => {
      setSelectedId(targetId)
    },
    [],
  )

  const deleteInvoice = useCallback((id: string) => {
    setInvoices((prev) => {
      const next = prev.filter((r) => r.id !== id)
      return enrichDuplicateMetadata(next)
    })
    setSelectedId((cur) => (cur === id ? null : cur))
  }, [])

  /** Usuwa wpisy wskazane jako „drugie” w parze duplikatu (`duplicate_of_id` ustawione). Oryginały zostają. */
  const deleteFollowerDuplicates = useCallback(() => {
    setSelectedId(null)
    setInvoices((prev) => {
      const next = prev.filter((r) => r.duplicate_of_id === null)
      return enrichDuplicateMetadata(next)
    })
  }, [])

  const pickKpi = useCallback((key: 'all' | 'unpaid' | 'paid' | 'dups' | 'review' | 'noCat') => {
    setQuickFilter(key === 'all' ? null : key)
  }, [])

  const followerDuplicateCount = useMemo(
    () => invoices.filter((r) => r.duplicate_of_id !== null).length,
    [invoices],
  )

  return {
    invoices,
    filtered,
    filters,
    setFilters,
    quickFilter,
    pickKpi,
    selectedId,
    setSelectedId,
    selected,
    kpi,
    suppliers,
    restaurants,
    categories: [...COST_CATEGORIES],
    setPaid,
    setUnpaid,
    setCategory,
    setScope,
    setNeedsReview,
    clearReview,
    confirmDuplicate,
    rejectDuplicate,
    setNotes,
    goToLinked,
    deleteInvoice,
    deleteFollowerDuplicates,
    followerDuplicateCount,
  }
}
