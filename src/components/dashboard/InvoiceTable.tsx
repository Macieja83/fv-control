import { useState } from 'react'
import type { InvoiceRecord } from '../../types/invoice'
import { downloadInvoicePackage } from '../../lib/exportInvoicePackage'
import {
  DuplicateBadge,
  PaymentBadge,
  ReviewBadge,
  ScopeBadge,
  SourceBadge,
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
}: Props) {
  const [packaging, setPackaging] = useState(false)

  const handleDelete = (id: string, label: string) => {
    const irreversible =
      dataSource === 'api'
        ? 'Tej operacji nie cofniesz — faktura zostanie usunięta z bazy.'
        : 'Tej operacji nie cofniesz w MVP (mock).'
    if (!window.confirm(`Usunąć wpis z inboxu?\n\n${label}\n\n${irreversible}`)) {
      return
    }
    onDelete(id)
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
      <div className="table-wrap">
        <table className="data-table">
          <colgroup>
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
                <td colSpan={13} className="table-loading">
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
                  {row.supplier_name}
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
