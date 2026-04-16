import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AuthUser } from '../../auth/AuthContext'
import { fetchBillingSubscriptionState } from '../../api/billingApi'
import { fetchTenantProfile, type TenantProfileResponse } from '../../api/tenantApi'
import { getStoredToken } from '../../auth/session'
import type { AppNavKey } from './appNav'

type Step = {
  id: string
  label: string
  done: boolean
  nav: AppNavKey
}

export function OnboardingChecklistBanner(props: {
  user: AuthUser | null
  onGoToNav: (nav: AppNavKey) => void
}) {
  const [tenant, setTenant] = useState<TenantProfileResponse | null>(null)
  const [subscriptionStatus, setSubscriptionStatus] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const token = getStoredToken()
    if (!token) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const [t, sub] = await Promise.all([
        fetchTenantProfile(token),
        fetchBillingSubscriptionState(token).catch(() => null),
      ])
      setTenant(t)
      setSubscriptionStatus(sub?.subscription?.status ?? null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const steps = useMemo<Step[]>(() => {
    const nipOk = (tenant?.nip ?? '').replace(/\s/g, '').length >= 10
    const ksefOk = tenant?.portalIntegrations.ksefConfigured === true
    const subOk = subscriptionStatus === 'ACTIVE' || subscriptionStatus === 'TRIALING'
    return [
      { id: 'email', label: 'Potwierdzony e-mail konta', done: props.user?.emailVerified === true, nav: 'settings' },
      { id: 'pwd', label: 'Hasło do logowania (oprócz Google)', done: props.user?.hasPassword === true, nav: 'settings' },
      { id: 'nip', label: 'Uzupełniony NIP firmy', done: nipOk, nav: 'settings' },
      { id: 'ksef', label: 'Skonfigurowane poświadczenia KSeF', done: ksefOk, nav: 'payments' },
      { id: 'sub', label: 'Aktywna subskrypcja (trial/active)', done: subOk, nav: 'settings' },
    ]
  }, [
    props.user?.emailVerified,
    props.user?.hasPassword,
    subscriptionStatus,
    tenant?.nip,
    tenant?.portalIntegrations.ksefConfigured,
  ])

  const remaining = steps.filter((s) => !s.done)
  if (remaining.length === 0) return null

  return (
    <div className="app-banner app-banner--onboarding" role="status">
      <div>
        <strong>Onboarding konta:</strong> brakuje {remaining.length} kroków do pełnej gotowości produkcyjnej.
        <div className="app-banner__sub">
          {steps.map((s) => (
            <span key={s.id} className={s.done ? 'onboarding-step onboarding-step--done' : 'onboarding-step'}>
              {s.done ? '✅' : '⬜'} {s.label}
            </span>
          ))}
        </div>
        {error && <div className="workspace-panel__err">{error}</div>}
      </div>
      <div className="app-banner__actions">
        {remaining.slice(0, 2).map((s) => (
          <button key={s.id} type="button" className="btn-ghost" onClick={() => props.onGoToNav(s.nav)}>
            Uzupełnij: {s.nav === 'payments' ? 'Płatności' : 'Firma'}
          </button>
        ))}
        <button type="button" className="btn-ghost" onClick={() => void load()} disabled={loading}>
          {loading ? 'Sprawdzanie…' : 'Odśwież'}
        </button>
      </div>
    </div>
  )
}

