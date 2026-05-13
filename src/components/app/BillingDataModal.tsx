import { useEffect, useState } from 'react'
import {
  fetchTenantBillingData,
  patchTenantBillingData,
  type BillingCompanyData,
} from '../../api/tenantApi'
import { getStoredToken } from '../../auth/session'
import './billing-data-modal.css'

type Props = {
  open: boolean
  onClose: () => void
  onSuccess: () => void
}

export function BillingDataModal({ open, onClose, onSuccess }: Props) {
  const [legalName, setLegalName] = useState('')
  const [nip, setNip] = useState('')
  const [address, setAddress] = useState('')
  const [invoiceEmail, setInvoiceEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const token = getStoredToken()
    if (!token) {
      setMsg('Brak sesji.')
      return
    }
    let cancelled = false
    setLoading(true)
    setMsg(null)
    void fetchTenantBillingData(token)
      .then((res) => {
        if (cancelled) return
        if (res.data) {
          setLegalName(res.data.legalName)
          setNip(res.data.nip)
          setAddress(res.data.address)
          setInvoiceEmail(res.data.invoiceEmail)
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setMsg(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  if (!open) return null

  const validate = (): string | null => {
    const trimmedLegal = legalName.trim()
    const stripNip = nip.replace(/\D/g, '')
    const trimmedAddr = address.trim()
    const trimmedEmail = invoiceEmail.trim().toLowerCase()
    if (trimmedLegal.length < 3) return 'Nazwa firmy: minimum 3 znaki.'
    if (trimmedLegal.length > 200) return 'Nazwa firmy: maksimum 200 znaków.'
    if (stripNip.length !== 10) return 'NIP musi mieć dokładnie 10 cyfr.'
    if (trimmedAddr.length < 10) return 'Adres: minimum 10 znaków.'
    if (trimmedAddr.length > 500) return 'Adres: maksimum 500 znaków.'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) return 'Nieprawidłowy email.'
    return null
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const err = validate()
    if (err) {
      setMsg(err)
      return
    }
    const token = getStoredToken()
    if (!token) {
      setMsg('Brak sesji.')
      return
    }
    setBusy(true)
    setMsg(null)
    try {
      const payload: BillingCompanyData = {
        legalName: legalName.trim(),
        nip: nip.replace(/\D/g, ''),
        address: address.trim(),
        invoiceEmail: invoiceEmail.trim().toLowerCase(),
      }
      await patchTenantBillingData(token, payload)
      onSuccess()
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="billing-data-modal__backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bdm-title"
    >
      <div className="billing-data-modal">
        <header className="billing-data-modal__head">
          <h2 id="bdm-title" className="billing-data-modal__title">
            Dane do faktury VAT za subskrypcję PRO
          </h2>
          <button
            type="button"
            className="billing-data-modal__close"
            onClick={onClose}
            aria-label="Zamknij"
            disabled={busy}
          >
            ×
          </button>
        </header>
        <p className="billing-data-modal__lead">
          Zanim przejdziesz do płatności BLIK albo kartą, uzupełnij dane firmy — wystawimy
          fakturę VAT za subskrypcję i wyślemy ją do KSeF + na podany email.
        </p>
        <form className="billing-data-modal__form" onSubmit={(e) => void onSubmit(e)}>
          <label>
            <span>Pełna nazwa firmy</span>
            <input
              type="text"
              value={legalName}
              onChange={(e) => setLegalName(e.target.value)}
              disabled={busy || loading}
              maxLength={200}
              required
              placeholder="np. Tutto Pizza Spółka z o.o."
              autoComplete="organization"
            />
          </label>
          <label>
            <span>NIP (10 cyfr)</span>
            <input
              type="text"
              inputMode="numeric"
              value={nip}
              onChange={(e) => setNip(e.target.value)}
              disabled={busy || loading}
              maxLength={20}
              required
              placeholder="1234567890"
            />
          </label>
          <label>
            <span>Adres siedziby</span>
            <textarea
              rows={3}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              disabled={busy || loading}
              maxLength={500}
              required
              placeholder="ul. Przykładowa 1/2, 00-000 Warszawa"
              autoComplete="street-address"
            />
          </label>
          <label>
            <span>Email do faktury</span>
            <input
              type="email"
              value={invoiceEmail}
              onChange={(e) => setInvoiceEmail(e.target.value)}
              disabled={busy || loading}
              required
              placeholder="ksiegowa@firma.pl"
              autoComplete="email"
            />
          </label>
          {msg && <p className="billing-data-modal__msg">{msg}</p>}
          <div className="billing-data-modal__actions">
            <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>
              Anuluj
            </button>
            <button type="submit" className="btn-primary" disabled={busy || loading}>
              {busy ? 'Zapisywanie…' : loading ? 'Ładowanie…' : 'Zapisz i kontynuuj'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
