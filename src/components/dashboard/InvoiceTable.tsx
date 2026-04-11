import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { InvoiceRecord } from '../../types/invoice'
import { downloadInvoicePackage } from '../../lib/exportInvoicePackage'
import {
  DuplicateBadge,
  PaymentBadge,
  ReviewBadge,
  ScopeBadge,
  SourceBadge,
  UnknownVendorBadge,
} from './Badges'

function formatMoney(amount: number, currency: InvoiceRecord['currency']) {
  return new Intl.NumberFormat('pl-PL', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(amount)
}

type Props = {
  rows: InvoiceRecord[]
  selectedId: string | null
  onSelect: (id: string) => void
  onDelete: (id: string) => void
  followerDuplicateCount: number
  onDeleteFollowerDuplicates: () => void
  loading?: boolean
  dataSource?: 'mock' | 'api'
  onBulkMarkPaid: (ids: string[]) => Promise<boolean>
  onBulkMarkUnpaid: (ids: string[]) => Promise<boolean>
  onBulkMarkNeedsReview: (ids: string[]) => Promise<boolean>
  onBulkMarkReviewOk: (ids: string[]) => Promise<boolean>
  onBulkDelete: (ids: string[]) => Promise<boolean>
}

export function InvoiceTable({
  rows,
  selectedId,
  onSelect,
  onDelete,
  followerDuplicateCount,
  onDeleteFollowerDuplicates,
  loading = false,
  dataSource = 'mock',
  onBulkMarkPaid,
  onBulkMarkUnpaid,
  onBulkMarkNeedsReview,
  onBulkMarkReviewOk,
  onBulkDelete,
}: Props) {
  const [packaging, setPackaging] = useState(false)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const headerCheckRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const allowed = new Set(rows.map((r) => r.id))
    setSelectedIds((prev) => {
      const next = new Set([...prev].filter((id) => allowed.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [rows])

  const selectedIdList = useMemo(() => [...selectedIds], [selectedIds])
  const visibleSelectedCount = useMemo(
    () => rows.filter((r) => selectedIds.has(r.id)).length,
    [rows, selectedIds],
  )
  const allVisibleSelected = rows.length > 0 && visibleSelectedCount === rows.length
  const someVisibleSelected = visibleSelectedCount > 0 && !allVisibleSelected

  useLayoutEffect(() => {
    const el = headerCheckRef.current
    if (!el) return
    el.indeterminate = someVisibleSelected
    el.checked = allVisibleSelected
  }, [allVisibleSelected, someVisibleSelected, rows.length])

  const grossByCurrency = useMemo(() => {
    const m = new Map<InvoiceRecord['currency'], number>()
    for (const r of rows) {
      if (!selectedIds.has(r.id)) continue
      m.set(r.currency, (m.get(r.currency) ?? 0) + r.gross_amount)
    }
    return m
  }, [rows, selectedIds])

  const grossSummary =
    grossByCurrency.size === 0
      ? null
      : [...grossByCurrency.entries()]
          .map(([c, v]) => formatMoney(v, c))
          .join(' · ')

  const toggleRow = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAllVisible = () => {
    if (allVisibleSelected) {
      setSelectedIds(new Set())
      return
    }
    setSelectedIds(new Set(rows.map((r) => r.id)))
  }

  const runBulk = async (fn: (ids: string[]) => Promise<boolean>) => {
    const ids = selectedIdList
    if (ids.length === 0) return
    setBulkBusy(true)
    try {
      const ok = await fn(ids)
      if (ok) setSelectedIds(new Set())
    } finally {
      setBulkBusy(false)
    }
  }

  const handleDelete = (id: string, label: string) => {
    const irreversible =
      dataSource === 'api'
        ? 'Tej operacji nie cofniesz — faktura zostanie usunięta z bazy.'
        : 'Tej operacji nie cofniesz w MVP (mock).'
    if (!window.confirm(`Usunąć fakturę z listy?\n\n${label}\n\n${irreversible}`)) {
      return
    }
    onDelete(id)
  }

  const handleBulkDelete = () => {
    const n = selectedIdList.length
    if (n === 0) return
    const irreversible =
      dataSource === 'api'
        ? 'Tej operacji nie cofniesz — faktury zostaną usunięte z bazy.'
        : 'Tej operacji nie cofniesz w MVP (mock).'
    if (
      !window.confirm(
        `Usunąć z listy ${n} ${n === 1 ? 'zaznaczony rekord' : 'zaznaczonych rekordów'}?\n\n${irreversible}`,
      )
    ) {
      return
    }
    void runBulk(onBulkDelete)
  }

  const handlePurgeDuplicates = () => {
    if (followerDuplicateCount === 0) return
    if (
      !window.confirm(
        `Usunąć ${followerDuplicateCount} wpis(ów) oznaczonych jako duplikat względem pierwotnego rekordu?\nPozostaną tylko „oryginały” (bez powiązania duplicate_of).`,
      )
    ) {
      return
    }
    onDeleteFollowerDuplicates()
  }

  return (
    <div className="table-block">
      <div className="table-toolbar">
        <span className="table-toolbar__meta">
          {rows.length} {rows.length === 1 ? 'rekord' : 'rekordów'}
          {followerDuplicateCount > 0 && (
            <span className="table-toolbar__dup-hint">
              {' '}
              · {followerDuplicateCount} do usunięcia jako duplikat
            </span>
          )}
        </span>
        <div className="table-toolbar__actions">
          <button
            type="button"
            className="btn btn--sm btn--primary"
            disabled={rows.length === 0 || packaging}
            title="Pobiera widoczną listę (po filtrach) jako archiwum ZIP (invoices.json + faktury/*.json)."
            onClick={() => {
              void (async () => {
                setPackaging(true)
                try {
                  await downloadInvoicePackage(rows)
                } catch (e) {
                  console.error(e)
                  window.alert(
                    'Nie udało się utworzyć paczki ZIP. Spróbuj ponownie lub zmniejsz listę.',
                  )
                } finally {
                  setPackaging(false)
                }
              })()
            }}
          >
            {packaging ? 'Paczka…' : 'Paczka'}
          </button>
          <button
            type="button"
            className="btn btn--sm btn--danger-outline"
            disabled={followerDuplicateCount === 0}
            onClick={handlePurgeDuplicates}
          >
            Usuń duplikaty (zostaw pierwotne)
          </button>
        </div>
      </div>

      {selectedIds.size > 0 && (
        <div className="table-bulk-bar" role="region" aria-label="Akcje zbiorcze">
          <span className="table-bulk-bar__count">
            Zaznaczono: <strong>{selectedIds.size}</strong>
          </span>
          {grossSummary && (
            <span className="table-bulk-bar__sum" title="Suma brutto zaznaczonych (per waluta)">
              Brutto: {grossSummary}
            </span>
          )}
          <div className="table-bulk-bar__actions">
            <button
              type="button"
              className="btn btn--sm btn--ghost"
              disabled={bulkBusy}
              onClick={() => void runBulk(onBulkMarkPaid)}
            >
              Zapłacone
            </button>
            <button
              type="button"
              className="btn btn--sm btn--ghost"
              disabled={bulkBusy}
              onClick={() => void runBulk(onBulkMarkUnpaid)}
            >
              Niezapłacone
            </button>
            <button
              type="button"
              className="btn btn--sm btn--ghost"
              disabled={bulkBusy}
              onClick={() => void runBulk(onBulkMarkNeedsReview)}
            >
              Do sprawdzenia
            </button>
            <button
              type="button"
              className="btn btn--sm btn--ghost"
              disabled={bulkBusy}
              onClick={() => void runBulk(onBulkMarkReviewOk)}
            >
              Przegląd OK
            </button>
            <button
              type="button"
              className="btn btn--sm btn--danger-outline"
              disabled={bulkBusy}
              onClick={handleBulkDelete}
            >
              Usuń zaznaczone
            </button>
          </div>
        </div>
      )}

      <div className="table-wrap">
        <table className="data-table">
          <colgroup>
            <col className="col-check" />
            <col className="col-status" />
            <col className="col-source" />
            <col className="col-rest" />
            <col className="col-supplier" />
            <col className="col-nip" />
            <col className="col-invno" />
            <col className="col-dates" />
            <col className="col-amount" />
            <col className="col-cat" />
            <col className="col-type" />
            <col className="col-pay" />
            <col className="col-dup" />
            <col className="col-actions" />
          </colgroup>
          <thead>
            <tr>
              <th className="th-check" scope="col">
                <input
                  ref={headerCheckRef}
                  type="checkbox"
                  className="table-row-check"
                  aria-label="Zaznacz wszystkie widoczne faktury"
                  onChange={toggleSelectAllVisible}
                />
              </th>
              <th>Status</th>
              <th>Źródło</th>
              <th className="hide-mobile">Lokal</th>
              <th>Dostawca</th>
              <th className="hide-mobile">NIP</th>
              <th>Nr FV</th>
              <th>Daty</th>
              <th className="num">Brutto</th>
              <th className="hide-mobile">Kategoria</th>
              <th className="hide-mobile">Typ</th>
              <th>Płatn.</th>
              <th className="hide-mobile">Dup.</th>
              <th className="col-actions-th" aria-label="Akcje" />
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 ? (
              <tr>
                <td colSpan={14} className="table-loading">
                  Ładowanie listy faktur…
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.id}
                  role="button"
                  tabIndex={0}
                  className={
                    selectedId === row.id
                      ? 'data-table__row data-table__row--active'
                      : 'data-table__row'
                  }
                  onClick={() => onSelect(row.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onSelect(row.id)
                    }
                  }}
                >
                  <td className="td-check" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      className="table-row-check"
                      checked={selectedIds.has(row.id)}
                      aria-label={`Zaznacz fakturę ${row.invoice_number}`}
                      onChange={() => toggleRow(row.id)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </td>
                  <td className="td-clip">
                    <ReviewBadge row={row} />
                  </td>
                  <td className="td-clip">
                    <SourceBadge type={row.source_type} />
                  </td>
                  <td className="td-clip hide-mobile" title={row.restaurant_name}>
                    {row.restaurant_name}
                  </td>
                  <td className="td-clip cell-strong" title={row.supplier_name}>
                    <span className="cell-supplier-line">{row.supplier_name}</span>
                    <UnknownVendorBadge row={row} />
                  </td>
                  <td className="td-clip mono hide-mobile" title={row.supplier_nip}>
                    {row.supplier_nip}
                  </td>
                  <td className="td-clip mono" title={row.invoice_number}>
                    {row.invoice_number}
                  </td>
                  <td className="td-dates">
                    <span className="td-dates__line">{row.issue_date}</span>
                    <span className="td-dates__sub">→ {row.due_date}</span>
                  </td>
                  <td className="num cell-strong td-clip">
                    {formatMoney(row.gross_amount, row.currency)}
                  </td>
                  <td className="td-clip hide-mobile" title={row.category ?? ''}>
                    {row.category ?? '—'}
                  </td>
                  <td className="td-clip hide-mobile">
                    <ScopeBadge scope={row.document_scope} />
                  </td>
                  <td className="td-clip">
                    <PaymentBadge status={row.payment_status} />
                  </td>
                  <td className="td-clip hide-mobile">
                    <DuplicateBadge row={row} />
                  </td>
                  <td className="td-actions">
                    <button
                      type="button"
                      className="btn-icon-del"
                      title="Usuń wpis"
                      aria-label={`Usuń fakturę ${row.invoice_number}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDelete(row.id, `${row.invoice_number} · ${row.supplier_name}`)
                      }}
                    >
                      Usuń
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        {!loading && rows.length === 0 && (
          <p className="table-empty">Brak rekordów dla wybranych filtrów.</p>
        )}
      </div>
    </div>
  )
}
