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
  /** Wysyłka do KSeF (faktury sprzedaży). */
  onSendToKsef?: (id: string) => void | Promise<void>
  /** Utwórz / dopnij kontrahenta po NIP i przypisz do faktury kosztowej. */
  onAdoptVendor?: (id: string, body?: { nip?: string; name?: string }) => void | Promise<void>
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
  onSendToKsef,
  onAdoptVendor,
}: Props) {
  const [draftNotes, setDraftNotes] = useState('')
  const [ocrBusy, setOcrBusy] = useState(false)
  const [ksefBusy, setKsefBusy] = useState(false)
  const [adoptNip, setAdoptNip] = useState('')
  const [adoptName, setAdoptName] = useState('')
  const [adoptBusy, setAdoptBusy] = useState(false)
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!row) {
      setDraftNotes('')
      setAdoptNip('')
      setAdoptName('')
      return
    }
    setDraftNotes(row.notes)
    const digits = (row.extracted_vendor_nip || row.supplier_nip || '').replace(/\D/g, '')
    setAdoptNip(digits.slice(0, 10))
    setAdoptName('')
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

  const ksefEligible =
    row.ledger_kind === 'sale' && row.ksef_required === true && row.legal_channel === 'KSEF'
  const ksefWorkflowBusy =
    row.ksef_status === 'SENT' ||
    row.ksef_status === 'RECEIVED' ||
    row.ksef_status === 'PENDING'

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
                <InvoiceDocumentPreview key={row.id} invoiceId={row.id} ksefNumber={row.ksef_number} />
              </section>
            </div>

            <div className="modal-grid__right">
              <section className="detail-section">
                <h3>Dane faktury</h3>
                <dl className="detail-dl">
                  <dt>{row.ledger_kind === 'sale' ? 'Nabywca' : 'Dostawca'}</dt>
                  <dd>
                    {row.supplier_name?.trim() && row.supplier_name.trim() !== '—' ? row.supplier_name : '—'}
                  </dd>
                  <dt>NIP</dt>
                  <dd className="mono">{row.supplier_nip?.trim() || '—'}</dd>
                  <dt>Numer faktury</dt>
                  <dd className="mono">{row.invoice_number}</dd>
                  <dt>Rejestr</dt>
                  <dd>{row.ledger_kind === 'sale' ? 'Sprzedaż (nasza faktura)' : 'Koszt (zakup)'}</dd>
                  <dt>KSeF — numer</dt>
                  <dd className="mono">{row.ksef_number ?? '—'}</dd>
                  <dt>KSeF — workflow</dt>
                  <dd className="mono">{row.ksef_status ?? '—'}</dd>
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
                {row.needs_contractor_verification && row.ledger_kind !== 'sale' && (
                  <div className="detail-alert" role="status">
                    Brak dopasowanego kontrahenta w bazie — sprawdź, czy to faktycznie koszt firmy. Możesz dopisać
                    kontrahenta poniżej albo ręcznie w sekcji <strong>Kontrahenci</strong> (NIP:{' '}
                    {row.extracted_vendor_nip || row.supplier_nip || '—'}).
                  </div>
                )}
                {row.needs_contractor_verification && row.ledger_kind !== 'sale' && onAdoptVendor && (
                  <div className="detail-adopt-vendor" style={{ marginTop: 14 }}>
                    <h4 className="detail-adopt-vendor__title">Zaufany kontrahent</h4>
                    <p className="workspace-panel__muted" style={{ marginBottom: 10 }}>
                      Rozpoznajesz tego kontrahenta? Utwórz wpis na liście (lub dopnij istniejący po NIP) i przypisz go
                      do tej faktury.
                    </p>
                    <label className="field" style={{ marginBottom: 8 }}>
                      <span className="field__label">NIP (10 cyfr)</span>
                      <input
                        className="input mono"
                        inputMode="numeric"
                        autoComplete="off"
                        maxLength={10}
                        value={adoptNip}
                        onChange={(e) => setAdoptNip(e.target.value.replace(/\D/g, '').slice(0, 10))}
                      />
                    </label>
                    <label className="field" style={{ marginBottom: 10 }}>
                      <span className="field__label">Nazwa (opcjonalnie)</span>
                      <input
                        className="input"
                        maxLength={300}
                        value={adoptName}
                        onChange={(e) => setAdoptName(e.target.value)}
                        placeholder="np. z nagłówka faktury"
                      />
                    </label>
                    <button
                      type="button"
                      className="btn btn--primary"
                      disabled={adoptBusy || row.invoice_status === 'INGESTING' || adoptNip.length !== 10}
                      onClick={async () => {
                        setAdoptBusy(true)
                        try {
                          await onAdoptVendor(row.id, {
                            nip: adoptNip.trim() || undefined,
                            name: adoptName.trim() || undefined,
                          })
                        } finally {
                          setAdoptBusy(false)
                        }
                      }}
                    >
                      {adoptBusy ? 'Zapisywanie…' : 'Dodaj kontrahenta i przypisz'}
                    </button>
                  </div>
                )}
              </section>

              {row.ledger_kind === 'sale' && onSendToKsef && (
                <section className="detail-section">
                  <h3>KSeF — wystawienie</h3>
                  <dl className="detail-dl" style={{ marginBottom: 10 }}>
                    <dt>Status KSeF</dt>
                    <dd className="mono">{row.ksef_status ?? '—'}</dd>
                    <dt>Wymagane / kanał</dt>
                    <dd>
                      {row.ksef_required ? 'tak' : 'nie'} · {row.legal_channel ?? '—'}
                    </dd>
                  </dl>
                  {!ksefEligible && (
                    <p className="workspace-panel__muted" style={{ marginBottom: 10 }}>
                      Wysyłka do KSeF jest dostępna tylko dla faktur sprzedaży oznaczonych jako wymagane w KSeF i z
                      kanałem prawnym „KSEF” (reguły zgodności po zapisie faktury).
                    </p>
                  )}
                  {ksefEligible && (
                    <p className="workspace-panel__muted" style={{ marginBottom: 10 }}>
                      Wysyła strukturalną FA do API KSeF. Na serwerze ustaw m.in. <span className="mono">KSEF_TOKEN</span>
                      , <span className="mono">KSEF_NIP</span>, <span className="mono">KSEF_ENV</span> (sandbox lub
                      production) oraz <span className="mono">KSEF_ISSUANCE_MODE=live</span> — w przeciwnym razie
                      zapisany zostanie tylko stub (status PENDING bez wywołania MF).
                    </p>
                  )}
                  <button
                    type="button"
                    className="btn btn--primary"
                    title={
                      !ksefEligible
                        ? 'Faktura nie kwalifikuje się do wysyłki KSeF.'
                        : ksefWorkflowBusy
                          ? 'Sesja zakończona lub w toku — sprawdź status powyżej.'
                          : undefined
                    }
                    disabled={ksefBusy || !ksefEligible || ksefWorkflowBusy}
                    onClick={async () => {
                      setKsefBusy(true)
                      try {
                        await onSendToKsef(row.id)
                      } finally {
                        setKsefBusy(false)
                      }
                    }}
                  >
                    {ksefBusy ? 'Wysyłanie…' : 'Wyślij do KSeF'}
                  </button>
                </section>
              )}

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
                      Przejdź do oryginału ({row.duplicate_canonical_number?.trim() || linkedRow.invoice_number})
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn--danger-solid"
                    onClick={() => {
                      if (window.confirm(`Usunąć tę fakturę z listy?\n${row.invoice_number} · ${row.supplier_name}`)) {
                        onDeleteInvoice(row.id)
                      }
                    }}
                  >
                    Usuń fakturę z listy
                  </button>
                  {row.duplicate_of_id && (
                    <p className="detail-hint">
                      Ten rekord jest powiązany jako duplikat — możesz go usunąć i zostawić pierwotny wpis, albo użyć „Usuń duplikaty" nad tabelą.
                    </p>
                  )}

                  {onRetryExtraction && row.source_type !== 'ksef' && (
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
