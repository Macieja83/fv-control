import { useMemo, useState } from 'react'
import type { InvoiceRecord } from '../../types/invoice'

type Tab = 'all' | 'invoice' | 'other'

function formatMoney(amount: number, currency: InvoiceRecord['currency']) {
  return new Intl.NumberFormat('pl-PL', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(amount)
}

export function DocumentsPanel({ rows }: { rows: InvoiceRecord[] }) {
  const [tab, setTab] = useState<Tab>('all')

  const counts = useMemo(
    () => ({
      all: rows.length,
      invoice: rows.filter((r) => r.document_kind === 'INVOICE').length,
      other: rows.filter((r) => r.document_kind && r.document_kind !== 'INVOICE').length,
    }),
    [rows],
  )

  const filtered = useMemo(() => {
    if (tab === 'all') return rows
    if (tab === 'invoice') return rows.filter((r) => r.document_kind === 'INVOICE')
    return rows.filter((r) => r.document_kind && r.document_kind !== 'INVOICE')
  }, [rows, tab])

  return (
    <div className="workspace-panel">
      <header className="workspace-panel__head">
        <div>
          <h2 className="workspace-panel__title">Dokumenty</h2>
          <p className="workspace-panel__lead">
            Przegląd wg typu dokumentu — te same dane co w Inbox, bez zmiany kontekstu firmy.
          </p>
        </div>
      </header>
      <div className="doc-tabs" role="tablist" aria-label="Typ dokumentu">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'all'}
          className={`doc-tabs__btn${tab === 'all' ? ' doc-tabs__btn--on' : ''}`}
          onClick={() => setTab('all')}
        >
          Wszystkie
          <span className="doc-tabs__count">{counts.all}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'invoice'}
          className={`doc-tabs__btn${tab === 'invoice' ? ' doc-tabs__btn--on' : ''}`}
          onClick={() => setTab('invoice')}
        >
          Faktury
          <span className="doc-tabs__count">{counts.invoice}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'other'}
          className={`doc-tabs__btn${tab === 'other' ? ' doc-tabs__btn--on' : ''}`}
          onClick={() => setTab('other')}
        >
          Inne
          <span className="doc-tabs__count">{counts.other}</span>
        </button>
      </div>

      <div className="contractor-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Numer</th>
              <th>Dostawca</th>
              <th>Typ</th>
              <th>Data</th>
              <th className="td-r">Brutto</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id}>
                <td className="mono">{r.invoice_number}</td>
                <td>{r.supplier_name}</td>
                <td>
                  <span className="badge badge--muted">{r.document_kind ?? '—'}</span>
                </td>
                <td>{r.issue_date}</td>
                <td className="td-r mono">{formatMoney(r.gross_amount, r.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <p className="workspace-panel__muted">Brak dokumentów w tej zakładce.</p>}
      </div>
    </div>
  )
}
