import { useCallback, useEffect, useState } from 'react'

import {

  createBillingPortalSession,

  createSubscriptionCheckout,

  fetchBillingSubscriptionState,

  switchSubscriptionPlan,

  type PrepaidInfo,

  type SubscriptionRow,

  type WorkspaceUsage,

} from '../../api/billingApi'

import {
  fetchTenantBillingData,
  fetchTenantProfile,
  patchTenantProfile,
  type TenantProfileResponse,
} from '../../api/tenantApi'

import { changePasswordRequest, setInitialPasswordRequest } from '../../auth/authApi'
import { getStoredToken } from '../../auth/session'
import { useAuth } from '../../auth/AuthContext'
import { BillingDataModal } from './BillingDataModal'
import { PaymentsPanel } from './PaymentsPanel'

export function SettingsPanel() {
  const { user, refreshUser } = useAuth()

  const [name, setName] = useState('')

  const [nip, setNip] = useState('')

  const [loading, setLoading] = useState(true)
  const [tenantProfile, setTenantProfile] = useState<TenantProfileResponse | null>(null)

  const [saving, setSaving] = useState(false)

  const [err, setErr] = useState<string | null>(null)

  const [ok, setOk] = useState(false)

  const [pwdInitial, setPwdInitial] = useState('')

  const [pwdInitial2, setPwdInitial2] = useState('')

  const [pwdCurrent, setPwdCurrent] = useState('')

  const [pwdNew, setPwdNew] = useState('')

  const [pwdNew2, setPwdNew2] = useState('')

  const [pwdBusy, setPwdBusy] = useState(false)

  const [pwdMsg, setPwdMsg] = useState<string | null>(null)



  const [subscription, setSubscription] = useState<SubscriptionRow | null>(null)

  const [workspace, setWorkspace] = useState<WorkspaceUsage | null>(null)

  const [prepaid, setPrepaid] = useState<PrepaidInfo | null>(null)

  const [subLoading, setSubLoading] = useState(false)

  const [subErr, setSubErr] = useState<string | null>(null)

  const [checkoutLoadingMethod, setCheckoutLoadingMethod] = useState<'BLIK' | null>(null)

  const [billingModalMethod, setBillingModalMethod] = useState<'BLIK' | null>(null)



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
      setTenantProfile(t)

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

      const { subscription: row, workspace: ws, prepaid: pr } = await fetchBillingSubscriptionState(token)

      setSubscription(row)

      setWorkspace(ws)

      setPrepaid(pr)

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



  const proceedCheckout = async (

    planCode: 'pro',

    paymentMethod: 'BLIK',

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

  const onCheckout = async (

    planCode: 'pro',

    paymentMethod: 'BLIK',

  ) => {

    const token = getStoredToken()

    if (!token) return

    try {

      setCheckoutLoadingMethod(paymentMethod)

      setSubErr(null)

      const billing = await fetchTenantBillingData(token)

      if (!billing.complete) {

        setBillingModalMethod(paymentMethod)

        setCheckoutLoadingMethod(null)

        return

      }

      await proceedCheckout(planCode, paymentMethod)

    } catch (e: unknown) {

      setSubErr(e instanceof Error ? e.message : String(e))

      setCheckoutLoadingMethod(null)

    }

  }



  const onSwitchFree = async () => {

    const token = getStoredToken()

    if (!token) return

    try {

      await switchSubscriptionPlan(token, 'free')

      const next = await fetchBillingSubscriptionState(token)

      setSubscription(next.subscription)

      setWorkspace(next.workspace)

      setPrepaid(next.prepaid)

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

  const onSetInitialPassword = async (e: React.FormEvent) => {

    e.preventDefault()

    const token = getStoredToken()

    if (!token) return

    setPwdMsg(null)

    if (pwdInitial.length < 8) {

      setPwdMsg('Hasło musi mieć co najmniej 8 znaków.')

      return

    }

    if (pwdInitial !== pwdInitial2) {

      setPwdMsg('Powtórzone hasło jest inne.')

      return

    }

    setPwdBusy(true)

    try {

      await setInitialPasswordRequest(token, pwdInitial)

      setPwdInitial('')

      setPwdInitial2('')

      setPwdMsg('Hasło zapisane. Możesz logować się także e-mailem i hasłem.')

      await refreshUser()

    } catch (err: unknown) {

      setPwdMsg(err instanceof Error ? err.message : String(err))

    } finally {

      setPwdBusy(false)

    }

  }

  const onChangePassword = async (e: React.FormEvent) => {

    e.preventDefault()

    const token = getStoredToken()

    if (!token) return

    setPwdMsg(null)

    if (pwdNew.length < 8) {

      setPwdMsg('Nowe hasło musi mieć co najmniej 8 znaków.')

      return

    }

    if (pwdNew !== pwdNew2) {

      setPwdMsg('Powtórzone nowe hasło jest inne.')

      return

    }

    setPwdBusy(true)

    try {

      await changePasswordRequest(token, pwdCurrent, pwdNew)

      setPwdCurrent('')

      setPwdNew('')

      setPwdNew2('')

      setPwdMsg('Hasło zostało zmienione.')

      await refreshUser()

    } catch (err: unknown) {

      setPwdMsg(err instanceof Error ? err.message : String(err))

    } finally {

      setPwdBusy(false)

    }

  }



  return (

    <div className="workspace-panel">

      <header className="workspace-panel__head">

        <div>

          <h2 className="workspace-panel__title">Ustawienia</h2>

          <p className="workspace-panel__lead">
            Dane firmy, hasło, integracje (bank, KSeF), plan i abonament PRO (Stripe).
          </p>

        </div>

      </header>



      {loading && <p className="workspace-panel__muted">Ładowanie…</p>}

      {err && <p className="workspace-panel__err">{err}</p>}

      {ok && <p className="workspace-panel__ok">Zapisano.</p>}

      <section className="integration-card integration-card--tight settings-plan-section" style={{ marginBottom: 16 }}>

        <h3 className="workspace-panel__h3">Plan i subskrypcja</h3>

        <p className="workspace-panel__muted">

          Abonament na FV Control (Stripe) — to nie jest przelew za faktury do dostawców.

        </p>

        {subErr && <p className="workspace-panel__err">{subErr}</p>}

        {subLoading && <p className="workspace-panel__muted">Ładowanie subskrypcji…</p>}

        {!subLoading && prepaid?.prepaidRenewSoon && !prepaid.prepaidExpired && (

          <div className="app-banner app-banner--warn" role="status">

            <strong>PRO prepaid:</strong> zostało ok. <strong>{prepaid.prepaidDaysRemaining}</strong> dni do końca opłaconego

            okresu ({new Date(prepaid.prepaidEndsAt).toLocaleString('pl-PL')}). Możesz przedłużyć dostęp BLIK

            na kolejne 30 dni.

          </div>

        )}

        {!subLoading && prepaid?.prepaidExpired && (

          <div className="app-banner app-banner--error" role="alert">

            <strong>PRO prepaid:</strong> opłacony okres minął. Aby z powrotem korzystać z limitów PRO, opłać kolejny miesiąc

            BLIKiem.

          </div>

        )}

        {!subLoading && (

          <>

            {workspace && (

              <p className="workspace-panel__muted" style={{ marginBottom: 12 }}>

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

            <div className="settings-plan-tiles">

              <article

                className={`settings-plan-tile${workspace?.planCode === 'free' || !workspace?.hasProEntitlement ? ' settings-plan-tile--current' : ''}`}

              >

                <h4 className="settings-plan-tile__title">Free</h4>

                <p className="settings-plan-tile__price">0 zł</p>

                <ul className="settings-plan-tile__list">

                  <li>Do 15 dokumentów (faktury + umowy)</li>

                  <li>Podstawowe funkcje aplikacji</li>

                </ul>

                {workspace?.hasProEntitlement ? (

                  <button type="button" className="btn-ghost settings-plan-tile__cta" onClick={() => void onSwitchFree()}>

                    Przejdź na Free

                  </button>

                ) : (

                  <p className="workspace-panel__muted settings-plan-tile__hint">Twój aktualny plan</p>

                )}

              </article>

              <article

                className={`settings-plan-tile settings-plan-tile--pro${workspace?.hasProEntitlement ? ' settings-plan-tile--current' : ''}`}

              >

                <h4 className="settings-plan-tile__title">PRO</h4>

                <p className="settings-plan-tile__price">67 zł</p>

                <ul className="settings-plan-tile__list">

                  <li>Nieograniczona liczba dokumentów (faktury + umowy)</li>

                  <li>Wszystkie funkcje aplikacji</li>

                </ul>

                <p className="workspace-panel__muted settings-plan-tile__sub">

                  MVP: płatność jednorazowa <strong>BLIK</strong> za 30 dni —

                  przed końcem pokażemy przypomnienie. Karta wróci po domknięciu automatycznej FV dla recurring billing.

                </p>

                {prepaid && !prepaid.prepaidExpired && (

                  <p className="workspace-panel__muted settings-plan-tile__sub">

                    Koniec okresu prepaid: <strong>{new Date(prepaid.prepaidEndsAt).toLocaleString('pl-PL')}</strong> · zostało{' '}

                    <strong>{prepaid.prepaidDaysRemaining}</strong> dni

                  </p>

                )}

                <div className="settings-plan-tile__actions">

                  <button

                    type="button"

                    className="btn-primary settings-plan-tile__btn settings-plan-tile__btn--blik"

                    disabled={checkoutLoadingMethod !== null}

                    onClick={() => void onCheckout('pro', 'BLIK')}

                  >

                    {checkoutLoadingMethod === 'BLIK' ? 'Przekierowanie…' : 'BLIK — 30 dni'}

                  </button>

                </div>

                {subscription && subscription.billingKind !== 'STRIPE_PREPAID_BLIK' && (

                  <button

                    type="button"

                    className="btn-ghost settings-plan-tile__portal"

                    onClick={() => void onOpenBillingPortal()}

                  >

                    Zarządzaj subskrypcją kartą (Stripe)

                  </button>

                )}

                {subscription?.billingKind === 'STRIPE_PREPAID_BLIK' && (

                  <p className="workspace-panel__muted settings-plan-tile__hint">

                    PRO opłacony prepaid — przedłuż kolejną płatnością BLIK.

                  </p>

                )}

              </article>

            </div>

            <p className="workspace-panel__muted" style={{ marginTop: 12 }}>

              MVP używa płatności prepaid BLIK za 67 PLN brutto (30 dni). Karta recurring jest wyłączona do Sprint 2,
              żeby każda płatność miała spójny flow FV VAT + KSeF.

            </p>

          </>

        )}

      </section>

      {!loading && (
        <section className="integration-card integration-card--tight" style={{ marginBottom: 16 }}>
          <h3 className="workspace-panel__h3">Checklista gotowości konta</h3>
          <p className="workspace-panel__muted">
            Gdy wszystkie punkty są gotowe, konto jest przygotowane do pracy na realnych fakturach.
          </p>
          <ul className="workspace-panel__checklist">
            <li>
              {user?.emailVerified ? '✅' : '⬜'} Weryfikacja e-mail właściciela konta
            </li>
            <li>
              {user?.hasPassword ? '✅' : '⬜'} Hasło do logowania (e-mail){' '}
              {!user?.hasPassword && <span className="workspace-panel__muted">— wymagane przy koncie tylko z Google</span>}
            </li>
            <li>
              {nip.replace(/\s/g, '').length >= 10 ? '✅' : '⬜'} Uzupełniony NIP firmy
            </li>
            <li>
              {tenantProfile?.portalIntegrations.ksefConfigured ? '✅' : '⬜'} Zapisane poświadczenia KSeF (sekcja Bank i
              KSeF poniżej)
            </li>
            <li>
              {workspace?.hasProEntitlement ? '✅' : '⬜'} Aktywny plan PRO (BLIK)
            </li>
          </ul>
        </section>
      )}

      {!loading && user && (
        <section className="integration-card integration-card--tight" style={{ marginBottom: 16 }}>
          <h3 className="workspace-panel__h3">Hasło do konta</h3>
          <p className="workspace-panel__muted">
            Logowanie przez Google pozostaje bez zmian. Hasło pozwala zalogować się tym samym e-mailem z ekranu logowania.
          </p>
          {pwdMsg && <p className={pwdMsg.includes('zapisane') || pwdMsg.includes('zmienione') ? 'workspace-panel__ok' : 'workspace-panel__err'}>{pwdMsg}</p>}
          {!user.hasPassword ? (
            <form className="settings-form" onSubmit={onSetInitialPassword}>
              <label>
                <span>Nowe hasło (min. 8 znaków)</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={pwdInitial}
                  onChange={(e) => setPwdInitial(e.target.value)}
                  disabled={pwdBusy}
                  minLength={8}
                />
              </label>
              <label>
                <span>Powtórz hasło</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={pwdInitial2}
                  onChange={(e) => setPwdInitial2(e.target.value)}
                  disabled={pwdBusy}
                  minLength={8}
                />
              </label>
              <div className="settings-form__actions">
                <button type="submit" className="btn-primary" disabled={pwdBusy}>
                  {pwdBusy ? 'Zapis…' : 'Ustaw hasło'}
                </button>
              </div>
            </form>
          ) : (
            <form className="settings-form" onSubmit={onChangePassword}>
              <label>
                <span>Aktualne hasło</span>
                <input
                  type="password"
                  autoComplete="current-password"
                  value={pwdCurrent}
                  onChange={(e) => setPwdCurrent(e.target.value)}
                  disabled={pwdBusy}
                />
              </label>
              <label>
                <span>Nowe hasło (min. 8 znaków)</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={pwdNew}
                  onChange={(e) => setPwdNew(e.target.value)}
                  disabled={pwdBusy}
                  minLength={8}
                />
              </label>
              <label>
                <span>Powtórz nowe hasło</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={pwdNew2}
                  onChange={(e) => setPwdNew2(e.target.value)}
                  disabled={pwdBusy}
                  minLength={8}
                />
              </label>
              <div className="settings-form__actions">
                <button type="submit" className="btn-primary" disabled={pwdBusy}>
                  {pwdBusy ? 'Zapis…' : 'Zmień hasło'}
                </button>
              </div>
            </form>
          )}
        </section>
      )}

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

      <PaymentsPanel
        embedded
        onPortalIntegrationsChange={(portalIntegrations) =>
          setTenantProfile((prev) => (prev ? { ...prev, portalIntegrations } : prev))
        }
      />

      <BillingDataModal
        open={billingModalMethod !== null}
        onClose={() => setBillingModalMethod(null)}
        onSuccess={() => {
          const method = billingModalMethod
          setBillingModalMethod(null)
          if (method) void proceedCheckout('pro', method)
        }}
      />

    </div>

  )

}

