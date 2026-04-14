import { useCallback, useEffect, useState } from 'react'
import { fetchTenantProfile, patchTenantProfile, type TenantProfileResponse } from '../../api/tenantApi'
import { fetchPlatformTenants, issueImpersonationToken, type PlatformTenantRow } from '../../api/platformAdminApi'
import {
  createBillingPortalSession,
  createSubscriptionCheckout,
  fetchCurrentSubscription,
  switchSubscriptionPlan,
  type SubscriptionRow,
} from '../../api/billingApi'
import { useAuth } from '../../auth/AuthContext'
import { getStoredToken, setStoredToken } from '../../auth/session'

export function SettingsPanel() {
  const { user } = useAuth()
  const [name, setName] = useState('')
  const [nip, setNip] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [ok, setOk] = useState(false)
  const [platformTenants, setPlatformTenants] = useState<PlatformTenantRow[]>([])
  const [platformLoading, setPlatformLoading] = useState(false)
  const [subscription, setSubscription] = useState<SubscriptionRow | null>(null)
  const [subLoading, setSubLoading] = useState(false)
  const [checkoutLoadingMethod, setCheckoutLoadingMethod] = useState<
    'CARD' | 'BLIK' | 'GOOGLE_PAY' | 'APPLE_PAY' | null
  >(null)

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
      const t: TenantProfileResponse = await fetchTenantProfile(token)
      setName(t.name)
      setNip(t.nip ?? '')
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const loadPlatform = useCallback(async () => {
    if (!user?.isSuperAdmin) return
    const token = getStoredToken()
    if (!token) return
    setPlatformLoading(true)
    try {
      const rows = await fetchPlatformTenants(token)
      setPlatformTenants(rows)
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setPlatformLoading(false)
    }
  }, [user?.isSuperAdmin])

  useEffect(() => {
    void loadPlatform()
  }, [loadPlatform])

  const loadSubscription = useCallback(async () => {
    const token = getStoredToken()
    if (!token) return
    setSubLoading(true)
    try {
      const row = await fetchCurrentSubscription(token)
      setSubscription(row)
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setSubLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadSubscription()
  }, [loadSubscription])

  const onSave = async (e: React.FormEvent) => {
    e.preventDefault()
    const token = getStoredToken()
    if (!token) return
    setSaving(true)
    setOk(false)
    setErr(null)
    try {
      await patchTenantProfile(token, {
        name: name.trim(),
        nip: nip.replace(/\s/g, '') || null,
      })
      setOk(true)
      await load()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

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

  const onCheckout = async (
    planCode: 'pro',
    paymentMethod: 'CARD' | 'BLIK' | 'GOOGLE_PAY' | 'APPLE_PAY',
  ) => {
    const token = getStoredToken()
    if (!token) return
    try {
      setCheckoutLoadingMethod(paymentMethod)
      const origin = window.location.origin
      const r = await createSubscriptionCheckout(token, {
        provider: 'STRIPE',
        planCode,
        successUrl: `${origin}/?billing=success`,
        cancelUrl: `${origin}/?billing=cancel`,
        paymentMethod,
      })
      window.location.href = r.checkoutUrl
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setCheckoutLoadingMethod(null)
    }
  }

  const onSwitchFree = async () => {
    const token = getStoredToken()
    if (!token) return
    try {
      const updated = await switchSubscriptionPlan(token, 'free')
      setSubscription(updated)
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  const onOpenBillingPortal = async () => {
    const token = getStoredToken()
    if (!token) return
    try {
      const origin = window.location.origin
      const r = await createBillingPortalSession(token, `${origin}/settings?billing=portal`)
      window.location.href = r.portalUrl
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="workspace-panel">
      <header className="workspace-panel__head">
        <div>
          <h2 className="workspace-panel__title">Ustawienia firmy</h2>
          <p className="workspace-panel__lead">Nazwa i NIP widoczne na fakturach i w integracjach.</p>
        </div>
      </header>

      {loading && <p className="workspace-panel__muted">Ładowanie…</p>}
      {err && <p className="workspace-panel__err">{err}</p>}
      {ok && <p className="workspace-panel__ok">Zapisano.</p>}

      {!loading && (
        <form className="settings-form" onSubmit={onSave}>
          <label>
            <span>Nazwa firmy</span>
            <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={300} />
          </label>
          <label>
            <span>NIP</span>
            <input value={nip} onChange={(e) => setNip(e.target.value)} inputMode="numeric" maxLength={20} />
          </label>
          <div className="settings-form__actions">
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Zapis…' : 'Zapisz'}
            </button>
          </div>
        </form>
      )}

      <section className="integration-card integration-card--tight">
        <h3 className="workspace-panel__h3">Integracje</h3>
        <p className="workspace-panel__muted">
          Szczegóły połączenia z bankiem i KSeF znajdziesz w module <strong>Płatności</strong> oraz w konfiguracji
          serwera API (zmienne środowiskowe, certyfikaty).
        </p>
      </section>

      <section className="integration-card integration-card--tight">
        <h3 className="workspace-panel__h3">Subskrypcja</h3>
        {subLoading && <p className="workspace-panel__muted">Ładowanie subskrypcji…</p>}
        {!subLoading && (
          <>
            <p className="workspace-panel__muted">
              Status: <strong>{subscription?.status ?? 'BRAK'}</strong> · Plan: <strong>{subscription?.planCode ?? 'free'}</strong> ·
              Provider: <strong>{subscription?.provider ?? '—'}</strong>
            </p>
            <p className="workspace-panel__muted">Free: do 15 faktur / miesiąc · Pro: bez limitu, 99 zł / miesiąc</p>
            <p className="workspace-panel__muted">
              Płatność <strong>za faktury</strong> (BLIK / portfele) jest w szczegółach faktury — osobna od subskrypcji. Poniżej: opłata za plan aplikacji (wymaga{' '}
              <span className="mono">STRIPE_PRICE_ID_PRO</span> na serwerze).
            </p>
            <div className="settings-form__actions">
              <button type="button" className="btn-ghost" onClick={() => void onOpenBillingPortal()}>
                Zarządzaj subskrypcją
              </button>
              <button type="button" className="btn-ghost" onClick={() => void onSwitchFree()}>
                Przejdź na Free
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={checkoutLoadingMethod !== null}
                onClick={() => void onCheckout('pro', 'CARD')}
              >
                {checkoutLoadingMethod === 'CARD' ? 'Przekierowanie…' : 'PRO - karta / portfele'}
              </button>
              <button
                type="button"
                className="btn-ghost"
                disabled={checkoutLoadingMethod !== null}
                onClick={() => void onCheckout('pro', 'GOOGLE_PAY')}
              >
                {checkoutLoadingMethod === 'GOOGLE_PAY' ? 'Przekierowanie…' : 'PRO - Google Pay'}
              </button>
              <button
                type="button"
                className="btn-ghost"
                disabled={checkoutLoadingMethod !== null}
                onClick={() => void onCheckout('pro', 'APPLE_PAY')}
              >
                {checkoutLoadingMethod === 'APPLE_PAY' ? 'Przekierowanie…' : 'PRO - Apple Pay'}
              </button>
            </div>
          </>
        )}
      </section>

      {user?.isSuperAdmin && (
        <section className="integration-card integration-card--tight">
          <h3 className="workspace-panel__h3">Platforma SaaS (Super Admin)</h3>
          {platformLoading && <p className="workspace-panel__muted">Ładowanie tenantów…</p>}
          {!platformLoading && platformTenants.length === 0 && <p className="workspace-panel__muted">Brak tenantów.</p>}
          {!platformLoading && platformTenants.length > 0 && (
            <div className="settings-superadmin-list">
              {platformTenants.map((t) => (
                <div key={t.id} className="settings-superadmin-item">
                  <div>
                    <strong>{t.name}</strong> <span className="workspace-panel__muted">({t.id.slice(0, 8)}…)</span>
                    <div className="workspace-panel__muted">
                      Użytkownicy: {t.userCount} · Faktury: {t.invoiceCount} · Plan: {t.subscription?.planCode ?? '—'} · Status:{' '}
                      {t.subscription?.status ?? '—'}
                    </div>
                  </div>
                  <button type="button" className="btn-ghost" onClick={() => void onImpersonate(t.id)}>
                    Wejdź jako tenant
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  )
}
