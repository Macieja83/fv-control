import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  fetchConnectorsPlatformSummary,
  fetchPlatformKsefOverview,
  fetchPlatformTenants,
  fetchWebhookDlqPlatform,
  issueImpersonationToken,
  type ConnectorsPlatformRow,
  type PlatformAdminKsefRow,
  type PlatformTenantRow,
  type WebhookDlqPlatformSummary,
} from '../../api/platformAdminApi'
import { IMPERSONATION_RESTORE_TOKEN_KEY, getStoredToken, setStoredToken } from '../../auth/session'

function planLabel(planCode: string | null | undefined): string {
  const c = (planCode ?? '').toLowerCase()
  if (c === 'free') return 'Podstawowy (Free)'
  if (c === 'pro') return 'PRO'
  return planCode ?? '—'
}

function formatDate(iso: string | null | undefined) {
  if (iso == null || iso === '') return '—'
  try {
    return new Date(iso).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' })
  } catch {
    return iso
  }
}

type SortKey = 'name' | 'createdAt' | 'users' | 'plan'

/**
 * Panel operatora platformy — lista tenantów z rejestracji, plany, wejście na konto (impersonacja).
 * Widoczny tylko dla `user.isPlatformAdmin`.
 */
export function AdminPanel() {
  const [rows, setRows] = useState<PlatformTenantRow[]>([])
  const [ksefRows, setKsefRows] = useState<PlatformAdminKsefRow[]>([])
  const [dlq, setDlq] = useState<WebhookDlqPlatformSummary | null>(null)
  const [connectors, setConnectors] = useState<ConnectorsPlatformRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('createdAt')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

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
      const [data, ksef, dlqData, conn] = await Promise.all([
        fetchPlatformTenants(token),
        fetchPlatformKsefOverview(token, 200),
        fetchWebhookDlqPlatform(token, 120),
        fetchConnectorsPlatformSummary(token),
      ])
      setRows(data)
      setKsefRows(ksef)
      setDlq(dlqData)
      setConnectors(conn)
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const filteredSorted = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = rows
    if (q) {
      list = rows.filter((t) => {
        const plan = t.subscription?.planCode ?? ''
        const st = t.subscription?.status ?? ''
        const nip = t.nip ?? ''
        return (
          t.name.toLowerCase().includes(q) ||
          t.id.toLowerCase().includes(q) ||
          nip.toLowerCase().includes(q) ||
          plan.toLowerCase().includes(q) ||
          st.toLowerCase().includes(q)
        )
      })
    }
    const dir = sortDir === 'asc' ? 1 : -1
    const sorted = [...list].sort((a, b) => {
      if (sortKey === 'name') return a.name.localeCompare(b.name, 'pl') * dir
      if (sortKey === 'createdAt') return (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * dir
      if (sortKey === 'users') return (a.userCount - b.userCount) * dir
      if (sortKey === 'plan') {
        const pa = (a.subscription?.planCode ?? '').localeCompare(b.subscription?.planCode ?? '', 'pl')
        return pa * dir
      }
      return 0
    })
    return sorted
  }, [rows, query, sortKey, sortDir])

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(key)
      setSortDir(key === 'name' ? 'asc' : 'desc')
    }
  }

  const onImpersonate = async (tenantId: string) => {
    const token = getStoredToken()
    if (!token) return
    try {
      const newToken = await issueImpersonationToken(token, tenantId)
      try {
        sessionStorage.setItem(IMPERSONATION_RESTORE_TOKEN_KEY, token)
      } catch {
        /* ignore */
      }
      setStoredToken(newToken)
      window.location.reload()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="workspace-panel">
      <header className="workspace-panel__head workspace-panel__head--split">
        <div>
          <h2 className="workspace-panel__title">Admin — klienci platformy</h2>
          <p className="workspace-panel__lead">
            Konta firm utworzone przez rejestrację na stronie. Możesz sprawdzić plan (Free / PRO), dane firmy, Stripe (jeśli
            podłączone) i wejść na ich workspace (faktury w kontekście tenanta).
          </p>
        </div>
        <div className="workspace-panel__head-actions">
          <button type="button" className="btn-ghost" onClick={() => void load()} disabled={loading}>
            Odśwież
          </button>
        </div>
      </header>

      {err && <p className="workspace-panel__err">{err}</p>}

      {loading && <p className="workspace-panel__muted">Ładowanie…</p>}

      {!loading && rows.length === 0 && <p className="workspace-panel__muted">Brak zarejestrowanych tenantów.</p>}

      {!loading && rows.length > 0 && (
        <>
          <div className="workspace-panel__toolbar" style={{ marginBottom: 12 }}>
            <label className="workspace-panel__toolbar-label">
              Szukaj
              <input
                type="search"
                className="workspace-panel__search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Nazwa, NIP, ID, plan…"
                autoComplete="off"
              />
            </label>
            <div className="workspace-panel__muted" style={{ alignSelf: 'center' }}>
              Wyniki: {filteredSorted.length} / {rows.length}
            </div>
          </div>
          <div className="workspace-panel__sort workspace-panel__muted" style={{ marginBottom: 8, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            Sortuj:
            <button type="button" className={sortKey === 'createdAt' ? 'btn-ghost btn-ghost--active' : 'btn-ghost'} onClick={() => toggleSort('createdAt')}>
              Data rejestracji{sortKey === 'createdAt' ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}
            </button>
            <button type="button" className={sortKey === 'name' ? 'btn-ghost btn-ghost--active' : 'btn-ghost'} onClick={() => toggleSort('name')}>
              Nazwa{sortKey === 'name' ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}
            </button>
            <button type="button" className={sortKey === 'users' ? 'btn-ghost btn-ghost--active' : 'btn-ghost'} onClick={() => toggleSort('users')}>
              Użytkownicy{sortKey === 'users' ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}
            </button>
            <button type="button" className={sortKey === 'plan' ? 'btn-ghost btn-ghost--active' : 'btn-ghost'} onClick={() => toggleSort('plan')}>
              Plan{sortKey === 'plan' ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}
            </button>
          </div>
          <div className="settings-superadmin-list">
            {filteredSorted.map((t) => (
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
                  {t.subscription?.provider === 'STRIPE' && (
                    <div className="workspace-panel__muted" style={{ fontSize: '0.85rem' }}>
                      Stripe: customer{' '}
                      <span className="mono">{t.subscription.providerCustomerId ?? '—'}</span>
                      {t.subscription.providerSubscriptionId ? (
                        <>
                          {' '}
                          · sub <span className="mono">{t.subscription.providerSubscriptionId}</span>
                        </>
                      ) : null}
                      {t.subscription.trialEndsAt ? <> · trial do {formatDate(t.subscription.trialEndsAt)}</> : null}
                      {t.subscription.currentPeriodEnd ? <> · okres do {formatDate(t.subscription.currentPeriodEnd)}</> : null}
                    </div>
                  )}
                </div>
                <button type="button" className="btn-ghost" onClick={() => void onImpersonate(t.id)}>
                  Wejdź na konto
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      <section className="integration-card integration-card--tight" style={{ marginTop: 24 }}>
        <h3 className="workspace-panel__h3">Webhooki — DEAD_LETTER (platforma)</h3>
        <p className="workspace-panel__muted">
          Wychodzące webhooki po wyczerpaniu retry. Szczegóły i ponowienie per tenant w zakładce integracji (Administrator
          workspace).
        </p>
        {!loading && dlq && (
          <>
            <p className="workspace-panel__muted" style={{ marginTop: 8 }}>
              Łącznie w DLQ: <strong>{dlq.totalDeadLetter}</strong>
              {dlq.recent.length > 0 ? ` · ostatnie ${dlq.recent.length} wpisy:` : '.'}
            </p>
            {dlq.recent.length > 0 && (
              <div className="settings-superadmin-list" style={{ marginTop: 12 }}>
                {dlq.recent.map((w) => (
                  <div key={w.id} className="settings-superadmin-item" style={{ alignItems: 'flex-start' }}>
                    <div>
                      <strong>{w.tenant.name}</strong>{' '}
                      <span className="workspace-panel__muted">
                        · {w.eventType} · próby: {w.attemptCount} · {formatDate(w.updatedAt)}
                      </span>
                      {w.lastError && (
                        <div className="workspace-panel__err" style={{ fontSize: '0.85rem', marginTop: 4 }}>
                          {w.lastError.slice(0, 220)}
                          {w.lastError.length > 220 ? '…' : ''}
                        </div>
                      )}
                    </div>
                    <button type="button" className="btn-ghost" onClick={() => void onImpersonate(w.tenantId)}>
                      Wejdź
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </section>

      <section className="integration-card integration-card--tight" style={{ marginTop: 24 }}>
        <h3 className="workspace-panel__h3">Connectory (skrót)</h3>
        <p className="workspace-panel__muted">
          Liczba aktywnych źródeł ingestion, credentiali integracji i integracji POS per tenant (bez sekretów).
        </p>
        {!loading && connectors.length > 0 && (
          <div className="settings-superadmin-list" style={{ marginTop: 12 }}>
            {connectors.slice(0, 40).map((c) => (
              <div key={c.tenantId} className="settings-superadmin-item">
                <div>
                  <strong>{c.tenantName ?? c.tenantId.slice(0, 8) + '…'}</strong>
                  <div className="workspace-panel__muted">
                    Ingestion: {c.ingestionSources} · Credentials: {c.integrationCredentials} · POS: {c.integrationPos}{' '}
                    · NIP: {c.tenantNip?.trim() || '—'}
                  </div>
                </div>
                <button type="button" className="btn-ghost" onClick={() => void onImpersonate(c.tenantId)}>
                  Wejdź
                </button>
              </div>
            ))}
          </div>
        )}
        {!loading && connectors.length === 0 && <p className="workspace-panel__muted">Brak skonfigurowanych connectorów.</p>}
      </section>

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
          Checkout i portal klienta Stripe są używane przez tenantów w zakładce <strong>Plan</strong>. Identyfikatory Stripe
          (customer / subscription) widać w wierszu tenantów powyżej, gdy <span className="mono">provider</span> to{' '}
          <span className="mono">STRIPE</span>. Pełna obsługa rozliczeń — w Stripe Dashboard oraz zmienne{' '}
          <span className="mono">STRIPE_*</span> w <span className="mono">backend/.env</span>.
        </p>
      </section>
    </div>
  )
}
