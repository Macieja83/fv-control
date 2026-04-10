import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  deleteInvoiceRequest,
  fetchInvoicesList,
  patchInvoice,
  patchInvoiceStatus,
  postRetryInvoiceExtraction,
} from '../api/invoicesApi'
import type { InvoiceFilters, InvoiceRecord } from '../types/invoice'
import { EMPTY_FILTERS } from '../types/invoice'
import { seedInvoices } from '../data/mockInvoices'
import { enrichDuplicateMetadata, isDuplicateFlagged } from '../lib/duplicates'
import { COST_CATEGORIES } from '../data/categories'
import { mapApiInvoiceRowToRecord } from '../lib/mapApiInvoice'
import { getStoredToken } from '../auth/session'

const USE_MOCK_INVOICES =
  import.meta.env.VITE_USE_MOCK_INVOICES === 'true' ||
  import.meta.env.VITE_USE_MOCK_INVOICES === '1'

/** W trybie API kategoria nie ma pola w backendzie — trzymamy wybór lokalnie i scalamy po każdym fetchu. */
function mergeCategoryOverrides(
  rows: InvoiceRecord[],
  overrides: Record<string, string | null>,
): InvoiceRecord[] {
  return rows.map((r) =>
    Object.prototype.hasOwnProperty.call(overrides, r.id)
      ? { ...r, category: overrides[r.id] ?? null }
      : r,
  )
}

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
      row.primary_document_id ?? '',
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

export type InvoiceDataSource = 'mock' | 'api'

export function useInvoiceDashboard() {
  const [invoices, setInvoices] = useState<InvoiceRecord[]>(() =>
    USE_MOCK_INVOICES ? enrichDuplicateMetadata(seedInvoices()) : [],
  )
  const [listLoading, setListLoading] = useState(() => !USE_MOCK_INVOICES)
  const [listError, setListError] = useState<string | null>(null)
  const [filters, setFilters] = useState<InvoiceFilters>(EMPTY_FILTERS)
  const [quickFilter, setQuickFilter] = useState<QuickFilter>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const categoryOverridesRef = useRef<Record<string, string | null>>({})

  /** Lista przy aktywnej sesji i tak jest z API (nawet przy VITE_USE_MOCK_INVOICES=1) — wtedy traktujemy UI jak API (OCR, usuwanie z bazy). */
  const dataSource: InvoiceDataSource =
    USE_MOCK_INVOICES && !getStoredToken() ? 'mock' : 'api'

  const refreshFromApi = useCallback(async () => {
    const token = getStoredToken()
    if (!token) {
      if (USE_MOCK_INVOICES) {
        setListError(null)
        setInvoices(enrichDuplicateMetadata(seedInvoices()))
      } else {
        setListError('Brak sesji.')
        setInvoices([])
      }
      setListLoading(false)
      return
    }
    // Z sesją zawsze pobierz z API — nawet gdy VITE_USE_MOCK_INVOICES=1 (inaczej upload trafia na backend, a lista zostaje na mocku).
    setListLoading(true)
    setListError(null)
    try {
      const res = await fetchInvoicesList(token, { limit: 100 })
      const mapped = res.data.map(mapApiInvoiceRowToRecord)
      const merged = mergeCategoryOverrides(mapped, categoryOverridesRef.current)
      setInvoices(enrichDuplicateMetadata(merged))
    } catch (e) {
      setListError(e instanceof Error ? e.message : 'Błąd ładowania listy')
      setInvoices([])
    } finally {
      setListLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshFromApi()
  }, [refreshFromApi])

  /** Dopóki któraś faktura jest w INGESTING, odświeżaj listę (worker kończy OCR w tle). */
  useEffect(() => {
    if (USE_MOCK_INVOICES) return
    const ingesting = invoices.some((r) => r.invoice_status === 'INGESTING')
    if (!ingesting) return
    const id = window.setInterval(() => void refreshFromApi(), 4000)
    return () => window.clearInterval(id)
  }, [invoices, refreshFromApi])

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
    async (id: string) => {
      if (USE_MOCK_INVOICES) {
        updateRow(id, (r) =>
          pushHistory(
            { ...r, payment_status: 'paid', review_status: 'cleared' },
            'operator',
            'Oznaczono jako zapłacona',
          ),
        )
        return
      }
      const token = getStoredToken()
      if (!token) return
      try {
        await patchInvoiceStatus(token, id, 'PAID')
        await refreshFromApi()
      } catch (e) {
        window.alert(e instanceof Error ? e.message : String(e))
      }
    },
    [updateRow, refreshFromApi],
  )

  const setUnpaid = useCallback(
    async (id: string) => {
      if (USE_MOCK_INVOICES) {
        updateRow(id, (r) =>
          pushHistory({ ...r, payment_status: 'unpaid' }, 'operator', 'Oznaczono jako niezapłacona'),
        )
        return
      }
      const token = getStoredToken()
      if (!token) return
      try {
        await patchInvoiceStatus(token, id, 'RECEIVED')
        await refreshFromApi()
      } catch (e) {
        window.alert(e instanceof Error ? e.message : String(e))
      }
    },
    [updateRow, refreshFromApi],
  )

  const setCategory = useCallback(
    (id: string, category: string | null) => {
      if (USE_MOCK_INVOICES) {
        updateRow(id, (r) =>
          pushHistory(
            { ...r, category },
            'operator',
            'Zmiana kategorii',
            category ?? '(brak)',
          ),
        )
        return
      }
      categoryOverridesRef.current = { ...categoryOverridesRef.current, [id]: category }
      setInvoices((prev) =>
        enrichDuplicateMetadata(
          prev.map((r) => (r.id === id ? { ...r, category } : r)),
        ),
      )
    },
    [updateRow],
  )

  const setScope = useCallback(
    async (id: string, scope: InvoiceRecord['document_scope']) => {
      if (USE_MOCK_INVOICES) {
        updateRow(id, (r) =>
          pushHistory(
            { ...r, document_scope: scope },
            'operator',
            scope === 'private' ? 'Oznaczono jako prywatna' : 'Oznaczono jako firmowa',
          ),
        )
        return
      }
      const token = getStoredToken()
      if (!token) return
      try {
        await patchInvoice(token, id, {
          legalChannel: scope === 'private' ? 'EXCLUDED' : 'OUTSIDE_KSEF',
        })
        await refreshFromApi()
      } catch (e) {
        window.alert(e instanceof Error ? e.message : String(e))
      }
    },
    [updateRow, refreshFromApi],
  )

  const setNeedsReview = useCallback(
    async (id: string) => {
      if (USE_MOCK_INVOICES) {
        updateRow(id, (r) =>
          pushHistory(
            { ...r, review_status: 'needs_review' },
            'operator',
            'Oznaczono: do sprawdzenia',
          ),
        )
        return
      }
      const token = getStoredToken()
      if (!token) return
      try {
        await patchInvoice(token, id, { reviewStatus: 'NEEDS_REVIEW' })
        await refreshFromApi()
      } catch (e) {
        window.alert(e instanceof Error ? e.message : String(e))
      }
    },
    [updateRow, refreshFromApi],
  )

  const clearReview = useCallback(
    async (id: string) => {
      if (USE_MOCK_INVOICES) {
        updateRow(id, (r) =>
          pushHistory({ ...r, review_status: 'cleared' }, 'operator', 'Wyczyszczono status przeglądu'),
        )
        return
      }
      const token = getStoredToken()
      if (!token) return
      try {
        await patchInvoice(token, id, { reviewStatus: 'NEW' })
        await refreshFromApi()
      } catch (e) {
        window.alert(e instanceof Error ? e.message : String(e))
      }
    },
    [updateRow, refreshFromApi],
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
    async (id: string, notes: string) => {
      if (USE_MOCK_INVOICES) {
        updateRow(id, (r) => pushHistory({ ...r, notes }, 'operator', 'Zaktualizowano notatki'))
        return
      }
      const token = getStoredToken()
      if (!token) return
      try {
        await patchInvoice(token, id, { notes })
        await refreshFromApi()
      } catch (e) {
        window.alert(e instanceof Error ? e.message : String(e))
      }
    },
    [updateRow, refreshFromApi],
  )

  const goToLinked = useCallback((targetId: string) => {
    setSelectedId(targetId)
  }, [])

  const deleteInvoice = useCallback(
    async (id: string) => {
      if (USE_MOCK_INVOICES) {
        setInvoices((prev) => {
          const next = prev.filter((r) => r.id !== id)
          return enrichDuplicateMetadata(next)
        })
        setSelectedId((cur) => (cur === id ? null : cur))
        return
      }
      delete categoryOverridesRef.current[id]
      const token = getStoredToken()
      if (!token) return
      try {
        await deleteInvoiceRequest(token, id)
        setSelectedId((cur) => (cur === id ? null : cur))
        await refreshFromApi()
      } catch (e) {
        window.alert(e instanceof Error ? e.message : String(e))
      }
    },
    [refreshFromApi],
  )

  const retryInvoiceExtraction = useCallback(
    async (id: string) => {
      if (USE_MOCK_INVOICES) {
        window.alert('W trybie demo nie ma ponownej ekstrakcji OCR.')
        return
      }
      const token = getStoredToken()
      if (!token) return
      try {
        await postRetryInvoiceExtraction(token, id)
        await refreshFromApi()
      } catch (e) {
        window.alert(e instanceof Error ? e.message : String(e))
      }
    },
    [refreshFromApi],
  )

  const deleteFollowerDuplicates = useCallback(async () => {
    if (USE_MOCK_INVOICES) {
      setSelectedId(null)
      setInvoices((prev) => {
        const next = prev.filter((r) => r.duplicate_of_id === null)
        return enrichDuplicateMetadata(next)
      })
      return
    }
    const token = getStoredToken()
    if (!token) return
    const followers = invoices.filter((r) => r.duplicate_of_id !== null)
    try {
      for (const r of followers) {
        await deleteInvoiceRequest(token, r.id)
      }
      setSelectedId(null)
      await refreshFromApi()
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e))
    }
  }, [invoices, refreshFromApi])

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
    listLoading,
    listError,
    dataSource,
    /** true = kategoria nie trafia do API, tylko pamięć podręczna w tej sesji */
    categoryLocalOnly: !USE_MOCK_INVOICES,
    refreshFromApi,
    retryInvoiceExtraction,
  }
}
