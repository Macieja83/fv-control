import { useCallback, useEffect, useMemo, useState } from 'react'
import { createContractor, fetchContractors, type ContractorDto } from '../../api/contractorsApi'
import { fetchGusByNip } from '../../api/gusApi'
import { fetchKsefConnectorStatus, type KsefConnectorStatus } from '../../api/ksefApi'
import { getStoredToken } from '../../auth/session'
import {
  calcLineTotals,
  PL_VAT_OPTIONS,
  type PlVatKind,
  roundMoney2,
  vatRateDecimalForApi,
} from '../../lib/plVat'

type LineRow = {
  id: string
  name: string
  gtu: string
  quantity: string
  unit: string
  netPrice: string
  discountPct: string
  vatKind: PlVatKind
}

const UNITS = ['szt.', 'kg', 'm', 'h', 'usł.', 'kpl.', 'l', 'm2', 'm3'] as const

const GTU_CHOICES = [
  '',
  'GTU_01',
  'GTU_02',
  'GTU_03',
  'GTU_04',
  'GTU_05',
  'GTU_06',
  'GTU_07',
  'GTU_08',
  'GTU_09',
  'GTU_10',
  'GTU_11',
  'GTU_12',
  'GTU_13',
] as const

function newLine(): LineRow {
  return {
    id: crypto.randomUUID(),
    name: '',
    gtu: '',
    quantity: '1',
    unit: 'szt.',
    netPrice: '0',
    discountPct: '0',
    vatKind: '23',
  }
}

function suggestNumber(issueDate: string): string {
  const d = issueDate ? new Date(`${issueDate}T12:00:00`) : new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const n = Math.floor(Math.random() * 899) + 100
  return `FS/${y}/${m}/${n}`
}

function parseNum(s: string): number {
  const x = Number(String(s).replace(',', '.').replace(/\s/g, ''))
  return Number.isFinite(x) ? x : 0
}

type Props = {
  open: boolean
  onClose: () => void
  onSubmit: (body: Record<string, unknown>, opts?: { sendToKsef?: boolean }) => Promise<void>
}

export function SalesInvoiceDialog({ open, onClose, onSubmit }: Props) {
  const [contractors, setContractors] = useState<ContractorDto[]>([])
  const [contractorId, setContractorId] = useState('')
  const [contractorQuery, setContractorQuery] = useState('')
  const [contractorInvalid, setContractorInvalid] = useState(false)
  const [number, setNumber] = useState('')
  const [issueDate, setIssueDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [saleDate, setSaleDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [dueDate, setDueDate] = useState('')
  const [paymentTermDays, setPaymentTermDays] = useState(7)
  const [currency, setCurrency] = useState('PLN')
  const [docLang, setDocLang] = useState('pl')
  const [invoiceType, setInvoiceType] = useState('VAT')
  const [paymentMethod, setPaymentMethod] = useState('transfer')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<LineRow[]>(() => [newLine()])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [gusBusy, setGusBusy] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [addName, setAddName] = useState('')
  const [addNip, setAddNip] = useState('')
  const [addAddress, setAddAddress] = useState('')
  const [previewOpen, setPreviewOpen] = useState(false)
  const [ksefConnector, setKsefConnector] = useState<KsefConnectorStatus | null>(null)
  const [sendKsefAfterSave, setSendKsefAfterSave] = useState(false)

  useEffect(() => {
    if (!issueDate) return
    const base = new Date(`${issueDate}T12:00:00`)
    if (Number.isNaN(base.getTime())) return
    const d = new Date(base)
    d.setDate(d.getDate() + paymentTermDays)
    setDueDate(d.toISOString().slice(0, 10))
  }, [issueDate, paymentTermDays])

  useEffect(() => {
    if (!open) return
    setErr(null)
    setContractorInvalid(false)
    setAddOpen(false)
    setPreviewOpen(false)
    setSendKsefAfterSave(false)
    const token = getStoredToken()
    if (!token) return
    void fetchKsefConnectorStatus(token)
      .then(setKsefConnector)
      .catch(() => setKsefConnector(null))
    void fetchContractors(token)
      .then((c) => {
        setContractors(c)
        setContractorId((prev) => prev || (c[0]?.id ?? ''))
      })
      .catch(() => setContractors([]))
  }, [open])

  useEffect(() => {
    if (!open) return
    setNumber((prev) => (prev.trim() ? prev : suggestNumber(issueDate)))
    setSaleDate((sd) => sd || issueDate)
  }, [open, issueDate])

  const filteredContractors = useMemo(() => {
    const q = contractorQuery.trim().toLowerCase()
    const digits = q.replace(/\D/g, '')
    if (!q) return contractors
    return contractors.filter((c) => {
      const nameHit = c.name.toLowerCase().includes(q)
      const nipDigits = c.nip.replace(/\D/g, '')
      const nipHit = digits.length >= 3 && nipDigits.includes(digits)
      return nameHit || nipHit
    })
  }, [contractors, contractorQuery])

  const selectedContractor = useMemo(
    () => contractors.find((c) => c.id === contractorId) ?? null,
    [contractors, contractorId],
  )

  const lineComputed = useMemo(() => {
    return lines.map((l) => {
      const qty = parseNum(l.quantity)
      const netP = parseNum(l.netPrice)
      const disc = parseNum(l.discountPct)
      const { netValue, grossValue } = calcLineTotals({
        quantity: qty,
        netPrice: netP,
        discountPct: disc,
        vatKind: l.vatKind,
      })
      return { netValue, grossValue }
    })
  }, [lines])

  const totals = useMemo(() => {
    let net = 0
    let gross = 0
    for (const r of lineComputed) {
      net += r.netValue
      gross += r.grossValue
    }
    return {
      net: roundMoney2(net),
      vat: roundMoney2(gross - net),
      gross: roundMoney2(gross),
    }
  }, [lineComputed])

  const patchLine = useCallback((id: string, patch: Partial<LineRow>) => {
    setLines((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)))
  }, [])

  const addLine = useCallback(() => setLines((p) => [...p, newLine()]), [])
  const removeLine = useCallback(
    (id: string) => setLines((p) => (p.length > 1 ? p.filter((r) => r.id !== id) : p)),
    [],
  )

  const nipFromQuery = useMemo(() => contractorQuery.replace(/\D/g, '').slice(0, 10), [contractorQuery])

  const runGusLookup = useCallback(async () => {
    setErr(null)
    const token = getStoredToken()
    if (!token) {
      setErr('Brak sesji — zaloguj się ponownie.')
      return
    }
    if (nipFromQuery.length !== 10) {
      setErr('Wpisz 10 cyfr NIP, aby pobrać dane z GUS.')
      return
    }
    setGusBusy(true)
    try {
      const g = await fetchGusByNip(token, nipFromQuery)
      const existing = contractors.find((c) => c.nip.replace(/\D/g, '') === g.nip)
      if (existing) {
        setContractorId(existing.id)
        setContractorQuery(`${existing.name} · NIP ${g.nip}`)
        return
      }
      const created = await createContractor(token, {
        name: g.name,
        nip: g.nip,
        address: g.address || null,
        email: null,
        phone: null,
      })
      setContractors((prev) => [created, ...prev])
      setContractorId(created.id)
      setContractorQuery(`${created.name} · NIP ${g.nip}`)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Nie udało się pobrać danych z GUS.')
    } finally {
      setGusBusy(false)
    }
  }, [nipFromQuery, contractors])

  const saveManualContractor = async () => {
    setErr(null)
    const token = getStoredToken()
    if (!token) {
      setErr('Brak sesji.')
      return
    }
    const nip = addNip.replace(/\D/g, '').slice(0, 10)
    if (!addName.trim() || nip.length !== 10) {
      setErr('Podaj nazwę i poprawny 10-cyfrowy NIP kontrahenta.')
      return
    }
    setBusy(true)
    try {
      const created = await createContractor(token, {
        name: addName.trim(),
        nip,
        address: addAddress.trim() || null,
        email: null,
        phone: null,
      })
      setContractors((prev) => [created, ...prev])
      setContractorId(created.id)
      setContractorQuery(`${created.name} · NIP ${nip}`)
      setAddOpen(false)
      setAddName('')
      setAddNip('')
      setAddAddress('')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Nie udało się zapisać kontrahenta.')
    } finally {
      setBusy(false)
    }
  }

  const buildPayload = useCallback(
    (status: 'RECEIVED' | 'DRAFT') => {
      const payLabels: Record<string, string> = { transfer: 'przelew', cash: 'gotówka', card: 'karta' }
      const metaLines: string[] = []
      if (invoiceType === 'PROFORMA') metaLines.push('Typ dokumentu: pro forma')
      metaLines.push(`Sposób płatności: ${payLabels[paymentMethod] ?? paymentMethod}`)
      const mergedNotes = [notes.trim(), ...metaLines].filter(Boolean).join('\n\n') || null

      const items = lines.map((l) => {
        const qty = parseNum(l.quantity)
        const netP = parseNum(l.netPrice)
        const disc = parseNum(l.discountPct)
        const { netValue, grossValue } = calcLineTotals({
          quantity: qty,
          netPrice: netP,
          discountPct: disc,
          vatKind: l.vatKind,
        })
        const gtuPrefix = l.gtu ? `[${l.gtu}] ` : ''
        const name = `${gtuPrefix}${(l.name || 'Pozycja').trim()}`.trim()
        return {
          name,
          quantity: String(qty),
          unit: l.unit.trim() || null,
          netPrice: netP.toFixed(2),
          vatRate: vatRateDecimalForApi(l.vatKind),
          netValue: netValue.toFixed(2),
          grossValue: grossValue.toFixed(2),
        }
      })
      return {
        ledgerKind: 'SALE',
        contractorId,
        number: number.trim(),
        issueDate,
        saleDate: saleDate.trim() || null,
        dueDate: dueDate.trim() || null,
        currency,
        status,
        notes: mergedNotes,
        items,
      }
    },
    [lines, contractorId, number, issueDate, saleDate, dueDate, currency, notes, invoiceType, paymentMethod],
  )

  const submit = async (status: 'RECEIVED' | 'DRAFT') => {
    setErr(null)
    setContractorInvalid(false)
    if (!contractorId) {
      setContractorInvalid(true)
      setErr('Wybierz lub utwórz kontrahenta (pole „Kontrahent”).')
      return
    }
    if (!number.trim()) {
      setErr('Podaj numer faktury.')
      return
    }
    setBusy(true)
    try {
      await onSubmit(
        buildPayload(status),
        status === 'RECEIVED' && invoiceType === 'VAT' ? { sendToKsef: sendKsefAfterSave } : undefined,
      )
      onClose()
      setNumber('')
      setNotes('')
      setLines([newLine()])
      setContractorId('')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Nie udało się zapisać faktury.')
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  const fmtMoney = (n: number) =>
    n.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  return (
    <div className="modal-overlay" role="presentation" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="modal-content modal-content--sales-inv"
        role="dialog"
        aria-label="Wystaw fakturę sprzedaży"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header sales-inv__header">
          <div className="sales-inv__title-block">
            <h2 className="detail-panel__title">Wystaw fakturę</h2>
            <p className="sales-inv__subtitle mono">{number || '—'}</p>
          </div>
          <div className="sales-inv__header-tools">
            <label className="sales-inv__mini-field">
              <span>Język dokumentu</span>
              <select className="input" value={docLang} onChange={(e) => setDocLang(e.target.value)}>
                <option value="pl">Polski (PL)</option>
                <option value="en">English (EN)</option>
              </select>
            </label>
            <label className="sales-inv__mini-field">
              <span>Waluta</span>
              <select className="input" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                <option value="PLN">PLN</option>
                <option value="EUR">EUR</option>
                <option value="USD">USD</option>
              </select>
            </label>
            <button type="button" className="modal-close" onClick={onClose} aria-label="Zamknij">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="modal-body sales-inv__body">
          {err && (
            <div className="sales-inv__alert" role="alert">
              {err}
            </div>
          )}

          <div className="sales-inv__grid-top">
            <div className="sales-inv__card">
              <label className="field">
                <span className="field__label">
                  Kontrahent <span className="sales-inv__req">*</span>
                </span>
                <input
                  className={`input${contractorInvalid ? ' input--invalid' : ''}`}
                  placeholder="Kogo szukasz? (nazwa lub NIP)"
                  value={contractorQuery}
                  onChange={(e) => {
                    setContractorQuery(e.target.value)
                    setContractorInvalid(false)
                  }}
                  onBlur={() => {
                    const t = contractorQuery.trim()
                    const hit = contractors.find((c) => `${c.name} · ${c.nip}` === t)
                    if (hit) setContractorId(hit.id)
                  }}
                  list="sales-inv-contractors"
                />
                <datalist id="sales-inv-contractors">
                  {contractors.map((c) => (
                    <option key={c.id} value={`${c.name} · ${c.nip}`} />
                  ))}
                </datalist>
              </label>
              {contractorQuery.trim().length > 0 && filteredContractors.length > 0 && (
                <ul className="sales-inv__pick-list">
                  {filteredContractors.slice(0, 8).map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        className="sales-inv__pick-item"
                        onClick={() => {
                          setContractorId(c.id)
                          setContractorQuery(`${c.name} · ${c.nip}`)
                          setContractorInvalid(false)
                        }}
                      >
                        <span className="sales-inv__pick-name">{c.name}</span>
                        <span className="sales-inv__pick-nip mono">{c.nip}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="sales-inv__kontrahent-actions">
                <button type="button" className="btn btn--link" onClick={() => setAddOpen((v) => !v)}>
                  + Dodaj nowego
                </button>
                <button
                  type="button"
                  className="btn btn--sm"
                  disabled={gusBusy || nipFromQuery.length !== 10}
                  onClick={() => void runGusLookup()}
                >
                  {gusBusy ? 'GUS…' : 'Pobierz z GUS (NIP)'}
                </button>
              </div>
              {selectedContractor && (
                <p className="workspace-panel__muted sales-inv__selected-hint">
                  Wybrany: <strong>{selectedContractor.name}</strong> · NIP {selectedContractor.nip}
                </p>
              )}
              {addOpen && (
                <div className="sales-inv__add-panel">
                  <label className="field">
                    <span className="field__label">Nazwa</span>
                    <input className="input" value={addName} onChange={(e) => setAddName(e.target.value)} />
                  </label>
                  <label className="field">
                    <span className="field__label">NIP (10 cyfr)</span>
                    <input className="input mono" value={addNip} onChange={(e) => setAddNip(e.target.value)} />
                  </label>
                  <label className="field">
                    <span className="field__label">Adres (opcjonalnie)</span>
                    <input className="input" value={addAddress} onChange={(e) => setAddAddress(e.target.value)} />
                  </label>
                  <button type="button" className="btn btn--primary btn--sm" disabled={busy} onClick={() => void saveManualContractor()}>
                    Zapisz kontrahenta
                  </button>
                </div>
              )}
            </div>

            <div className="sales-inv__card">
              <div className="sales-inv__dates">
                <label className="field">
                  <span className="field__label">Data wystawienia</span>
                  <input type="date" className="input" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
                </label>
                <label className="field">
                  <span className="field__label">Data sprzedaży</span>
                  <input type="date" className="input" value={saleDate} onChange={(e) => setSaleDate(e.target.value)} />
                </label>
                <label className="field">
                  <span className="field__label">Termin płatności</span>
                  <select
                    className="input"
                    value={String(paymentTermDays)}
                    onChange={(e) => setPaymentTermDays(Number(e.target.value))}
                  >
                    <option value="0">w dniu wystawienia</option>
                    <option value="7">7 dni</option>
                    <option value="14">14 dni</option>
                    <option value="21">21 dni</option>
                    <option value="30">30 dni</option>
                    <option value="45">45 dni</option>
                    <option value="60">60 dni</option>
                  </select>
                </label>
                <label className="field">
                  <span className="field__label">Data płatności</span>
                  <input type="date" className="input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                </label>
              </div>
            </div>

            <div className="sales-inv__card">
              <label className="field">
                <span className="field__label">Typ</span>
                <select className="input" value={invoiceType} onChange={(e) => setInvoiceType(e.target.value)}>
                  <option value="VAT">Faktura VAT</option>
                  <option value="PROFORMA">Pro forma</option>
                </select>
              </label>
              <label className="field">
                <span className="field__label">Sposób płatności</span>
                <select className="input" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                  <option value="transfer">Przelew</option>
                  <option value="cash">Gotówka</option>
                  <option value="card">Karta</option>
                </select>
              </label>
              <label className="field">
                <span className="field__label">Numer faktury</span>
                <input className="input mono" value={number} onChange={(e) => setNumber(e.target.value)} placeholder="np. FS/2026/04/12" />
              </label>
            </div>
          </div>

          <div className="sales-inv__lines-wrap">
            <div className="sales-inv__lines-head">Nazwa towaru lub usługi · GTU · ilość · cena · VAT</div>
            <div className="sales-inv__lines-scroll">
              <table className="sales-inv__table">
                <thead>
                  <tr>
                    <th>Nazwa *</th>
                    <th>GTU</th>
                    <th>Ilość</th>
                    <th>J.m.</th>
                    <th>Cena netto</th>
                    <th>Rabat %</th>
                    <th>Stawka VAT</th>
                    <th>Netto</th>
                    <th>Brutto</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, idx) => {
                    const { netValue, grossValue } = lineComputed[idx] ?? { netValue: 0, grossValue: 0 }
                    return (
                      <tr key={l.id}>
                        <td>
                          <input className="input input--table" value={l.name} onChange={(e) => patchLine(l.id, { name: e.target.value })} />
                        </td>
                        <td>
                          <select className="input input--table" value={l.gtu} onChange={(e) => patchLine(l.id, { gtu: e.target.value })}>
                            {GTU_CHOICES.map((g) => (
                              <option key={g || '—'} value={g}>
                                {g || '—'}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input
                            className="input input--table mono"
                            value={l.quantity}
                            onChange={(e) => patchLine(l.id, { quantity: e.target.value })}
                          />
                        </td>
                        <td>
                          <select className="input input--table" value={l.unit} onChange={(e) => patchLine(l.id, { unit: e.target.value })}>
                            {UNITS.map((u) => (
                              <option key={u} value={u}>
                                {u}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input
                            className="input input--table mono"
                            value={l.netPrice}
                            onChange={(e) => patchLine(l.id, { netPrice: e.target.value })}
                          />
                        </td>
                        <td>
                          <input
                            className="input input--table mono"
                            value={l.discountPct}
                            onChange={(e) => patchLine(l.id, { discountPct: e.target.value })}
                          />
                        </td>
                        <td>
                          <select
                            className="input input--table"
                            value={l.vatKind}
                            onChange={(e) => patchLine(l.id, { vatKind: e.target.value as PlVatKind })}
                          >
                            {PL_VAT_OPTIONS.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="mono sales-inv__ro">{fmtMoney(netValue)}</td>
                        <td className="mono sales-inv__ro">{fmtMoney(grossValue)}</td>
                        <td>
                          <button type="button" className="btn-icon-del" aria-label="Usuń wiersz" onClick={() => removeLine(l.id)}>
                            ×
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <button type="button" className="sales-inv__fab-add" onClick={addLine} aria-label="Dodaj pozycję">
              +
            </button>
          </div>

          <label className="field sales-inv__notes">
            <span className="field__label">Uwagi</span>
            <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opcjonalnie…" />
          </label>

          <div className="sales-inv__footer">
            <div className="sales-inv__toggles workspace-panel__muted">
              <label className="sales-inv__toggle">
                <input type="checkbox" disabled /> Załączniki
              </label>
              <label className="sales-inv__toggle">
                <input type="checkbox" disabled /> Wyślij e-mail
              </label>
              <label className="sales-inv__toggle">
                <input type="checkbox" disabled /> Split payment
              </label>
              <label className="sales-inv__toggle">
                <input type="checkbox" defaultChecked disabled /> Przypomnienie o płatności
              </label>
            </div>
            <div className="sales-inv__totals">
              <div>
                <span>Razem netto</span>
                <strong className="mono">
                  {fmtMoney(totals.net)} {currency}
                </strong>
              </div>
              <div>
                <span>VAT</span>
                <strong className="mono">
                  {fmtMoney(totals.vat)} {currency}
                </strong>
              </div>
              <div>
                <span>Razem brutto</span>
                <strong className="mono">
                  {fmtMoney(totals.gross)} {currency}
                </strong>
              </div>
            </div>
          </div>

          <div className="sales-inv__actions">
            {invoiceType === 'VAT' && ksefConnector && (
              <label className="sales-inv__ksef-opt">
                <input
                  type="checkbox"
                  checked={sendKsefAfterSave}
                  onChange={(e) => setSendKsefAfterSave(e.target.checked)}
                  disabled={busy}
                />
                <span>
                  Po zapisaniu wyślij do KSeF
                  {ksefConnector.issuanceLiveReady
                    ? ' (API Ministerstwa Finansów)'
                    : ksefConnector.configured
                      ? ' (tryb stub — tylko status w aplikacji; ustaw KSEF_ISSUANCE_MODE=live dla MF)'
                      : ' — skonfiguruj KSEF_TOKEN i KSEF_NIP na serwerze'}
                </span>
              </label>
            )}
            <div className="sales-inv__actions-row">
              <button type="button" className="btn" onClick={() => setPreviewOpen(true)} disabled={busy}>
                Podgląd
              </button>
              <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void submit('RECEIVED')}>
                {busy ? 'Zapisywanie…' : 'Wystaw'}
              </button>
              <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => void submit('DRAFT')}>
                Zapisz szkic
              </button>
            </div>
          </div>
        </div>
      </div>

      {previewOpen && (
        <div className="sales-inv__preview-overlay" role="presentation" onClick={() => setPreviewOpen(false)}>
          <div className="sales-inv__preview-card" role="dialog" onClick={(e) => e.stopPropagation()}>
            <h3 className="detail-panel__title">Podgląd faktury</h3>
            <p className="workspace-panel__muted">
              {number} · {issueDate} · {selectedContractor?.name ?? '—'}
            </p>
            <table className="sales-inv__preview-table">
              <tbody>
                {lines.map((l, i) => (
                  <tr key={l.id}>
                    <td>{(l.name || '—').slice(0, 48)}</td>
                    <td className="mono">{fmtMoney(lineComputed[i]?.netValue ?? 0)}</td>
                    <td className="mono">{fmtMoney(lineComputed[i]?.grossValue ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mono sales-inv__preview-sum">
              Brutto: {fmtMoney(totals.gross)} {currency}
            </p>
            <button type="button" className="btn btn--sm" onClick={() => setPreviewOpen(false)}>
              Zamknij
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
