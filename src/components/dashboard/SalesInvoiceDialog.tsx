import { useCallback, useEffect, useState } from 'react'
import { fetchContractors, type ContractorDto } from '../../api/contractorsApi'
import { getStoredToken } from '../../auth/session'

type Line = { name: string; quantity: string; unit: string; netPrice: string; vatRate: string }

const emptyLine = (): Line => ({
  name: 'Usługa / towar',
  quantity: '1',
  unit: 'szt.',
  netPrice: '100.00',
  vatRate: '23',
})

type Props = {
  open: boolean
  onClose: () => void
  onSubmit: (body: Record<string, unknown>) => Promise<void>
}

export function SalesInvoiceDialog({ open, onClose, onSubmit }: Props) {
  const [contractors, setContractors] = useState<ContractorDto[]>([])
  const [contractorId, setContractorId] = useState('')
  const [number, setNumber] = useState('')
  const [issueDate, setIssueDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [dueDate, setDueDate] = useState('')
  const [lines, setLines] = useState<Line[]>([emptyLine()])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setErr(null)
    const token = getStoredToken()
    if (!token) return
    void fetchContractors(token)
      .then((c) => {
        setContractors(c)
        setContractorId((prev) => prev || (c[0]?.id ?? ''))
      })
      .catch(() => setContractors([]))
  }, [open])

  const patchLine = useCallback((i: number, patch: Partial<Line>) => {
    setLines((prev) => prev.map((row, j) => (j === i ? { ...row, ...patch } : row)))
  }, [])

  const addLine = useCallback(() => setLines((p) => [...p, emptyLine()]), [])
  const removeLine = useCallback((i: number) => setLines((p) => (p.length > 1 ? p.filter((_, j) => j !== i) : p)), [])

  const submit = async () => {
    setErr(null)
    if (!contractorId) {
      setErr('Wybierz nabywcę (kontrahenta).')
      return
    }
    if (!number.trim()) {
      setErr('Podaj numer faktury.')
      return
    }
    const items = lines.map((l) => {
      const qty = Number(l.quantity.replace(',', '.'))
      const netP = Number(l.netPrice.replace(',', '.'))
      const vatRt = Number(l.vatRate.replace(',', '.'))
      const netVal = qty * netP
      const grossVal = netVal * (1 + vatRt / 100)
      return {
        name: l.name.trim() || 'Pozycja',
        quantity: String(qty),
        unit: l.unit.trim() || null,
        netPrice: netP.toFixed(2),
        vatRate: vatRt.toFixed(2),
        netValue: netVal.toFixed(2),
        grossValue: grossVal.toFixed(2),
      }
    })
    setBusy(true)
    try {
      await onSubmit({
        ledgerKind: 'SALE',
        contractorId,
        number: number.trim(),
        issueDate,
        dueDate: dueDate.trim() || null,
        currency: 'PLN',
        status: 'RECEIVED',
        items,
      })
      onClose()
      setNumber('')
      setLines([emptyLine()])
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Nie udało się zapisać faktury.')
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  return (
    <div className="modal-overlay" role="presentation" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-content" role="dialog" aria-label="Nowa faktura sprzedaży">
        <div className="modal-header">
          <div>
            <h2 className="detail-panel__title">Nowa faktura sprzedaży</h2>
            <p className="workspace-panel__muted" style={{ marginTop: 4 }}>
              Nabywca z listy kontrahentów, pozycje z netto i stawką VAT. Po zapisie faktura trafia do KSeF (status
              „do wystawienia”) — wyślij z panelu szczegółów.
            </p>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Zamknij">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </div>
        <div className="modal-body">
          {err && <p className="workspace-panel__muted" style={{ color: 'var(--danger, #c0392b)', marginBottom: 8 }}>{err}</p>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
            <label className="field">
              <span className="field__label">Nabywca</span>
              <select className="input" value={contractorId} onChange={(e) => setContractorId(e.target.value)}>
                <option value="">— wybierz —</option>
                {contractors.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} · {c.nip}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field__label">Numer faktury</span>
              <input className="input mono" value={number} onChange={(e) => setNumber(e.target.value)} placeholder="np. FV/04/2026/12" />
            </label>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <label className="field" style={{ flex: 1, minWidth: 140 }}>
                <span className="field__label">Data wystawienia</span>
                <input type="date" className="input" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
              </label>
              <label className="field" style={{ flex: 1, minWidth: 140 }}>
                <span className="field__label">Termin płatności</span>
                <input type="date" className="input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </label>
            </div>
            <h3 className="detail-panel__title" style={{ fontSize: '0.95rem', marginTop: 8 }}>Pozycje</h3>
            {lines.map((l, i) => (
              <div
                key={i}
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-xs)',
                  padding: '0.5rem',
                  display: 'grid',
                  gap: 8,
                  gridTemplateColumns: '1fr 72px 72px 88px 64px',
                  alignItems: 'end',
                }}
              >
                <label className="field">
                  <span className="field__label">Nazwa</span>
                  <input className="input" value={l.name} onChange={(e) => patchLine(i, { name: e.target.value })} />
                </label>
                <label className="field">
                  <span className="field__label">Ilość</span>
                  <input className="input mono" value={l.quantity} onChange={(e) => patchLine(i, { quantity: e.target.value })} />
                </label>
                <label className="field">
                  <span className="field__label">j.m.</span>
                  <input className="input" value={l.unit} onChange={(e) => patchLine(i, { unit: e.target.value })} />
                </label>
                <label className="field">
                  <span className="field__label">Cena netto</span>
                  <input className="input mono" value={l.netPrice} onChange={(e) => patchLine(i, { netPrice: e.target.value })} />
                </label>
                <label className="field">
                  <span className="field__label">VAT %</span>
                  <input className="input mono" value={l.vatRate} onChange={(e) => patchLine(i, { vatRate: e.target.value })} />
                </label>
                <button type="button" className="btn btn--sm btn--ghost" style={{ gridColumn: '1 / -1' }} onClick={() => removeLine(i)}>
                  Usuń pozycję
                </button>
              </div>
            ))}
            <button type="button" className="btn btn--sm" onClick={addLine}>
              + Pozycja
            </button>
          </div>
          <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn" onClick={onClose} disabled={busy}>
              Anuluj
            </button>
            <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void submit()}>
              {busy ? 'Zapisywanie…' : 'Zapisz fakturę'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
