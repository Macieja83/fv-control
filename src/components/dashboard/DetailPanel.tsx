import { useState } from 'react'
import type { InvoiceRecord } from '../../types/invoice'
import { DuplicateBadge, PaymentBadge, ScopeBadge, SourceBadge } from './Badges'

const money = (amount: number, c: InvoiceRecord['currency']) =>
  new Intl.NumberFormat('pl-PL', {
    style: 'currency',
    currency: c,
    maximumFractionDigits: 2,
  }).format(amount)

type Props = {
  row: InvoiceRecord | null
  categories: readonly string[]
  linkedRow: InvoiceRecord | null
  onClose: () => void
  onPaid: (id: string) => void
  onUnpaid: (id: string) => void
  onCategory: (id: string, c: string | null) => void
  onPrivate: (id: string) => void
  onBusiness: (id: string) => void
  onConfirmDup: (id: string) => void
  onRejectDup: (id: string) => void
  onGoTo: (id: string) => void
  onNotes: (id: string, notes: string) => void
  onNeedsReview: (id: string) => void
  onClearReview: (id: string) => void
  onDeleteInvoice: (id: string) => void
}

export function DetailPanel({
  row,
  categories,
  linkedRow,
  onClose,
  onPaid,
  onUnpaid,
  onCategory,
  onPrivate,
  onBusiness,
  onConfirmDup,
  onRejectDup,
  onGoTo,
  onNotes,
  onNeedsReview,
  onClearReview,
  onDeleteInvoice,
}: Props) {
  const [draftNotes, setDraftNotes] = useState(() => row?.notes ?? '')

  if (!row) {
    return (
      <aside className="detail-panel detail-panel--empty">
        <p>Wybierz fakturę z tabeli, aby zobaczyć szczegóły i akcje.</p>
      </aside>
    )
  }

  return (
    <aside className="detail-panel">
      <div className="detail-panel__head">
        <div>
          <h2 className="detail-panel__title">Szczegóły faktury</h2>
          <p className="detail-panel__id mono">{row.id}</p>
        </div>
        <button type="button" className="btn btn--ghost" onClick={onClose}>
          Zamknij
        </button>
      </div>

      <section className="detail-section">
        <h3>Dane</h3>
        <dl className="detail-dl">
          <dt>Dostawca</dt>
          <dd>{row.supplier_name}</dd>
          <dt>NIP</dt>
          <dd className="mono">{row.supplier_nip}</dd>
          <dt>Numer faktury</dt>
          <dd className="mono">{row.invoice_number}</dd>
          <dt>KSeF</dt>
          <dd className="mono">{row.ksef_number ?? '—'}</dd>
          <dt>Daty</dt>
          <dd>
            wystawienie {row.issue_date} · płatność do {row.due_date}
          </dd>
          <dt>Kwota brutto</dt>
          <dd className="cell-strong">{money(row.gross_amount, row.currency)}</dd>
          <dt>Restauracja</dt>
          <dd>{row.restaurant_name}</dd>
          <dt>Kategoria</dt>
          <dd>{row.category ?? '—'}</dd>
          <dt>Typ</dt>
          <dd>
            <ScopeBadge scope={row.document_scope} />
          </dd>
          <dt>Płatność</dt>
          <dd>
            <PaymentBadge status={row.payment_status} />
          </dd>
          <dt>Duplikat</dt>
          <dd>
            <DuplicateBadge row={row} />
            {row.duplicate_reason && (
              <p className="detail-reason">{row.duplicate_reason}</p>
            )}
          </dd>
        </dl>
      </section>

      <section className="detail-section">
        <h3>Źródło wpływu</h3>
        <dl className="detail-dl">
          <dt>Typ</dt>
          <dd>
            <SourceBadge type={row.source_type} />
          </dd>
          <dt>Konto / integracja</dt>
          <dd>{row.source_account}</dd>
          <dt>Message ID</dt>
          <dd className="mono wrap">{row.message_id ?? '—'}</dd>
          <dt>Hash załącznika</dt>
          <dd className="mono wrap">{row.attachment_hash ?? '—'}</dd>
        </dl>
      </section>

      <section className="detail-section">
        <h3>Historia zmian</h3>
        <ul className="history-list">
          {row.history.map((h) => (
            <li key={h.id}>
              <time dateTime={h.at}>{h.at.replace('T', ' ').slice(0, 19)}</time>
              <span className="history-list__actor">{h.actor}</span>
              <span>{h.action}</span>
              {h.detail && <span className="history-list__detail">{h.detail}</span>}
            </li>
          ))}
        </ul>
      </section>

      <section className="detail-section">
        <h3>Notatki</h3>
        <textarea
          className="textarea"
          rows={4}
          value={draftNotes}
          onChange={(e) => setDraftNotes(e.target.value)}
          onBlur={() => {
            if (draftNotes !== row.notes) onNotes(row.id, draftNotes)
          }}
        />
      </section>

      <section className="detail-section">
        <h3>Akcje operatora</h3>
        <div className="action-grid">
          <button type="button" className="btn btn--primary" onClick={() => onPaid(row.id)}>
            Oznacz zapłaconą
          </button>
          <button type="button" className="btn" onClick={() => onUnpaid(row.id)}>
            Oznacz niezapłaconą
          </button>
          <button type="button" className="btn" onClick={() => onNeedsReview(row.id)}>
            Do sprawdzenia
          </button>
          <button type="button" className="btn" onClick={() => onClearReview(row.id)}>
            Wyczyść przegląd
          </button>
          <label className="field field--inline">
            <span className="field__label">Kategoria</span>
            <select
              className="input"
              value={row.category ?? ''}
              onChange={(e) =>
                onCategory(row.id, e.target.value ? e.target.value : null)
              }
            >
              <option value="">— brak —</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn" onClick={() => onBusiness(row.id)}>
            Typ: firmowa
          </button>
          <button type="button" className="btn" onClick={() => onPrivate(row.id)}>
            Typ: prywatna
          </button>
          <button type="button" className="btn btn--danger-outline" onClick={() => onConfirmDup(row.id)}>
            Potwierdź duplikat
          </button>
          <button type="button" className="btn" onClick={() => onRejectDup(row.id)}>
            Odrzuć duplikat
          </button>
          {row.duplicate_of_id && linkedRow && (
            <button
              type="button"
              className="btn btn--link"
              onClick={() => onGoTo(row.duplicate_of_id!)}
            >
              Przejdź do powiązanego ({linkedRow.invoice_number})
            </button>
          )}
          <button
            type="button"
            className="btn btn--danger-solid"
            onClick={() => {
              if (
                window.confirm(
                  `Usunąć ten wpis z inboxu?\n${row.invoice_number} · ${row.supplier_name}`,
                )
              ) {
                onDeleteInvoice(row.id)
              }
            }}
          >
            Usuń fakturę z inboxu
          </button>
          {row.duplicate_of_id && (
            <p className="detail-hint">
              Ten rekord jest powiązany jako duplikat — możesz go usunąć i zostawić pierwotny wpis, albo użyć „Usuń duplikaty” nad tabelą.
            </p>
          )}
        </div>
      </section>
    </aside>
  )
}
