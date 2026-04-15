import { useCallback, useEffect, useState } from 'react'
import {
  fetchPlatformKsefOverview,
  fetchPlatformTenants,
  issueImpersonationToken,
  type PlatformAdminKsefRow,
  type PlatformTenantRow,
} from '../../api/platformAdminApi'
import { getStoredToken, setStoredToken } from '../../auth/session'

function planLabel(planCode: string | null | undefined): string {
  const c = (planCode ?? '').toLowerCase()
  if (c === 'free') return 'Podstawowy (Free)'
  if (c === 'pro') return 'PRO'
  return planCode ?? '—'
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' })
  } catch {
    return iso
  }
}

/**
 * Panel operatora platformy — lista tenantów z rejestracji, plany, wejście na konto (impersonacja).
 * Widoczny tylko dla `user.isPlatformAdmin`.
 */
export function AdminPanel() {
  const [rows, setRows] = useState<PlatformTenantRow[]>([])
  const [ksefRows, setKsefRows] = useState<PlatformAdminKsefRow[]>([])
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
      const [data, ksef] = await Promise.all([fetchPlatformTenants(token), fetchPlatformKsefOverview(token, 200)])
      setRows(data)
      setKsefRows(ksef)
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const onImpersonate = async (tenantId: string) => {
    const token = getStoredToken()
    if (!token) return
    try {
      const newToken = await issueImpersonationToken(token, tenantId)
      setStoredToken(newToken)
      window.location.reload()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="workspace-panel">
      <header className="workspace-panel__head">
        <div>
          <h2 className="workspace-panel__title">Admin — klienci platformy</h2>
          <p className="workspace-panel__lead">
            Konta firm utworzone przez rejestrację na stronie. Możesz sprawdzić plan (Free / PRO), dane firmy i wejść na ich
            workspace (faktury w kontekście tenanta).
          </p>
        </div>
      </header>

      {err && <p className="workspace-panel__err">{err}</p>}

      {loading && <p className="workspace-panel__muted">Ładowanie…</p>}

      {!loading && rows.length === 0 && <p className="workspace-panel__muted">Brak zarejestrowanych tenantów.</p>}

      {!loading && rows.length > 0 && (
        <div className="settings-superadmin-list">
          {rows.map((t) => (
            <div key={t.id} className="settings-superadmin-item">
              <div>
                <strong>{t.name}</strong>{' '}
                <span className="workspace-panel__muted">
                  · NIP: {t.nip?.trim() || '—'} · ID: {t.id.slice(0, 8)}…
                </span>
                <div className="workspace-panel__muted">
                  Zarejestrowano: {formatDate(t.createdAt)} · Użytkownicy: {t.userCount} · Faktury: {t.invoiceCount} · Plan:{' '}
                  <strong>{planLabel(t.subscription?.planCode)}</strong> · Status:{' '}
                  <strong>{t.subscription?.status ?? '—'}</strong>
                  {t.subscription?.provider ? (
                    <>
                      {' '}
                      · Rozliczenia: {t.subscription.provider}
                    </>
                  ) : null}
                </div>
              </div>
              <button type="button" className="btn-ghost" onClick={() => void onImpersonate(t.id)}>
                Wejdź na konto
              </button>
            </div>
          ))}
        </div>
      )}

      <section className="integration-card integration-card--tight" style={{ marginTop: 24 }}>
        <h3 className="workspace-panel__h3">KSeF — podgląd (bez sekretów)</h3>
        <p className="workspace-panel__muted">
          Środowisko API, źródło poświadczeń, HWM i ostatnia telemetria sync/kolejki. Szczegóły po wejściu na konto
          (Płatności).
        </p>
        {!loading && ksefRows.length > 0 && (
          <div className="settings-superadmin-list" style={{ marginTop: 12 }}>
            {ksefRows.map((k) => (
              <div key={k.tenantId} className="settings-superadmin-item" style={{ alignItems: 'flex-start' }}>
                <div>
                  <strong>{k.name}</strong>{' '}
                  <span className="workspace-panel__muted">
                    · NIP: {k.nip?.trim() || '—'} · API: <strong>{k.effectiveKsefEnv}</strong>
                    {k.ksefEnvOverride ? (
                      <>
                        {' '}
                        (override: {k.ksefEnvOverride})
                      </>
                    ) : null}
                    {' · '}
                    serwer KSEF_ENV: <span className="mono">{k.serverKsefEnv}</span>
                  </span>
                  <div className="workspace-panel__muted">
                    Poświadczenia: <strong>{k.credentialSource}</strong> · Faktury KSeF w bazie: {k.ksefInvoiceCount}
                    {k.lastSyncRunAt ? (
                      <>
                        {' '}
                        · ostatni sync: {formatDate(k.lastSyncRunAt)}
                        {k.lastSyncOk != null ? ` (${k.lastSyncOk ? 'OK' : 'błąd'})` : ''}
                        {k.lastSyncPhase ? ` · ${k.lastSyncPhase}` : ''}
                      </>
                    ) : null}
                  </div>
                  {k.lastSyncErrorPreview && (
                    <div className="workspace-panel__err" style={{ fontSize: '0.85rem', marginTop: 4 }}>
                      Sync: {k.lastSyncErrorPreview.slice(0, 200)}
                      {k.lastSyncErrorPreview.length > 200 ? '…' : ''}
                    </div>
                  )}
                  {k.lastQueueFinalFailure === true && k.lastQueueError && (
                    <div className="workspace-panel__err" style={{ fontSize: '0.85rem', marginTop: 4 }}>
                      Kolejka (wyczerpane retry): {k.lastQueueError.slice(0, 200)}
                      {k.lastQueueError.length > 200 ? '…' : ''}
                    </div>
                  )}
                </div>
                <button type="button" className="btn-ghost" onClick={() => void onImpersonate(k.tenantId)}>
                  Wejdź
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="integration-card integration-card--tight" style={{ marginTop: 24 }}>
        <h3 className="workspace-panel__h3">Stripe</h3>
        <p className="workspace-panel__muted">
          Checkout i portal klienta Stripe są używane przez tenantów w zakładce <strong>Plan</strong>. Tutaj widzisz listę
          workspace’ów; szczegóły płatności w Stripe Dashboard oraz pola <span className="mono">STRIPE_*</span> w{' '}
          <span className="mono">backend/.env</span>.
        </p>
      </section>
    </div>
  )
}
