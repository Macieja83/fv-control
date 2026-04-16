import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  deleteInvoiceRequest,
  fetchInvoicesListAllPages,
  patchInvoice,
  patchInvoiceStatus,
  postAdoptInvoiceVendor,
  postCreateInvoice,
  postRehydrateKsefInvoice,
  postRetryInvoiceExtraction,
  postSendInvoiceToKsef,
} from '../api/invoicesApi'
import type { InvoiceFilters, InvoiceRecord } from '../types/invoice'
import { EMPTY_FILTERS } from '../types/invoice'
import { seedInvoices } from '../data/mockInvoices'
import { enrichDuplicateMetadata, isDuplicateFlagged } from '../lib/duplicates'
import { matchesInvoiceFilters } from '../lib/matchesInvoiceFilters'
import { ALL_REPORT_CATEGORIES } from '../data/categories'
import { mapApiInvoiceRowToRecord } from '../lib/mapApiInvoice'
import { clearStoredToken, getStoredToken } from '../auth/session'

const USE_MOCK_INVOICES =
  import.meta.env.VITE_USE_MOCK_INVOICES === 'true' ||
  import.meta.env.VITE_USE_MOCK_INVOICES === '1'

function nowIso() {
  return new Date().toISOString()
}

function handleExpiredSession(msg: string): boolean {
  if (!msg.toLowerCase().includes('sesja wygasła')) return false
  clearStoredToken()
  if (window.location.pathname !== '/login') {
    window.history.pushState(null, '', '/login')
    window.dispatchEvent(new PopStateEvent('popstate'))
  }
  return true
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

export type QuickFilter =
  | null
  | 'all'
  | 'unpaid'
  | 'paid'
  | 'dups'
  | 'review'
  | 'noCat'
  | 'unknownVendor'

export type InvoiceDataSource = 'mock' | 'api'

export function useInvoiceDashboard() {
  const [invoices, setInvoices] = useState<InvoiceRecord[]>(() =>
    USE_MOCK_INVOICES ? enrichDuplicateMetadata(seedInvoices()) : [],
  )
  const [listLoading, setListLoading] = useState(() => !USE_MOCK_INVOICES)
  const [listError, setListError] = useState<string | null>(null)
  const [filters, setFilters] = useState<InvoiceFilters>(EMPTY_FILTERS)
  const [quickFilter, setQuickFilter] = useState<QuickFilter>(null)
  const [invoiceLedger, setInvoiceLedger] = useState<'purchase' | 'sale'>('purchase')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const [dataSource, setDataSource] = useState<InvoiceDataSource>(
    USE_MOCK_INVOICES ? 'mock' : 'api',
  )

  const refreshFromApi = useCallback(async () => {
    const token = getStoredToken()
    if (!token) {
      if (USE_MOCK_INVOICES) {
        setListError(null)
        setInvoices(enrichDuplicateMetadata(seedInvoices()))
        setDataSource('mock')
      } else {
        setListError('Brak sesji.')
        setInvoices([])
      }
      setListLoading(false)
      return
    }
    setListLoading(true)
    setListError(null)
    try {
      const df = filters.dateFrom.trim()
      const dt = filters.dateTo.trim()
      const res = await fetchInvoicesListAllPages(token, {
        limit: 100,
        ledgerKind: invoiceLedger === 'sale' ? 'SALE' : 'PURCHASE',
        ...(df ? { dateFrom: df } : {}),
        ...(dt ? { dateTo: dt } : {}),
      })
      const mapped = res.data.map(mapApiInvoiceRowToRecord)
      setInvoices(enrichDuplicateMetadata(mapped))
      setDataSource('api')
    } catch (e) {
      if (USE_MOCK_INVOICES) {
        setListError(null)
        setInvoices(enrichDuplicateMetadata(seedInvoices()))
        setDataSource('mock')
      } else {
        const msg =
          e instanceof Error && e.message.trim()
            ? e.message.trim()
            : 'Nie udało się pobrać faktur z API.'
        if (handleExpiredSession(msg)) return
        setListError(msg)
        setInvoices([])
      }
    } finally {
      setListLoading(false)
    }
  }, [invoiceLedger, filters.dateFrom, filters.dateTo])

  useEffect(() => {
    void refreshFromApi()
  }, [refreshFromApi])

  useEffect(() => {
    setSelectedId(null)
  }, [invoiceLedger])

  /** Dopóki któraś faktura jest w INGESTING, odświeżaj listę (worker kończy OCR w tle). Uwzględnij też zaznaczoną fakturę (np. po filtrze dat). */
  useEffect(() => {
    if (USE_MOCK_INVOICES) return
    const selectedRow = selectedId ? invoices.find((r) => r.id === selectedId) : undefined
    const ingesting =
      invoices.some((r) => r.invoice_status === 'INGESTING') ||
      selectedRow?.invoice_status === 'INGESTING'
    if (!ingesting) return
    const id = window.setInterval(() => void refreshFromApi(), 4000)
    return () => window.clearInterval(id)
  }, [invoices, selectedId, refreshFromApi])

  const ledgerScoped = useMemo(() => {
    if (USE_MOCK_INVOICES) {
      if (invoiceLedger === 'sale') return invoices.filter((r) => r.ledger_kind === 'sale')
      return invoices.filter((r) => r.ledger_kind !== 'sale')
    }
    return invoices
  }, [invoices, invoiceLedger])

  const filtered = useMemo(() => {
    let list = ledgerScoped.filter((r) => matchesInvoiceFilters(r, filters))
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
    } else if (quickFilter === 'unknownVendor') {
      list = list.filter((r) => r.needs_contractor_verification === true)
    }
    return list
  }, [ledgerScoped, filters, quickFilter])

  /** Wskaźniki jak lista: ten sam zestaw co po filtrach paska (m.in. zakres dat Od–Do), bez szybkiego filtra z kafelków. */
  const kpi = useMemo(() => {
    const base = ledgerScoped.filter((r) => matchesInvoiceFilters(r, filters))
    const all = base.length
    const unpaidBiz = base.filter(
      (r) => r.payment_status === 'unpaid' && r.document_scope === 'business',
    ).length
    const paid = base.filter((r) => r.payment_status === 'paid').length
    const dups = base.filter((r) => isDuplicateFlagged(r)).length
    const review = base.filter((r) => r.review_status === 'needs_review').length
    const noCat = base.filter((r) => !r.category).length
    const unknownVendor = base.filter((r) => r.needs_contractor_verification === true).length
    return { all, unpaidBiz, paid, dups, review, noCat, unknownVendor }
  }, [ledgerScoped, filters])

  const suppliers = useMemo(
    () => [...new Set(ledgerScoped.map((r) => r.supplier_name))].sort(),
    [ledgerScoped],
  )
  const restaurants = useMemo(
    () => [...new Set(ledgerScoped.map((r) => r.restaurant_name))].sort(),
    [ledgerScoped],
  )

  const selected = useMemo(
    () => ledgerScoped.find((r) => r.id === selectedId) ?? null,
    [ledgerScoped, selectedId],
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
    async (id: string, category: string | null) => {
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
      const token = getStoredToken()
      if (!token) return
      try {
        await patchInvoice(token, id, { reportCategory: category })
        await refreshFromApi()
      } catch (e) {
        window.alert(e instanceof Error ? e.message : String(e))
        await refreshFromApi()
      }
    },
    [updateRow, refreshFromApi],
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

  const bulkMarkPaid = useCallback(
    async (ids: string[]): Promise<boolean> => {
      const uniq = [...new Set(ids)]
      if (uniq.length === 0) return true
      if (USE_MOCK_INVOICES) {
        for (const id of uniq) {
          updateRow(id, (r) =>
            pushHistory(
              { ...r, payment_status: 'paid', review_status: 'cleared' },
              'operator',
              'Zbiorczo: zapłacona',
            ),
          )
        }
        return true
      }
      const token = getStoredToken()
      if (!token) return false
      try {
        for (const id of uniq) {
          await patchInvoiceStatus(token, id, 'PAID')
        }
        await refreshFromApi()
        return true
      } catch (e) {
        window.alert(e instanceof Error ? e.message : String(e))
        await refreshFromApi()
        return false
      }
    },
    [updateRow, refreshFromApi],
  )

  const bulkMarkUnpaid = useCallback(
    async (ids: string[]): Promise<boolean> => {
      const uniq = [...new Set(ids)]
      if (uniq.length === 0) return true
      if (USE_MOCK_INVOICES) {
        for (const id of uniq) {
          updateRow(id, (r) =>
            pushHistory({ ...r, payment_status: 'unpaid' }, 'operator', 'Zbiorczo: niezapłacona'),
          )
        }
        return true
      }
      const token = getStoredToken()
      if (!token) return false
      try {
        for (const id of uniq) {
          await patchInvoiceStatus(token, id, 'RECEIVED')
        }
        await refreshFromApi()
        return true
      } catch (e) {
        window.alert(e instanceof Error ? e.message : String(e))
        await refreshFromApi()
        return false
      }
    },
    [updateRow, refreshFromApi],
  )

  const bulkMarkNeedsReview = useCallback(
    async (ids: string[]): Promise<boolean> => {
      const uniq = [...new Set(ids)]
      if (uniq.length === 0) return true
      if (USE_MOCK_INVOICES) {
        for (const id of uniq) {
          updateRow(id, (r) =>
            pushHistory(
              { ...r, review_status: 'needs_review' },
              'operator',
              'Zbiorczo: do sprawdzenia',
            ),
          )
        }
        return true
      }
      const token = getStoredToken()
      if (!token) return false
      try {
        for (const id of uniq) {
          await patchInvoice(token, id, { reviewStatus: 'NEEDS_REVIEW' })
        }
        await refreshFromApi()
        return true
      } catch (e) {
        window.alert(e instanceof Error ? e.message : String(e))
        await refreshFromApi()
        return false
      }
    },
    [updateRow, refreshFromApi],
  )

  const bulkMarkReviewOk = useCallback(
    async (ids: string[]): Promise<boolean> => {
      const uniq = [...new Set(ids)]
      if (uniq.length === 0) return true
      if (USE_MOCK_INVOICES) {
        for (const id of uniq) {
          updateRow(id, (r) =>
            pushHistory(
              { ...r, review_status: 'cleared' },
              'operator',
              'Zbiorczo: przegląd OK',
            ),
          )
        }
        return true
      }
      const token = getStoredToken()
      if (!token) return false
      try {
        for (const id of uniq) {
          await patchInvoice(token, id, { reviewStatus: 'NEW' })
        }
        await refreshFromApi()
        return true
      } catch (e) {
        window.alert(e instanceof Error ? e.message : String(e))
        await refreshFromApi()
        return false
      }
    },
    [updateRow, refreshFromApi],
  )

  const bulkDeleteInvoices = useCallback(
    async (ids: string[]): Promise<boolean> => {
      const uniq = [...new Set(ids)]
      if (uniq.length === 0) return true
      if (USE_MOCK_INVOICES) {
        const idSet = new Set(uniq)
        setInvoices((prev) => enrichDuplicateMetadata(prev.filter((r) => !idSet.has(r.id))))
        setSelectedId((cur) => (cur && idSet.has(cur) ? null : cur))
        return true
      }
      const token = getStoredToken()
      if (!token) return false
      const idSet = new Set(uniq)
      try {
        for (const id of uniq) {
          await deleteInvoiceRequest(token, id)
        }
        setSelectedId((cur) => (cur && idSet.has(cur) ? null : cur))
        await refreshFromApi()
        return true
      } catch (e) {
        window.alert(e instanceof Error ? e.message : String(e))
        await refreshFromApi()
        return false
      }
    },
    [refreshFromApi],
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

  const adoptInvoiceVendor = useCallback(
    async (id: string, body?: { nip?: string; name?: string }) => {
      if (USE_MOCK_INVOICES) {
        window.alert('W trybie demo nie ma zapisu kontrahenta przez API.')
        return
      }
      const token = getStoredToken()
      if (!token) return
      try {
        await postAdoptInvoiceVendor(token, id, body)
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

  /** Ponowne pobranie FA XML z MF, zapis w storage i kolejka pipeline (jedna akcja „synchronizuj KSeF”). */
  const syncKsefInvoiceFromApi = useCallback(
    async (id: string) => {
      if (USE_MOCK_INVOICES) {
        window.alert('W trybie demo synchronizacja KSeF jest wyłączona.')
        return
      }
      const token = getStoredToken()
      if (!token) return
      try {
        await postRehydrateKsefInvoice(token, id)
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

  const pickKpi = useCallback(
    (key: 'all' | 'unpaid' | 'paid' | 'dups' | 'review' | 'noCat' | 'unknownVendor') => {
      setQuickFilter(key === 'all' ? null : key)
    },
    [],
  )

  const followerDuplicateCount = useMemo(
    () => invoices.filter((r) => r.duplicate_of_id !== null).length,
    [invoices],
  )

  const sendInvoiceToKsef = useCallback(
    async (id: string) => {
      if (USE_MOCK_INVOICES) {
        window.alert('Tryb mock: wysyłka do KSeF jest wyłączona.')
        return
      }
      const token = getStoredToken()
      if (!token) return
      try {
        await postSendInvoiceToKsef(token, id)
        await refreshFromApi()
      } catch (e) {
        window.alert(e instanceof Error ? e.message : String(e))
      }
    },
    [refreshFromApi],
  )

  const createSalesInvoice = useCallback(
    async (body: Record<string, unknown>, opts?: { sendToKsef?: boolean }) => {
      const token = getStoredToken()
      if (!token) throw new Error('Brak sesji.')
      const created = await postCreateInvoice(token, body)
      if (opts?.sendToKsef) {
        try {
          await postSendInvoiceToKsef(token, created.id)
        } catch (e) {
          const m = e instanceof Error ? e.message : String(e)
          window.alert(
            `Faktura została zapisana, ale wysyłka do KSeF się nie powiodła:\n\n${m}\n\nMożesz ponowić wysyłkę z panelu szczegółów faktury (przycisk „Wyślij do KSeF”).`,
          )
        }
      }
      await refreshFromApi()
    },
    [refreshFromApi],
  )

  return {
    invoices,
    filtered,
    filters,
    setFilters,
    quickFilter,
    invoiceLedger,
    setInvoiceLedger,
    pickKpi,
    selectedId,
    setSelectedId,
    selected,
    kpi,
    suppliers,
    restaurants,
    categories: ALL_REPORT_CATEGORIES,
    setPaid,
    setUnpaid,
    setCategory,
    setScope,
    setNeedsReview,
    clearReview,
    bulkMarkPaid,
    bulkMarkUnpaid,
    bulkMarkNeedsReview,
    bulkMarkReviewOk,
    bulkDeleteInvoices,
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
    /** true = kategoria tylko lokalnie (tryb demo); w API zapisuje się jako reportCategory */
    categoryLocalOnly: USE_MOCK_INVOICES,
    refreshFromApi,
    retryInvoiceExtraction,
    syncKsefInvoiceFromApi,
    adoptInvoiceVendor,
    sendInvoiceToKsef,
    createSalesInvoice,
  }
}
