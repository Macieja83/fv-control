import { useCallback, useEffect, useState } from 'react'
import { fetchTenantProfile, patchTenantIntegrations, type TenantProfileResponse } from '../../api/tenantApi'
import { getStoredToken } from '../../auth/session'

const BANKS = [
  'PKO BP',
  'mBank',
  'ING',
  'Santander',
  'Millennium',
  'Alior Bank',
  'BNP Paribas',
  'Pekao S.A.',
  'Velo Bank',
  'Nest Bank',
  'Inteligo',
  'Credit Agricole',
]

export function PaymentsPanel() {
  const [state, setState] = useState<TenantProfileResponse['portalIntegrations'] | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    const token = getStoredToken()
    if (!token) {
      setErr('Brak sesji.')
      setLoading(false)
      return
    }
    setLoading(true)
    setErr(null)
    try {
      const t = await fetchTenantProfile(token)
      setState(t.portalIntegrations)
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const connectBank = async (label: string) => {
    const token = getStoredToken()
    if (!token) return
    try {
      const next = await patchTenantIntegrations(token, { bankConnected: true, bankLabel: label })
      setState(next)
    } catch (e: unknown) {
      window.alert(e instanceof Error ? e.message : String(e))
    }
  }

  const clearBank = async () => {
    const token = getStoredToken()
    if (!token) return
    try {
      const next = await patchTenantIntegrations(token, { bankConnected: false, bankLabel: null })
      setState(next)
    } catch (e: unknown) {
      window.alert(e instanceof Error ? e.message : String(e))
    }
  }

  const toggleKsef = async () => {
    const token = getStoredToken()
    if (!token) return
    try {
      const next = await patchTenantIntegrations(token, { ksefConfigured: !state?.ksefConfigured })
      setState(next)
    } catch (e: unknown) {
      window.alert(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="workspace-panel">
      <header className="workspace-panel__head">
        <div>
          <h2 className="workspace-panel__title">Płatności</h2>
          <p className="workspace-panel__lead">
            Płatności <strong>za faktury do kontrahentów</strong> to przelew na konto z faktury (szczegóły faktury) lub przyszła
            integracja <strong>PISP</strong> (inicjacja w banku). Subskrypcja PRO aplikacji jest w <strong>Ustawieniach</strong>{' '}
            (Stripe).
          </p>
        </div>
      </header>

      {loading && <p className="workspace-panel__muted">Ładowanie…</p>}
      {err && <p className="workspace-panel__err">{err}</p>}

      {state && (
        <>
          <section className="integration-card">
            <h3 className="workspace-panel__h3">Konto bankowe</h3>
            {state.bankConnected ? (
              <div>
                <p>
                  Połączono: <strong>{state.bankLabel ?? '—'}</strong>
                </p>
                <button type="button" className="btn-ghost" onClick={() => void clearBank()}>
                  Rozłącz
                </button>
              </div>
            ) : (
              <>
                <p className="workspace-panel__muted">Wybierz bank, z którym chcesz powiązać konto (symulacja zgody).</p>
                <div className="bank-grid">
                  {BANKS.map((b) => (
                    <button key={b} type="button" className="bank-grid__tile" onClick={() => void connectBank(b)}>
                      {b}
                    </button>
                  ))}
                </div>
              </>
            )}
          </section>

          <section className="integration-card">
            <h3 className="workspace-panel__h3">KSeF (klient)</h3>
            <p className="workspace-panel__muted">
              Oznacz, że certyfikat / token KSeF został skonfigurowany po stronie integracji (szczegóły w dokumentacji
              serwera). Tu tylko flaga operacyjna dla zespołu.
            </p>
            <label className="toggle-line">
              <input type="checkbox" checked={state.ksefConfigured} onChange={() => void toggleKsef()} />
              <span>KSeF skonfigurowany dla tej firmy</span>
            </label>
          </section>
        </>
      )}
    </div>
  )
}
