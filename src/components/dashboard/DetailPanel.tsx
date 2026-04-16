import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buildEpcSctQrPayload } from '../../lib/epcTransferQr'
import type { InvoiceRecord } from '../../types/invoice'
import { DuplicateBadge, PaymentBadge, ScopeBadge, SourceBadge } from './Badges'
import { InvoiceDocumentPreview } from './InvoiceDocumentPreview'
import { SafeQrCode } from './safeQrCode'
import {
  fetchInvoiceEvents,
  fetchInvoicePispPaymentState,
  type InvoiceEventRow,
  type InvoicePispPaymentState,
} from '../../api/invoicesApi'
import { getStoredToken } from '../../auth/session'
import { COST_CATEGORIES, REVENUE_CATEGORIES } from '../../data/categories'

const money = (amount: number, c: InvoiceRecord['currency']) =>
  new Intl.NumberFormat('pl-PL', {
    style: 'currency',
    currency: c,
    maximumFractionDigits: 2,
  }).format(amount)

type Props = {
  row: InvoiceRecord | null
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
  /** Ponowna kolejka OCR na istniejącym pliku (upload e-mail — nie KSeF). */
  onRetryExtraction?: (id: string) => void | Promise<void>
  /** Pobranie XML z MF + pipeline (faktury z importu KSeF). */
  onKsefSync?: (id: string) => void | Promise<void>
  /** Odświeżenie listy z API (np. gdy status INGESTING — bez nowej kolejki). */
  onRefreshList?: () => void | Promise<void>
  onDeleteInvoice: (id: string) => void
  /** Wysyłka do KSeF (faktury sprzedaży). */
  onSendToKsef?: (id: string) => void | Promise<void>
  /** Utwórz / dopnij kontrahenta po NIP i przypisz do faktury kosztowej. */
  onAdoptVendor?: (id: string, body?: { nip?: string; name?: string }) => void | Promise<void>
}

export function DetailPanel({
  row,
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
  onKsefSync,
  onRefreshList,
  onDeleteInvoice,
  onSendToKsef,
  onAdoptVendor,
}: Props) {
  const [draftNotes, setDraftNotes] = useState('')
  const [ocrBusy, setOcrBusy] = useState(false)
  const [ksefBusy, setKsefBusy] = useState(false)
  const [ksefPullBusy, setKsefPullBusy] = useState(false)
  const [docPreviewReloadKey, setDocPreviewReloadKey] = useState(0)
  const [adoptNip, setAdoptNip] = useState('')
  const [adoptName, setAdoptName] = useState('')
  const [adoptBusy, setAdoptBusy] = useState(false)
  const [paymentEvents, setPaymentEvents] = useState<InvoiceEventRow[]>([])
  const [paymentEventsLoading, setPaymentEventsLoading] = useState(false)
  const [pispState, setPispState] = useState<InvoicePispPaymentState | null>(null)
  const [pispLoading, setPispLoading] = useState(false)
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

  useEffect(() => {
    setDocPreviewReloadKey(0)
  }, [row?.id])

  const epcQrPayload = useMemo(() => {
    if (!row?.transfer?.transferBankAccount) return null
    return buildEpcSctQrPayload({
      beneficiaryName: row.transfer.transferRecipient?.trim() || 'Odbiorca',
      accountRaw: row.transfer.transferBankAccount,
      amount: row.transfer.transferAmount,
      currency: row.transfer.transferCurrency,
      remittance: row.transfer.transferTitle?.trim() || row.invoice_number,
    })
  }, [
    row?.id,
    row?.invoice_number,
    row?.transfer?.transferBankAccount,
    row?.transfer?.transferAmount,
    row?.transfer?.transferCurrency,
    row?.transfer?.transferRecipient,
    row?.transfer?.transferTitle,
  ])

  const categoryOptions = useMemo(() => {
    const base: string[] =
      row?.ledger_kind === 'sale' ? [...REVENUE_CATEGORIES] : [...COST_CATEGORIES]
    const c = row?.category?.trim()
    if (c && !base.includes(c)) base.unshift(c)
    return base
  }, [row?.ledger_kind, row?.category])

  useEffect(() => {
    if (!row) {
      setPaymentEvents([])
      return
    }
    const token = getStoredToken()
    if (!token) {
      setPaymentEvents([])
      return
    }
    setPaymentEventsLoading(true)
    void fetchInvoiceEvents(token, row.id)
      .then((events) => {
        const filtered = events.filter((e) => {
          if (e.type !== 'UPDATED' && e.type !== 'STATUS_CHANGED') return false
          if (!e.payload || typeof e.payload !== 'object') return false
          const payload = e.payload as { payment?: { kind?: unknown } }
          return typeof payload.payment?.kind === 'string'
        })
        setPaymentEvents(filtered)
      })
      .catch(() => {
        setPaymentEvents([])
      })
      .finally(() => setPaymentEventsLoading(false))
  }, [row?.id])

  useEffect(() => {
    if (!row || row.ledger_kind !== 'purchase' || row.payment_status === 'paid') {
      setPispState(null)
      return
    }
    const token = getStoredToken()
    if (!token) {
      setPispState(null)
      return
    }
    setPispLoading(true)
    void fetchInvoicePispPaymentState(token, row.id)
      .then(setPispState)
      .catch(() => setPispState(null))
      .finally(() => setPispLoading(false))
  }, [row?.id, row?.ledger_kind, row?.payment_status])

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
  const primaryMime = (row.primary_document_mime ?? '').toLowerCase()
  const primaryLooksLikeXml =
    primaryMime.includes('xml') || primaryMime.startsWith('text/')
  const shouldPreferKsefFaXmlPreview =
    row.source_type === 'ksef' &&
    (primaryLooksLikeXml || row.primary_document_kind === 'ksef_summary_pdf')

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) onClose()
  }

  return (
    <div className="modal-overlay" ref={overlayRef} onClick={handleOverlayClick}>
      <div className="modal-content" role="dialog" aria-label="Szczegóły faktury">
        <div className="modal-header">
          <div>
            <h2 className="detail-panel__title">Szczegóły faktury</h2>
            <p className="detail-panel__subtitle">
              <span className="detail-hero__supplier">
                {row.supplier_name?.trim() && row.supplier_name.trim() !== '—' ? row.supplier_name : '—'}
              </span>
              <span className="mono"> · {row.invoice_number}</span>
            </p>
            <details className="detail-panel__techids">
              <summary>Identyfikatory techniczne</summary>
              <p className="detail-panel__id mono">Faktura: {row.id}</p>
              {row.primary_document_id ? (
                <p className="detail-panel__id mono detail-panel__id--secondary">Dokument: {row.primary_document_id}</p>
              ) : null}
            </details>
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
                {row.source_type === 'ksef' && onKsefSync ? (
                  <div className="detail-ksef-toolbar">
                    <div className="detail-ksef-toolbar__row">
                      <button
                        type="button"
                        className="btn btn--primary btn--sm"
                        disabled={ksefPullBusy}
                        onClick={async () => {
                          setKsefPullBusy(true)
                          try {
                            await onKsefSync(row.id)
                            setDocPreviewReloadKey((n) => n + 1)
                          } finally {
                            setKsefPullBusy(false)
                          }
                        }}
                      >
                        {ksefPullBusy
                          ? 'Pobieranie z KSeF…'
                          : row.invoice_status === 'INGESTING'
                            ? 'Ponów pobranie z KSeF'
                            : 'Pobierz z KSeF i przetwórz'}
                      </button>
                      {onRefreshList ? (
                        <button type="button" className="btn btn--ghost btn--sm" onClick={() => void onRefreshList()}>
                          Odśwież dane
                        </button>
                      ) : null}
                    </div>
                    <p className="detail-ksef-toolbar__hint workspace-panel__muted">
                      Pobiera aktualny plik FA XML z KSeF i kolejkuje ekstrakcję. Lista odświeża się automatycznie, gdy
                      worker skończy pracę. Jeśli status utknie w „przetwarzanie”, użyj ponownie przycisku powyżej —
                      serwer zwolni zawieszone zadanie i pobierze fakturę od nowa.
                    </p>
                  </div>
                ) : null}
                <InvoiceDocumentPreview
                  key={row.id}
                  invoiceId={row.id}
                  ksefNumber={row.ksef_number}
                  preferKsefFaXml={shouldPreferKsefFaXmlPreview}
                  reloadExtra={docPreviewReloadKey}
                />
              </section>
            </div>

            <div className="modal-grid__right">
              <div className="detail-hero">
                <div className="detail-hero__amount">{money(row.gross_amount, row.currency)}</div>
                <div className="detail-hero__meta">
                  netto {money(row.net_amount, row.currency)} · wystawienie {row.issue_date} · płatność do {row.due_date}
                </div>
                <div className="detail-hero__badges">
                  <PaymentBadge status={row.payment_status} />
                  <ScopeBadge scope={row.document_scope} />
                  <DuplicateBadge row={row} />
                </div>
              </div>

              <section className="detail-section detail-section--tight">
                <h3>Dane</h3>
                <dl className="detail-dl">
                  <dt>NIP</dt>
                  <dd className="mono">{row.supplier_nip?.trim() || '—'}</dd>
                  <dt>Rejestr</dt>
                  <dd>{row.ledger_kind === 'sale' ? 'Sprzedaż (nasza faktura)' : 'Koszt (zakup)'}</dd>
                  <dt>KSeF — numer</dt>
                  <dd className="mono">{row.ksef_number ?? '—'}</dd>
                  <dt>KSeF — workflow</dt>
                  <dd className="mono">{row.ksef_status ?? '—'}</dd>
                  <dt>Restauracja</dt>
                  <dd>{row.restaurant_name}</dd>
                  <dt>Kategoria</dt>
                  <dd>{row.category ?? '—'}</dd>
                  <dt>Duplikat</dt>
                  <dd>
                    {row.duplicate_reason ? <p className="detail-reason">{row.duplicate_reason}</p> : '—'}
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
                      Wysyła strukturalną FA do API KSeF. Poświadczenia zapisujesz w <strong>Ustawieniach</strong> (sekcja
                      KSeF) albo na serwerze w <span className="mono">KSEF_*</span>. Wymagane: NIP firmy w{' '}
                      <strong>Ustawieniach</strong>, <span className="mono">KSEF_ISSUANCE_MODE=live</span> oraz środowisko inne
                      niż mock — inaczej zapisany zostanie tylko stub (PENDING).
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

              {row.ledger_kind === 'purchase' && row.payment_status !== 'paid' && (
                <section className="detail-section detail-payment-panel">
                  <h3>Przelew do wystawcy</h3>
                  <p className="workspace-panel__muted" style={{ margin: '0 0 0.75rem' }}>
                    Środki idą <strong>bezpośrednio na konto kontrahenta</strong> z faktury. Możesz zeskanować{' '}
                    <strong>kod QR (EPC)</strong> w aplikacji banku albo skopiować pola.{' '}
                    <strong>PISP</strong> — po podłączeniu open banking; status na dole sekcji.
                  </p>
                  {row.transfer?.transferBankAccount ? (
                    <dl className="detail-dl">
                      <dt>Odbiorca</dt>
                      <dd>{row.transfer.transferRecipient ?? '—'}</dd>
                      <dt>Bank</dt>
                      <dd>{row.transfer.transferBankName ?? '—'}</dd>
                      <dt>Numer rachunku</dt>
                      <dd className="mono wrap">
                        {row.transfer.transferBankAccount}{' '}
                        <button
                          type="button"
                          className="btn-ghost"
                          onClick={() => void navigator.clipboard.writeText(row.transfer!.transferBankAccount!)}
                        >
                          Kopiuj
                        </button>
                      </dd>
                      <dt>Tytuł</dt>
                      <dd className="mono wrap">
                        {row.transfer.transferTitle ?? '—'}{' '}
                        {row.transfer.transferTitle ? (
                          <button
                            type="button"
                            className="btn-ghost"
                            onClick={() => void navigator.clipboard.writeText(row.transfer!.transferTitle!)}
                          >
                            Kopiuj
                          </button>
                        ) : null}
                      </dd>
                      <dt>Kwota</dt>
                      <dd>
                        {money(Number.parseFloat(row.transfer.transferAmount) || 0, row.currency)}{' '}
                        <button
                          type="button"
                          className="btn-ghost"
                          onClick={() =>
                            void navigator.clipboard.writeText(
                              `${row.transfer!.transferAmount} ${row.transfer!.transferCurrency}`,
                            )
                          }
                        >
                          Kopiuj
                        </button>
                      </dd>
                    </dl>
                  ) : null}
                  {row.transfer?.transferBankAccount && epcQrPayload ? (
                    <div>
                      <p className="workspace-panel__muted" style={{ margin: '0.75rem 0 0.35rem' }}>
                        <strong>Kod QR przelewu</strong> (EPC / SEPA) — PLN i EUR. Bez QR użyj pól powyżej.
                      </p>
                      <div className="detail-qr-wrap">
                        <SafeQrCode value={epcQrPayload} size={200} level="M" />
                      </div>
                    </div>
                  ) : row.transfer?.transferBankAccount && row.currency !== 'PLN' && row.currency !== 'EUR' ? (
                    <p className="workspace-panel__muted" style={{ marginTop: '0.75rem' }} role="status">
                      Kod QR EPC jest dla PLN i EUR — ta faktura jest w {row.currency}; użyj przelewu ręcznego.
                    </p>
                  ) : null}
                  {row.transfer?.transferBankAccount &&
                  !epcQrPayload &&
                  (row.currency === 'PLN' || row.currency === 'EUR') ? (
                    <p className="workspace-panel__muted" style={{ marginTop: '0.5rem' }} role="status">
                      Nie udało się złożyć poprawnego IBAN — QR niedostępny. Wykonaj przelew ręcznie.
                    </p>
                  ) : null}
                  {!row.transfer?.transferBankAccount ? (
                    <p className="workspace-panel__muted" role="status">
                      Brak numeru rachunku w danych faktury — sprawdź dokument lub ponów ekstrakcję (OCR).
                    </p>
                  ) : null}
                  {pispLoading ? (
                    <p className="workspace-panel__muted" style={{ marginTop: '0.75rem' }} role="status">
                      Sprawdzanie statusu PISP…
                    </p>
                  ) : pispState ? (
                    <p className="workspace-panel__muted" style={{ marginTop: '0.75rem' }} role="status">
                      <strong>PISP:</strong> {pispState.message}
                    </p>
                  ) : null}
                </section>
              )}

              <div className="detail-actions">
                <div className="detail-actions__group">
                  <span className="detail-actions__label">Płatność</span>
                  <div className="detail-actions__row">
                    <button type="button" className="btn btn--primary btn--sm" onClick={() => onPaid(row.id)}>
                      Zapłacona
                    </button>
                    <button type="button" className="btn btn--sm" onClick={() => onUnpaid(row.id)}>
                      Niezapłacona
                    </button>
                  </div>
                </div>
                <div className="detail-actions__group">
                  <span className="detail-actions__label">Przegląd</span>
                  <div className="detail-actions__row">
                    <button type="button" className="btn btn--sm" onClick={() => onNeedsReview(row.id)}>
                      Do sprawdzenia
                    </button>
                    <button type="button" className="btn btn--sm" onClick={() => onClearReview(row.id)}>
                      Wyczyść przegląd
                    </button>
                  </div>
                </div>
                <div className="detail-actions__group">
                  <span className="detail-actions__label">Kategoria i typ</span>
                  <div className="detail-actions__row">
                    <label className="field field--inline">
                      <span className="field__label">Kategoria</span>
                      <select
                        className="input"
                        title={
                          categoryLocalOnly
                            ? 'W trybie demo kategoria jest tylko w tej przeglądarce.'
                            : 'Zapis w bazie — widoczna w Raportach wg kategorii.'
                        }
                        value={row.category ?? ''}
                        onChange={(e) => void onCategory(row.id, e.target.value || null)}
                      >
                        <option value="">— brak —</option>
                        {categoryOptions.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button type="button" className="btn btn--sm" onClick={() => onBusiness(row.id)}>
                      Firma
                    </button>
                    <button type="button" className="btn btn--sm" onClick={() => onPrivate(row.id)}>
                      Prywatna
                    </button>
                  </div>
                </div>
                <div className="detail-actions__group">
                  <span className="detail-actions__label">Duplikaty</span>
                  <div className="detail-actions__row">
                    <button type="button" className="btn btn--sm btn--danger-outline" onClick={() => onConfirmDup(row.id)}>
                      Potwierdź
                    </button>
                    <button type="button" className="btn btn--sm" onClick={() => onRejectDup(row.id)}>
                      Odrzuć
                    </button>
                    {row.duplicate_of_id && linkedRow && (
                      <button type="button" className="btn btn--sm btn--link" onClick={() => onGoTo(row.duplicate_of_id!)}>
                        Oryginał ({row.duplicate_canonical_number?.trim() || linkedRow.invoice_number})
                      </button>
                    )}
                  </div>
                  {row.duplicate_of_id && (
                    <p className="detail-hint" style={{ marginTop: 6 }}>
                      Powiązany duplikat — możesz usunąć ten wpis lub użyć „Usuń duplikaty” nad tabelą.
                    </p>
                  )}
                </div>
                {onRetryExtraction && row.source_type !== 'ksef' && (
                  <div className="detail-actions__group">
                    <span className="detail-actions__label">Plik źródłowy</span>
                    <div className="detail-actions__row">
                      <button
                        type="button"
                        className="btn btn--sm btn--warning"
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
                            ? 'OCR…'
                            : 'Ponów OCR'}
                      </button>
                    </div>
                  </div>
                )}
                <div className="detail-actions__danger">
                  <button
                    type="button"
                    className="btn btn--sm btn--danger-solid"
                    onClick={() => {
                      if (window.confirm(`Usunąć tę fakturę z listy?\n${row.invoice_number} · ${row.supplier_name}`)) {
                        onDeleteInvoice(row.id)
                      }
                    }}
                  >
                    Usuń z listy
                  </button>
                </div>
              </div>

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
                <h3>Historia płatności</h3>
                {paymentEventsLoading && <p className="workspace-panel__muted">Ładowanie historii płatności…</p>}
                {!paymentEventsLoading && paymentEvents.length === 0 && (
                  <p className="workspace-panel__muted">Brak zdarzeń płatności dla tej faktury.</p>
                )}
                {!paymentEventsLoading && paymentEvents.length > 0 && (
                  <ul className="detail-history-list">
                    {paymentEvents.map((e) => {
                      const payload = e.payload as {
                        payment?: { kind?: string; provider?: string; method?: string; sessionId?: string }
                      }
                      const p = payload.payment
                      const label =
                        p?.kind === 'checkout_created'
                          ? `Checkout utworzony (${p?.provider ?? 'provider'}, ${p?.method ?? 'method'})`
                          : p?.kind === 'checkout_paid'
                            ? 'Płatność potwierdzona (webhook)'
                            : p?.kind ?? 'Zdarzenie płatności'
                      return (
                        <li key={e.id}>
                          <span className="mono">{new Date(e.createdAt).toLocaleString('pl-PL')}</span> · {label}
                          {p?.sessionId ? <span className="mono"> · {p.sessionId}</span> : null}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </section>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
