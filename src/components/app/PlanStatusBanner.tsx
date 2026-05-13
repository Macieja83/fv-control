import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  fetchBillingSubscriptionState,
  type PrepaidInfo,
  type SubscriptionRow,
  type WorkspaceUsage,
} from '../../api/billingApi'
import { getStoredToken } from '../../auth/session'
import type { AppNavKey } from './appNav'

function formatDateTime(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleString('pl-PL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function planCopy(workspace: WorkspaceUsage | null, prepaid: PrepaidInfo | null, subscription: SubscriptionRow | null) {
  const isPro = workspace?.hasProEntitlement === true
  if (!isPro) {
    const limit = workspace?.limit ?? 15
    const used = workspace?.used ?? 0
    return {
      tone: 'free' as const,
      title: 'Plan Free',
      detail: `Wykorzystanie: ${used}/${limit} dokumentów. PRO odblokowuje brak limitu.`,
      cta: 'Wykup PRO',
    }
  }

  const endIso = prepaid?.prepaidEndsAt ?? subscription?.currentPeriodEnd ?? null
  const end = formatDateTime(endIso)
  if (prepaid?.prepaidExpired) {
    return {
      tone: 'warn' as const,
      title: 'PRO wygasł',
      detail: end ? `Opłacony okres skończył się ${end}. Wykup kolejny okres, żeby wrócić do limitów PRO.` : 'Wykup kolejny okres, żeby wrócić do limitów PRO.',
      cta: 'Przedłuż PRO',
    }
  }

  if (prepaid) {
    const days = prepaid.prepaidDaysRemaining
    return {
      tone: prepaid.prepaidRenewSoon ? ('warn' as const) : ('pro' as const),
      title: 'Plan PRO aktywny',
      detail: end
        ? `Zostało ${days} dni. Następny okres wykup najpóźniej do ${end}.`
        : `Zostało ${days} dni opłaconego okresu.`,
      cta: 'Przedłuż PRO',
    }
  }

  const subscriptionEnd = formatDateTime(subscription?.currentPeriodEnd)
  return {
    tone: 'pro' as const,
    title: 'Plan PRO aktywny',
    detail: subscriptionEnd ? `Aktualny okres kończy się ${subscriptionEnd}.` : 'Aktywne uprawnienie PRO.',
    cta: 'Zarządzaj planem',
  }
}

export function PlanStatusBanner(props: { onGoToNav: (nav: AppNavKey) => void }) {
  const [subscription, setSubscription] = useState<SubscriptionRow | null>(null)
  const [workspace, setWorkspace] = useState<WorkspaceUsage | null>(null)
  const [prepaid, setPrepaid] = useState<PrepaidInfo | null>(null)
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
      const next = await fetchBillingSubscriptionState(token)
      setSubscription(next.subscription)
      setWorkspace(next.workspace)
      setPrepaid(next.prepaid)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const onFocus = () => void load()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [load])

  const copy = useMemo(() => planCopy(workspace, prepaid, subscription), [workspace, prepaid, subscription])

  if (loading && !workspace && !subscription) return null

  return (
    <div className={`app-banner app-banner--plan app-banner--plan-${copy.tone}`} role="status">
      <div>
        <strong>{copy.title}</strong>
        <div className="app-banner__sub">
          <span>{copy.detail}</span>
          {error && <span className="workspace-panel__err">{error}</span>}
        </div>
      </div>
      <div className="app-banner__actions">
        <button type="button" className="btn-ghost" onClick={() => props.onGoToNav('settings')}>
          {copy.cta}
        </button>
        <button type="button" className="btn-ghost" onClick={() => void load()} disabled={loading}>
          {loading ? 'Odświeżanie...' : 'Odśwież'}
        </button>
      </div>
    </div>
  )
}
