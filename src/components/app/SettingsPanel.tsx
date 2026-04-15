import { useCallback, useEffect, useState } from 'react'

import {

  createBillingPortalSession,

  createSubscriptionCheckout,

  fetchBillingSubscriptionState,

  switchSubscriptionPlan,

  type SubscriptionRow,

  type WorkspaceUsage,

} from '../../api/billingApi'

import { fetchTenantProfile, patchTenantProfile, type TenantProfileResponse } from '../../api/tenantApi'

import { getStoredToken } from '../../auth/session'



export function SettingsPanel() {

  const [name, setName] = useState('')

  const [nip, setNip] = useState('')

  const [loading, setLoading] = useState(true)

  const [saving, setSaving] = useState(false)

  const [err, setErr] = useState<string | null>(null)

  const [ok, setOk] = useState(false)



  const [subscription, setSubscription] = useState<SubscriptionRow | null>(null)

  const [workspace, setWorkspace] = useState<WorkspaceUsage | null>(null)

  const [subLoading, setSubLoading] = useState(false)

  const [subErr, setSubErr] = useState<string | null>(null)

  const [checkoutLoadingMethod, setCheckoutLoadingMethod] = useState<

    'CARD' | 'GOOGLE_PAY' | 'APPLE_PAY' | null

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



  const loadSubscription = useCallback(async () => {

    const token = getStoredToken()

    if (!token) return

    setSubLoading(true)

    setSubErr(null)

    try {

      const { subscription: row, workspace: ws } = await fetchBillingSubscriptionState(token)

      setSubscription(row)

      setWorkspace(ws)

    } catch (e: unknown) {

      setSubErr(e instanceof Error ? e.message : String(e))

    } finally {

      setSubLoading(false)

    }

  }, [])



  useEffect(() => {

    void load()

  }, [load])



  useEffect(() => {

    void loadSubscription()

  }, [loadSubscription])



  useEffect(() => {

    const q = new URLSearchParams(window.location.search)

    if (q.get('billing') === 'success') {

      void loadSubscription()

    }

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



  const onCheckout = async (

    planCode: 'pro',

    paymentMethod: 'CARD' | 'GOOGLE_PAY' | 'APPLE_PAY',

  ) => {

    const token = getStoredToken()

    if (!token) return

    try {

      setCheckoutLoadingMethod(paymentMethod)

      const origin = window.location.origin

      const r = await createSubscriptionCheckout(token, {

        provider: 'STRIPE',

        planCode,

        successUrl: `${origin}/?billing=success&nav=settings`,

        cancelUrl: `${origin}/?nav=settings&billing=cancel`,

        paymentMethod,

      })

      window.location.href = r.checkoutUrl

    } catch (e: unknown) {

      setSubErr(e instanceof Error ? e.message : String(e))

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

      const next = await fetchBillingSubscriptionState(token)

      setWorkspace(next.workspace)

    } catch (e: unknown) {

      setSubErr(e instanceof Error ? e.message : String(e))

    }

  }



  const onOpenBillingPortal = async () => {

    const token = getStoredToken()

    if (!token) return

    try {

      const origin = window.location.origin

      const r = await createBillingPortalSession(token, `${origin}/?nav=settings`)

      window.location.href = r.portalUrl

    } catch (e: unknown) {

      setSubErr(e instanceof Error ? e.message : String(e))

    }

  }



  return (

    <div className="workspace-panel">

      <header className="workspace-panel__head">

        <div>

          <h2 className="workspace-panel__title">Ustawienia firmy</h2>

          <p className="workspace-panel__lead">Nazwa, NIP, plan i płatność za abonament (Stripe).</p>

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

        <h3 className="workspace-panel__h3">Plan i subskrypcja (Stripe)</h3>

        <p className="workspace-panel__muted">

          Abonament na FV Control — to nie jest przelew za faktury do dostawców.

        </p>

        {subErr && <p className="workspace-panel__err">{subErr}</p>}

        {subLoading && <p className="workspace-panel__muted">Ładowanie subskrypcji…</p>}

        {!subLoading && (

          <>

            <p className="workspace-panel__muted">

              Status: <strong>{subscription?.status ?? 'BRAK'}</strong> · Plan:{' '}

              <strong>{subscription?.planCode ?? 'free'}</strong> · Provider:{' '}

              <strong>{subscription?.provider ?? '—'}</strong>

            </p>

            {workspace && (

              <p className="workspace-panel__muted">

                Dokumenty (faktury + umowy): <strong>{workspace.used}</strong>

                {workspace.limit != null ? (

                  <>

                    {' '}

                    / <strong>{workspace.limit}</strong> na planie Free

                  </>

                ) : (

                  <> — bez limitu (PRO)</>

                )}

                .

              </p>

            )}

            <p className="workspace-panel__muted">

              <strong>Podstawowy (Free)</strong>: do 15 dokumentów (faktury + umowy). <strong>PRO</strong>: bez limitu —{' '}

              <strong>99 zł / mies.</strong> przez Stripe (karta / Google Pay / Apple Pay).

            </p>

            <p className="workspace-panel__muted">

              Na serwerze API musi być ustawione <span className="mono">STRIPE_PRICE_ID_PRO</span> (cena 99 PLN miesięcznie) w{' '}

              <span className="mono">backend/.env</span>.

            </p>

            <div className="settings-form__actions">

              <button type="button" className="btn-ghost" onClick={() => void onOpenBillingPortal()}>

                Zarządzaj subskrypcją (Stripe)

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

                {checkoutLoadingMethod === 'CARD' ? 'Przekierowanie…' : 'PRO — karta / portfele'}

              </button>

              <button

                type="button"

                className="btn-ghost"

                disabled={checkoutLoadingMethod !== null}

                onClick={() => void onCheckout('pro', 'GOOGLE_PAY')}

              >

                {checkoutLoadingMethod === 'GOOGLE_PAY' ? 'Przekierowanie…' : 'PRO — Google Pay'}

              </button>

              <button

                type="button"

                className="btn-ghost"

                disabled={checkoutLoadingMethod !== null}

                onClick={() => void onCheckout('pro', 'APPLE_PAY')}

              >

                {checkoutLoadingMethod === 'APPLE_PAY' ? 'Przekierowanie…' : 'PRO — Apple Pay'}

              </button>

            </div>

          </>

        )}

      </section>



      <section className="integration-card integration-card--tight">

        <h3 className="workspace-panel__h3">Integracje</h3>

        <p className="workspace-panel__muted">

          Bank i poświadczenia KSeF (token, PIN, certyfikat) konfigurujesz w <strong>Płatnościach</strong>. Zmienne{' '}

          <span className="mono">KSEF_*</span> na serwerze mogą służyć jako wspólny fallback dla tenantów bez własnego

          zapisu.

        </p>

      </section>

    </div>

  )

}

