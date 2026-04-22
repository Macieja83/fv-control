import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { InvoiceRecord } from '../../types/invoice'
import { DuplicateBadge, PaymentBadge, ScopeBadge, SourceBadge } from './Badges'
import { InvoiceDocumentPreview } from './InvoiceDocumentPreview'
import { fetchInvoiceDetail, fetchInvoiceEvents, type InvoiceEventRow } from '../../api/invoicesApi'
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
  /** Ponowne przetworzenie pliku (upload e-mail itd.) — wywoływane z „Odśwież” przy źródle innym niż KSeF. */
  onRetryExtraction?: (id: string) => void | Promise<void>
  /** Pobranie FA XML z KSeF + pipeline — wywoływane z „Odśwież” dla faktur z KSeF. */
  onKsefSync?: (id: string) => void | Promise<void>
  /** Odświeżenie listy z API (np. gdy status INGESTING — bez nowej kolejki). */
  onRefreshList?: () => void | Promise<void>
  onDeleteInvoice: (id: string) => void
  /** Wysyłka do KSeF (faktury sprzedaży). */
  onSendToKsef?: (id: string) => void | Promise<void>
  /** Edycja faktury sprzedaży przed wysyłką do KSeF. */
  onEditSalesInvoice?: (id: string) => void | Promise<void>
  /** Utwórz / dopnij kontrahenta po NIP i przypisz do faktury kosztowej. */
  onAdoptVendor?: (id: string, body?: { nip?: string; name?: string }) => void | Promise<void>
  /** Zapis pól uznanych za wynik OCR (upload / skan), nieużywany na fakturach KSeF-API. */
  onSaveOcrEdits?: (id: string, body: Record<string, unknown>) => void | Promise<void>
  dataSource?: 'api' | 'mock'
}

type OcrFormState = {
  number: string
  issueDate: string
  dueDate: string
  currency: string
  net: string
  vat: string
  gross: string
  contractorNip: string
  contractorName: string
  paymentForm: string
  bankAccount: string
  paymentDescription: string
}

function buildOcrFormState(row: InvoiceRecord): OcrFormState {
  const vatFallback = Math.round((row.gross_amount - row.net_amount) * 100) / 100
  const vatNum =
    typeof row.vat_amount === 'number' && Number.isFinite(row.vat_amount) ? row.vat_amount : vatFallback
  return {
    number: row.invoice_number,
    issueDate: row.issue_date,
    dueDate: row.due_date || '',
    currency: row.currency,
    net: row.net_amount.toFixed(2),
    vat: vatNum.toFixed(2),
    gross: row.gross_amount.toFixed(2),
    contractorNip: (row.extracted_vendor_nip || row.supplier_nip || '').replace(/\D/g, '').slice(0, 10),
    contractorName:
      row.supplier_name?.trim() && row.supplier_name.trim() !== '—' ? row.supplier_name.trim() : '',
    paymentForm: '',
    bankAccount: '',
    paymentDescription: '',
  }
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
  onEditSalesInvoice,
  onAdoptVendor,
  onSaveOcrEdits,
  dataSource = 'api',
}: Props) {
  const [draftNotes, setDraftNotes] = useState('')
  const [ksefBusy, setKsefBusy] = useState(false)
  const [previewRefreshBusy, setPreviewRefreshBusy] = useState(false)
  const [docPreviewReloadKey, setDocPreviewReloadKey] = useState(0)
  const [adoptNip, setAdoptNip] = useState('')
  const [adoptName, setAdoptName] = useState('')
  const [adoptBusy, setAdoptBusy] = useState(false)
  const [paymentEvents, setPaymentEvents] = useState<InvoiceEventRow[]>([])
  const [paymentEventsLoading, setPaymentEventsLoading] = useState(false)
  const [ocrForm, setOcrForm] = useState<OcrFormState | null>(null)
  const [ocrExtraLoading, setOcrExtraLoading] = useState(false)
  const [ocrSaveBusy, setOcrSaveBusy] = useState(false)
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!row) {
      setDraftNotes('')
      setAdoptNip('')
      setAdoptName('')
      setOcrForm(null)
      return
    }
    setDraftNotes(row.notes)
    const digits = (row.extracted_vendor_nip || row.supplier_nip || '').replace(/\D/g, '')
    setAdoptNip(digits.slice(0, 10))
    setAdoptName('')
    setOcrForm(buildOcrFormState(row))
  }, [row?.id])

  useEffect(() => {
    if (!row || dataSource === 'mock') return
    if (row.intake_source_type === 'KSEF_API') return
    const token = getStoredToken()
    if (!token) return
    const invoiceId = row.id
    let cancelled = false
    setOcrExtraLoading(true)
    void fetchInvoiceDetail(token, invoiceId)
      .then((detail) => {
        if (cancelled) return
        const p = detail.normalizedPayload
        if (!p || typeof p !== 'object' || p === null) return
        const o = p as Record<string, unknown>
        setOcrForm((prev) => {
          if (!prev) return prev
          return {
            ...prev,
            paymentForm: typeof o.paymentForm === 'string' ? o.paymentForm : prev.paymentForm,
            bankAccount: typeof o.bankAccount === 'string' ? o.bankAccount : prev.bankAccount,
            paymentDescription:
              typeof o.paymentDescription === 'string' ? o.paymentDescription : prev.paymentDescription,
            contractorNip:
              typeof o.contractorNip === 'string' && o.contractorNip.replace(/\D/g, '').length === 10
                ? o.contractorNip.replace(/\D/g, '')
                : prev.contractorNip,
            contractorName: typeof o.contractorName === 'string' && o.contractorName.trim()
              ? o.contractorName.trim()
              : prev.contractorName,
          }
        })
      })
      .catch(() => {
        /* ciche — pola z listy zostaną */
      })
      .finally(() => {
        if (!cancelled) setOcrExtraLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [row?.id, dataSource, row?.intake_source_type])

  useEffect(() => {
    setDocPreviewReloadKey(0)
  }, [row?.id])

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

  const handlePreviewRefresh = useCallback(async () => {
    if (!row) return
    setPreviewRefreshBusy(true)
    try {
      if (row.source_type === 'ksef' && onKsefSync) {
        await onKsefSync(row.id)
      } else if (onRetryExtraction) {
        await onRetryExtraction(row.id)
      }
      if (onRefreshList) await onRefreshList()
      setDocPreviewReloadKey((n) => n + 1)
    } finally {
      setPreviewRefreshBusy(false)
    }
  }, [row, onKsefSync, onRetryExtraction, onRefreshList])

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
  const canEditSalesBeforeKsef =
    row.ledger_kind === 'sale' &&
    !ksefWorkflowBusy &&
    (row.ksef_status == null || row.ksef_status === 'TO_ISSUE' || row.ksef_status === 'FAILED')
  const primaryMime = (row.primary_document_mime ?? '').toLowerCase()
  const primaryLooksLikeXml =
    primaryMime.includes('xml') || primaryMime.startsWith('text/')
  const shouldPreferKsefFaXmlPreview =
    (row.source_type === 'ksef' &&
      (primaryLooksLikeXml || row.primary_document_kind === 'ksef_summary_pdf')) ||
    (row.ledger_kind === 'sale' && row.primary_document_kind === 'sale_preview_pdf')
  const ocrKsefLocked = row.intake_source_type === 'KSEF_API'
  const ocrIngesting = row.invoice_status === 'INGESTING'

  const handleOcrField =
    (key: keyof OcrFormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const v = e.target.value
      setOcrForm((prev) => (prev ? { ...prev, [key]: v } : prev))
    }

  const handleOcrSave = useCallback(() => {
    if (!onSaveOcrEdits || !row || !ocrForm) return
    const n = ocrForm.number.trim()
    if (!n) {
      window.alert('Podaj numer faktury.')
      return
    }
    setOcrSaveBusy(true)
    void (async () => {
      try {
        await onSaveOcrEdits(row.id, {
          number: n,
          issueDate: ocrForm.issueDate,
          dueDate: ocrForm.dueDate.trim() ? ocrForm.dueDate : null,
          currency: ocrForm.currency.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3) || 'PLN',
          netTotal: ocrForm.net,
          vatTotal: ocrForm.vat,
          grossTotal: ocrForm.gross,
          ocrContractorNip: ocrForm.contractorNip.trim() || null,
          ocrContractorName: ocrForm.contractorName.trim() || null,
          ocrPaymentForm: ocrForm.paymentForm.trim() || null,
          ocrBankAccount: ocrForm.bankAccount.replace(/\s/g, '').trim() || null,
          ocrPaymentDescription: ocrForm.paymentDescription.trim() || null,
        })
      } finally {
        setOcrSaveBusy(false)
      }
    })()
  }, [onSaveOcrEdits, ocrForm, row])

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
                {(onKsefSync || onRetryExtraction || onRefreshList) && (
                  <div className="detail-ksef-toolbar">
                    <div className="detail-ksef-toolbar__row">
                      <button
                        type="button"
                        className="btn btn--primary btn--sm"
                        disabled={previewRefreshBusy}
                        onClick={() => void handlePreviewRefresh()}
                      >
                        {previewRefreshBusy
                          ? 'Odświeżanie…'
                          : 'Odśwież'}
                      </button>
                    </div>
                    <p className="detail-ksef-toolbar__hint workspace-panel__muted">
                      {row.source_type === 'ksef'
                        ? 'Pobiera aktualny plik z KSeF i kolejkuje przetwarzanie. Przy zaciętym statusie użyj ponownie — serwer może zwolnić zadanie i pobrać fakturę od nowa.'
                        : 'Ponownie przetwarza plik z magazynu i odświeża listę oraz podgląd.'}
                    </p>
                  </div>
                )}
                <InvoiceDocumentPreview
                  key={`${row.id}:${row.primary_document_id ?? "none"}:${row.updated_at}`}
                  invoiceId={row.id}
                  ksefNumber={row.ksef_number}
                  preferKsefFaXml={shouldPreferKsefFaXmlPreview}
                  reloadExtra={docPreviewReloadKey + (Date.parse(row.updated_at) || 0)}
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

              {onSaveOcrEdits && (
                <section className="detail-section">
                  <h3>Dane rozpoznane (OCR)</h3>
                  {ocrKsefLocked ? (
                    <p className="workspace-panel__muted" style={{ margin: 0 }}>
                      Faktura z KSeF — pól z ministerialnego źródła i strukturalnej treści tutaj nie edytujesz. Do odświeżenia
                      danych użyj <strong>Odśwież</strong> w podglądzie dokumentu.
                    </p>
                  ) : ocrIngesting ? (
                    <p className="workspace-panel__muted" style={{ margin: 0 }}>
                      Trwa odczyt pliku (OCR) — gdy zniknie status „OCR” na etykiecie źródła, możesz skorygować pola
                      poniżej.
                    </p>
                  ) : ocrForm ? (
                    <>
                      {ocrExtraLoading && (
                        <p className="workspace-panel__muted" style={{ marginBottom: 8 }}>
                          Ładowanie szczegółów płatności (z odczytu)…
                        </p>
                      )}
                      <p className="workspace-panel__muted" style={{ marginTop: 0, marginBottom: 10 }}>
                        Dla faktur ze skanu, zdjęcia lub wgranego pliku (PDF/PNG/JPEG) — popraw rozpoznanie, jeśli
                        pomyliło cyfrę lub słowo. Dla importu <strong>z KSeF</strong> sekcja jest tylko do odczytu
                        (regułą jest źródłowe dane w systemie MF).
                      </p>
                      <div
                        className="detail-ocr-grid"
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '1fr 1fr',
                          gap: '0.65rem 1rem',
                        }}
                      >
                        <label className="field" style={{ gridColumn: '1 / -1' }}>
                          <span className="field__label">Numer faktury</span>
                          <input
                            className="input"
                            value={ocrForm.number}
                            onChange={handleOcrField('number')}
                            autoComplete="off"
                          />
                        </label>
                        <label className="field">
                          <span className="field__label">Data wystawienia</span>
                          <input
                            className="input mono"
                            type="date"
                            value={ocrForm.issueDate.length >= 10 ? ocrForm.issueDate.slice(0, 10) : ocrForm.issueDate}
                            onChange={handleOcrField('issueDate')}
                          />
                        </label>
                        <label className="field">
                          <span className="field__label">Termin płatności</span>
                          <input
                            className="input mono"
                            type="date"
                            value={
                              ocrForm.dueDate.length >= 10 ? ocrForm.dueDate.slice(0, 10) : ocrForm.dueDate
                            }
                            onChange={handleOcrField('dueDate')}
                          />
                        </label>
                        <label className="field">
                          <span className="field__label">Waluta (np. PLN)</span>
                          <input
                            className="input mono"
                            maxLength={3}
                            value={ocrForm.currency}
                            onChange={handleOcrField('currency')}
                          />
                        </label>
                        <label className="field">
                          <span className="field__label">Netto</span>
                          <input
                            className="input mono"
                            inputMode="decimal"
                            value={ocrForm.net}
                            onChange={handleOcrField('net')}
                          />
                        </label>
                        <label className="field">
                          <span className="field__label">VAT</span>
                          <input
                            className="input mono"
                            inputMode="decimal"
                            value={ocrForm.vat}
                            onChange={handleOcrField('vat')}
                          />
                        </label>
                        <label className="field" style={{ gridColumn: '1 / -1' }}>
                          <span className="field__label">Brutto</span>
                          <input
                            className="input mono"
                            inputMode="decimal"
                            value={ocrForm.gross}
                            onChange={handleOcrField('gross')}
                          />
                        </label>
                        <label className="field" style={{ gridColumn: '1 / -1' }}>
                          <span className="field__label">Sprzedawca — NIP (z faktury)</span>
                          <input
                            className="input mono"
                            inputMode="numeric"
                            maxLength={10}
                            value={ocrForm.contractorNip}
                            onChange={(e) => {
                              const t = e.target.value.replace(/\D/g, '').slice(0, 10)
                              setOcrForm((p) => (p ? { ...p, contractorNip: t } : p))
                            }}
                            autoComplete="off"
                          />
                        </label>
                        <label className="field" style={{ gridColumn: '1 / -1' }}>
                          <span className="field__label">Sprzedawca — nazwa (z faktury)</span>
                          <input
                            className="input"
                            value={ocrForm.contractorName}
                            onChange={handleOcrField('contractorName')}
                            maxLength={500}
                          />
                        </label>
                        <label className="field" style={{ gridColumn: '1 / -1' }}>
                          <span className="field__label">Forma płatności (tekst z dokumentu)</span>
                          <input
                            className="input"
                            value={ocrForm.paymentForm}
                            onChange={handleOcrField('paymentForm')}
                            maxLength={200}
                          />
                        </label>
                        <label className="field" style={{ gridColumn: '1 / -1' }}>
                          <span className="field__label">Rachunek (IBAN / nr konta, bez spacji w zapisie)</span>
                          <input
                            className="input mono"
                            value={ocrForm.bankAccount}
                            onChange={handleOcrField('bankAccount')}
                            maxLength={80}
                            spellCheck={false}
                            autoComplete="off"
                          />
                        </label>
                        <label className="field" style={{ gridColumn: '1 / -1' }}>
                          <span className="field__label">Tytuł / opis przelewu</span>
                          <textarea
                            className="textarea"
                            rows={2}
                            value={ocrForm.paymentDescription}
                            onChange={handleOcrField('paymentDescription')}
                            maxLength={500}
                          />
                        </label>
                      </div>
                      <div style={{ marginTop: 12 }}>
                        <button
                          type="button"
                          className="btn btn--primary"
                          disabled={ocrSaveBusy}
                          onClick={() => void handleOcrSave()}
                        >
                          {ocrSaveBusy ? 'Zapisywanie…' : 'Zapisz poprawki (OCR)'}
                        </button>
                      </div>
                    </>
                  ) : null}
                </section>
              )}

              {row.ledger_kind === 'sale' && (onSendToKsef || onEditSalesInvoice) && (
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
                  <div className="detail-actions__row">
                    {onEditSalesInvoice && (
                      <button
                        type="button"
                        className="btn btn--sm"
                        disabled={!canEditSalesBeforeKsef}
                        title={
                          canEditSalesBeforeKsef
                            ? undefined
                            : 'Edycja jest dostępna przed rozpoczęciem workflow wysyłki do KSeF.'
                        }
                        onClick={() => void onEditSalesInvoice(row.id)}
                      >
                        Edytuj fakturę
                      </button>
                    )}
                    {onSendToKsef && (
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
                    )}
                  </div>
                </section>
              )}

              <div className="detail-actions">
                <div className="detail-actions__group">
                  <span className="detail-actions__label">Płatność</span>
                  <div className="detail-actions__row">
                    <button
                      type="button"
                      className={`btn btn--primary btn--sm${row.payment_status === 'paid' ? ' detail-actions__btn--on' : ''}`}
                      aria-pressed={row.payment_status === 'paid'}
                      onClick={() => onPaid(row.id)}
                    >
                      Zapłacona
                    </button>
                    <button
                      type="button"
                      className={`btn btn--sm${row.payment_status === 'unpaid' ? ' detail-actions__btn--on' : ''}`}
                      aria-pressed={row.payment_status === 'unpaid'}
                      onClick={() => onUnpaid(row.id)}
                    >
                      Niezapłacona
                    </button>
                  </div>
                </div>
                <div className="detail-actions__group">
                  <span className="detail-actions__label">Przegląd</span>
                  <div className="detail-actions__row">
                    <button
                      type="button"
                      className={`btn btn--sm${row.review_status === 'needs_review' ? ' detail-actions__btn--on' : ''}`}
                      aria-pressed={row.review_status === 'needs_review'}
                      onClick={() => onNeedsReview(row.id)}
                    >
                      Do sprawdzenia
                    </button>
                    <button
                      type="button"
                      className={`btn btn--sm${row.review_status === 'cleared' ? ' detail-actions__btn--on' : ''}`}
                      aria-pressed={row.review_status === 'cleared'}
                      onClick={() => onClearReview(row.id)}
                    >
                      Wyczyść przegląd
                    </button>
                  </div>
                </div>
                <div className="detail-actions__group">
                  <span className="detail-actions__label">Kategoria i typ</span>
                  <div className="detail-actions__row detail-actions__row--category-scope">
                    <label className="field detail-actions__field-category">
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
                    <button
                      type="button"
                      className={`btn btn--sm${row.document_scope === 'business' ? ' detail-actions__btn--on' : ''}`}
                      aria-pressed={row.document_scope === 'business'}
                      onClick={() => onBusiness(row.id)}
                    >
                      Firma
                    </button>
                    <button
                      type="button"
                      className={`btn btn--sm${row.document_scope === 'private' ? ' detail-actions__btn--on' : ''}`}
                      aria-pressed={row.document_scope === 'private'}
                      onClick={() => onPrivate(row.id)}
                    >
                      Prywatna
                    </button>
                  </div>
                </div>
                <div className="detail-actions__group">
                  <span className="detail-actions__label">Duplikaty</span>
                  <div className="detail-actions__row">
                    <button
                      type="button"
                      className={`btn btn--sm btn--danger-outline${row.duplicate_resolution === 'confirmed' ? ' detail-actions__btn--on' : ''}`}
                      aria-pressed={row.duplicate_resolution === 'confirmed'}
                      onClick={() => onConfirmDup(row.id)}
                    >
                      Potwierdź
                    </button>
                    <button
                      type="button"
                      className={`btn btn--sm${row.duplicate_resolution === 'rejected' ? ' detail-actions__btn--on' : ''}`}
                      aria-pressed={row.duplicate_resolution === 'rejected'}
                      onClick={() => onRejectDup(row.id)}
                    >
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
                <div className="detail-source-channel">
                  {row.invoice_status === 'INGESTING' ? (
                    <span className="badge badge--source" title="Przetwarzanie OCR / kolejka">
                      OCR
                    </span>
                  ) : (
                    <SourceBadge type={row.source_type} />
                  )}
                </div>
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
