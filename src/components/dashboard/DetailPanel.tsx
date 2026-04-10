import { useCallback, useEffect, useRef, useState } from 'react'
import type { InvoiceRecord } from '../../types/invoice'
import { DuplicateBadge, PaymentBadge, ScopeBadge, SourceBadge } from './Badges'
import { InvoiceDocumentPreview } from './InvoiceDocumentPreview'

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
  categoryLocalOnly: boolean
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
  /** Ponowna kolejka OCR (tylko tryb API). */
  onRetryExtraction?: (id: string) => void | Promise<void>
  onDeleteInvoice: (id: string) => void
}

export function DetailPanel({
  row,
  categories,
  linkedRow,
  categoryLocalOnly,
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
  onRetryExtraction,
  onDeleteInvoice,
}: Props) {
  const [draftNotes, setDraftNotes] = useState('')
  const [ocrBusy, setOcrBusy] = useState(false)
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!row) {
      setDraftNotes('')
      return
    }
    setDraftNotes(row.notes)
  }, [row?.id])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    },
    [onClose],
  )

  useEffect(() => {
    if (!row) return
    document.addEventListener('keydown', handleKeyDown)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = ''
    }
  }, [row, handleKeyDown])

  if (!row) return null

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) onClose()
  }

  return (
    <div className="modal-overlay" ref={overlayRef} onClick={handleOverlayClick}>
      <div className="modal-content" role="dialog" aria-label="Szczegóły faktury">
        <div className="modal-header">
          <div>
            <h2 className="detail-panel__title">Szczegóły faktury</h2>
            <p className="detail-panel__id mono">Faktura: {row.id}</p>
            {row.primary_document_id ? (
              <p className="detail-panel__id mono detail-panel__id--secondary">Dokument: {row.primary_document_id}</p>
            ) : null}
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Zamknij">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </div>

        <div className="modal-body">
          <div className="modal-grid">
            <div className="modal-grid__left">
              <section className="detail-section">
                <h3>Podgląd dokumentu</h3>
                <InvoiceDocumentPreview key={row.id} invoiceId={row.id} />
              </section>
            </div>

            <div className="modal-grid__right">
              <section className="detail-section">
                <h3>Dane faktury</h3>
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
                  <dd>wystawienie {row.issue_date} · płatność do {row.due_date}</dd>
                  <dt>Kwota netto</dt>
                  <dd>{money(row.net_amount, row.currency)}</dd>
                  <dt>Kwota brutto</dt>
                  <dd className="cell-strong">{money(row.gross_amount, row.currency)}</dd>
                  <dt>Restauracja</dt>
                  <dd>{row.restaurant_name}</dd>
                  <dt>Kategoria</dt>
                  <dd>{row.category ?? '—'}</dd>
                  <dt>Typ</dt>
                  <dd><ScopeBadge scope={row.document_scope} /></dd>
                  <dt>Płatność</dt>
                  <dd><PaymentBadge status={row.payment_status} /></dd>
                  <dt>Duplikat</dt>
                  <dd>
                    <DuplicateBadge row={row} />
                    {row.duplicate_reason && <p className="detail-reason">{row.duplicate_reason}</p>}
                  </dd>
                </dl>
              </section>

              <section className="detail-section">
                <h3>Źródło wpływu</h3>
                <dl className="detail-dl">
                  <dt>Typ</dt>
                  <dd><SourceBadge type={row.source_type} /></dd>
                  <dt>Konto / integracja</dt>
                  <dd>{row.source_account}</dd>
                  <dt>Message ID</dt>
                  <dd className="mono wrap">{row.message_id ?? '—'}</dd>
                  <dt>Hash załącznika</dt>
                  <dd className="mono wrap">{row.attachment_hash ?? '—'}</dd>
                </dl>
              </section>

              <section className="detail-section">
                <h3>Notatki</h3>
                <textarea
                  className="textarea"
                  rows={3}
                  value={draftNotes}
                  onChange={(e) => setDraftNotes(e.target.value)}
                  onBlur={() => {
                    if (draftNotes !== row.notes) onNotes(row.id, draftNotes)
                  }}
                />
              </section>

              <section className="detail-section">
                <h3>Akcje operatora</h3>
                <div className="action-grid action-grid--modal">
                  <button type="button" className="btn btn--primary" onClick={() => onPaid(row.id)}>Oznacz zapłaconą</button>
                  <button type="button" className="btn" onClick={() => onUnpaid(row.id)}>Oznacz niezapłaconą</button>
                  <button type="button" className="btn" onClick={() => onNeedsReview(row.id)}>Do sprawdzenia</button>
                  <button type="button" className="btn" onClick={() => onClearReview(row.id)}>Wyczyść przegląd</button>
                  <label className="field field--inline">
                    <span className="field__label">Kategoria</span>
                    <select
                      className="input"
                      title={categoryLocalOnly ? 'Kategoria jest zapamiętywana tylko w tej przeglądarce (do czasu odświeżenia strony); backend jej nie zapisuje.' : undefined}
                      value={row.category ?? ''}
                      onChange={(e) => onCategory(row.id, e.target.value || null)}
                    >
                      <option value="">— brak —</option>
                      {categories.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </label>
                  <button type="button" className="btn" onClick={() => onBusiness(row.id)}>Typ: firmowa</button>
                  <button type="button" className="btn" onClick={() => onPrivate(row.id)}>Typ: prywatna</button>
                  <button type="button" className="btn btn--danger-outline" onClick={() => onConfirmDup(row.id)}>Potwierdź duplikat</button>
                  <button type="button" className="btn" onClick={() => onRejectDup(row.id)}>Odrzuć duplikat</button>
                  {row.duplicate_of_id && linkedRow && (
                    <button type="button" className="btn btn--link" onClick={() => onGoTo(row.duplicate_of_id!)}>
                      Przejdź do powiązanego ({linkedRow.invoice_number})
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn--danger-solid"
                    onClick={() => {
                      if (window.confirm(`Usunąć ten wpis z inboxu?\n${row.invoice_number} · ${row.supplier_name}`)) {
                        onDeleteInvoice(row.id)
                      }
                    }}
                  >
                    Usuń fakturę z inboxu
                  </button>
                  {row.duplicate_of_id && (
                    <p className="detail-hint">
                      Ten rekord jest powiązany jako duplikat — możesz go usunąć i zostawić pierwotny wpis, albo użyć „Usuń duplikaty" nad tabelą.
                    </p>
                  )}

                  {onRetryExtraction && (
                    <button
                      type="button"
                      className="btn btn--warning"
                      disabled={ocrBusy || row.invoice_status === 'INGESTING'}
                      onClick={async () => {
                        setOcrBusy(true)
                        try {
                          await onRetryExtraction(row.id)
                        } finally {
                          setOcrBusy(false)
                        }
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                      {' '}
                      {ocrBusy
                        ? 'Kolejkowanie…'
                        : row.invoice_status === 'INGESTING'
                          ? 'OCR w toku…'
                          : 'Ponów OCR / ekstrakcję'}
                    </button>
                  )}
                </div>
              </section>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
