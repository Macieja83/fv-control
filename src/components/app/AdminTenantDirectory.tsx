import { Fragment, useCallback, useMemo, useState } from 'react'
import type { ConnectorsPlatformRow, PlatformAdminKsefRow, PlatformTenantRow } from '../../api/platformAdminApi'

type PlanFilter = 'all' | 'pro' | 'not_pro' | 'stripe' | 'no_sub' | 'archived'
type SortKey = 'name' | 'createdAt' | 'users' | 'plan' | 'invoices'

export type AdminTenantDirectoryProps = {
  rows: PlatformTenantRow[]
  ksefRows: PlatformAdminKsefRow[]
  connectors: ConnectorsPlatformRow[]
  loading: boolean
  err: string | null
  onReload: () => void
  onImpersonate: (tenantId: string) => Promise<void>
  onSetManualPro: (tenantId: string) => Promise<void>
  onArchive: (tenantId: string) => Promise<void>
  onUnarchive: (tenantId: string) => Promise<void>
  onDeactivateUsers: (tenantId: string) => Promise<void>
  onActivateUsers: (tenantId: string) => Promise<void>
}

type Enriched = PlatformTenantRow & { ksef?: PlatformAdminKsefRow; connectors?: ConnectorsPlatformRow }

function planLabel(planCode: string | null | undefined): string {
  const c = (planCode ?? '').toLowerCase()
  if (c === 'free') return 'Free'
  if (c === 'pro') return 'PRO'
  if (c === 'starter') return 'Starter'
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

function buildEnriched(rows: PlatformTenantRow[], ksef: PlatformAdminKsefRow[], conn: ConnectorsPlatformRow[]): Enriched[] {
  const km = new Map(ksef.map((k) => [k.tenantId, k]))
  const cm = new Map(conn.map((c) => [c.tenantId, c]))
  return rows.map((t) => ({ ...t, ksef: km.get(t.id), connectors: cm.get(t.id) }))
}

function isProPlanCode(planCode: string | null | undefined): boolean {
  return (planCode ?? '').toLowerCase() === 'pro'
}

/** PRO opłacony / w trialu — „premium” można używać w praktyce. */
function isPremiumSubscriptionActive(t: Enriched): boolean {
  const st = t.subscription?.status
  if (!isProPlanCode(t.subscription?.planCode)) return false
  return st === 'ACTIVE' || st === 'TRIALING'
}

type Health = { label: string; tone: 'ok' | 'warn' | 'bad' | 'muted' }

function tenantHealth(t: Enriched): Health {
  if (t.deletedAt) return { label: 'Zarchiwizowane', tone: 'bad' }
  const sub = t.subscription
  if (!sub) return { label: 'Brak subskrypcji w bazie', tone: 'warn' }
  const notes: string[] = []
  if (!t.nip?.trim()) notes.push('brak NIP')
  if (sub.status === 'PAST_DUE') notes.push('płatność po terminie')
  if (sub.status === 'CANCELED') notes.push('subskrypcja anulowana')
  if (sub.status === 'SUSPENDED') notes.push('konto zawieszone')
  const k = t.ksef
  if (k?.lastQueueFinalFailure) notes.push('KSeF: błąd kolejki')
  if (k?.lastSyncOk === false) notes.push('KSeF: sync z błędem')
  if (k && k.credentialSource === 'none' && k.effectiveKsefEnv !== 'mock') notes.push('KSeF: brak poświadczeń')
  if (notes.length) return { label: `Uwagi: ${notes.join(' · ')}`, tone: 'warn' }
  if (sub.status === 'ACTIVE' || sub.status === 'TRIALING') return { label: 'W porządku', tone: 'ok' }
  return { label: sub.status, tone: 'muted' }
}

async function copyText(label: string, text: string, onDone: (msg: string) => void) {
  try {
    await navigator.clipboard.writeText(text)
    onDone(`Skopiowano: ${label}`)
  } catch {
    onDone('Nie udało się skopiować (przeglądarka zablokowała schowek).')
  }
}

export function AdminTenantDirectory(props: AdminTenantDirectoryProps) {
  const {
    rows,
    ksefRows,
    connectors,
    loading,
    err,
    onReload,
    onImpersonate,
    onSetManualPro,
    onArchive,
    onUnarchive,
    onDeactivateUsers,
    onActivateUsers,
  } = props
  const [query, setQuery] = useState('')
  const [planFilter, setPlanFilter] = useState<PlanFilter>('all')
  const [sortKey, setSortKey] = useState<SortKey>('createdAt')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [toast, setToast] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast(null), 2400)
  }, [])

  const enriched = useMemo(() => buildEnriched(rows, ksefRows, connectors), [rows, ksefRows, connectors])

  const stats = useMemo(() => {
    const pro = rows.filter((r) => (r.subscription?.planCode ?? '').toLowerCase() === 'pro').length
    const premiumOk = enriched.filter(isPremiumSubscriptionActive).length
    const stripe = rows.filter((r) => r.subscription?.provider === 'STRIPE').length
    const archived = rows.filter((r) => r.deletedAt).length
    return { total: rows.length, pro, premiumOk, stripe, archived }
  }, [rows, enriched])

  const filteredSorted = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = enriched
    if (planFilter === 'pro') list = list.filter((t) => (t.subscription?.planCode ?? '').toLowerCase() === 'pro')
    if (planFilter === 'not_pro') list = list.filter((t) => (t.subscription?.planCode ?? '').toLowerCase() !== 'pro')
    if (planFilter === 'stripe') list = list.filter((t) => t.subscription?.provider === 'STRIPE')
    if (planFilter === 'no_sub') list = list.filter((t) => !t.subscription)
    if (planFilter === 'archived') list = list.filter((t) => !!t.deletedAt)
    if (q) {
      list = list.filter((t) => {
        const plan = t.subscription?.planCode ?? ''
        const st = t.subscription?.status ?? ''
        const nip = t.nip ?? ''
        const cust = t.subscription?.providerCustomerId ?? ''
        const sub = t.subscription?.providerSubscriptionId ?? ''
        const k = t.ksef?.effectiveKsefEnv ?? ''
        const regEmail = (t.registrationEmail ?? '').toLowerCase()
        return (
          t.name.toLowerCase().includes(q) ||
          t.id.toLowerCase().includes(q) ||
          regEmail.includes(q) ||
          nip.toLowerCase().includes(q) ||
          plan.toLowerCase().includes(q) ||
          st.toLowerCase().includes(q) ||
          cust.toLowerCase().includes(q) ||
          sub.toLowerCase().includes(q) ||
          k.toLowerCase().includes(q)
        )
      })
    }
    const dir = sortDir === 'asc' ? 1 : -1
    const sorted = [...list].sort((a, b) => {
      if (sortKey === 'name') return a.name.localeCompare(b.name, 'pl') * dir
      if (sortKey === 'createdAt') return (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * dir
      if (sortKey === 'users') return (a.userCount - b.userCount) * dir
      if (sortKey === 'invoices') return (a.invoiceCount - b.invoiceCount) * dir
      if (sortKey === 'plan') {
        const pa = (a.subscription?.planCode ?? '').localeCompare(b.subscription?.planCode ?? '', 'pl')
        return pa * dir
      }
      return 0
    })
    return sorted
  }, [enriched, query, planFilter, sortKey, sortDir])

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(key)
      setSortDir(key === 'name' ? 'asc' : 'desc')
    }
  }

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  const onEnter = async (tenantId: string) => {
    setBusyId(tenantId)
    try {
      await onImpersonate(tenantId)
    } finally {
      setBusyId(null)
    }
  }

  const runAction = async (busyKey: string, action: () => Promise<void>, okMsg: string) => {
    setBusyId(busyKey)
    try {
      await action()
      showToast(okMsg)
    } finally {
      setBusyId(null)
    }
  }

  const filterBtn = (id: PlanFilter, label: string) => (
    <button
      key={id}
      type="button"
      className={planFilter === id ? 'btn-ghost btn-ghost--active' : 'btn-ghost'}
      onClick={() => setPlanFilter(id)}
    >
      {label}
    </button>
  )

  return (
    <section className="admin-tenant-directory">
      <div className="admin-tenant-directory__stats">
        <button type="button" className="btn-ghost admin-tenant-directory__refresh" onClick={() => onReload()} disabled={loading}>
          Odśwież dane
        </button>
        <div className="admin-stat-pill">
          <span className="admin-stat-pill__label">Tenantów</span>
          <span className="admin-stat-pill__value">{stats.total}</span>
        </div>
        <div className="admin-stat-pill">
          <span className="admin-stat-pill__label">Plan PRO</span>
          <span className="admin-stat-pill__value">{stats.pro}</span>
        </div>
        <div className="admin-stat-pill" title="PRO z aktywną subskrypcją (ACTIVE lub TRIALING)">
          <span className="admin-stat-pill__label">PRO aktywne</span>
          <span className="admin-stat-pill__value">{stats.premiumOk}</span>
        </div>
        <div className="admin-stat-pill">
          <span className="admin-stat-pill__label">Stripe</span>
          <span className="admin-stat-pill__value">{stats.stripe}</span>
        </div>
        {stats.archived > 0 ? (
          <div className="admin-stat-pill admin-stat-pill--warn">
            <span className="admin-stat-pill__label">Zarchiwizowane</span>
            <span className="admin-stat-pill__value">{stats.archived}</span>
          </div>
        ) : null}
      </div>

      {toast && <p className="workspace-panel__ok admin-tenant-directory__toast">{toast}</p>}

      <div className="workspace-panel__toolbar admin-tenant-directory__toolbar">
        <label className="workspace-panel__toolbar-label">
          Szukaj
          <input
            type="search"
            className="workspace-panel__search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Nazwa, e-mail, NIP, plan, status, Stripe…"
            autoComplete="off"
          />
        </label>
        <div className="workspace-panel__muted" style={{ alignSelf: 'center' }}>
          Wyniki: {filteredSorted.length} / {rows.length}
        </div>
      </div>

      <div className="workspace-panel__sort workspace-panel__muted admin-tenant-directory__filters">
        <span className="admin-filter-label">Filtr:</span>
        {filterBtn('all', 'Wszyscy')}
        {filterBtn('pro', 'Plan PRO')}
        {filterBtn('not_pro', 'Bez PRO')}
        {filterBtn('stripe', 'Stripe')}
        {filterBtn('no_sub', 'Bez subskrypcji')}
        {stats.archived > 0 ? filterBtn('archived', 'Zarchiwizowane') : null}
      </div>

      <div className="workspace-panel__sort workspace-panel__muted admin-tenant-directory__sort">
        <span className="admin-filter-label">Sortuj:</span>
        <button type="button" className={sortKey === 'createdAt' ? 'btn-ghost btn-ghost--active' : 'btn-ghost'} onClick={() => toggleSort('createdAt')}>
          Rejestracja{sortKey === 'createdAt' ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}
        </button>
        <button type="button" className={sortKey === 'name' ? 'btn-ghost btn-ghost--active' : 'btn-ghost'} onClick={() => toggleSort('name')}>
          Nazwa{sortKey === 'name' ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}
        </button>
        <button type="button" className={sortKey === 'invoices' ? 'btn-ghost btn-ghost--active' : 'btn-ghost'} onClick={() => toggleSort('invoices')}>
          Faktury{sortKey === 'invoices' ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}
        </button>
        <button type="button" className={sortKey === 'users' ? 'btn-ghost btn-ghost--active' : 'btn-ghost'} onClick={() => toggleSort('users')}>
          Użytkownicy{sortKey === 'users' ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}
        </button>
        <button type="button" className={sortKey === 'plan' ? 'btn-ghost btn-ghost--active' : 'btn-ghost'} onClick={() => toggleSort('plan')}>
          Plan{sortKey === 'plan' ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}
        </button>
      </div>

      {err && <p className="workspace-panel__err">{err}</p>}
      {loading && <p className="workspace-panel__muted">Ładowanie listy tenantów…</p>}
      {!loading && rows.length === 0 && <p className="workspace-panel__muted">Brak zarejestrowanych tenantów.</p>}

      {!loading && rows.length > 0 && (
        <div className="admin-tenant-table-wrap">
          <table className="admin-tenant-table">
            <thead>
              <tr>
                <th>Firma</th>
                <th>E-mail rejestracji</th>
                <th>NIP</th>
                <th>Plan</th>
                <th>PRO aktywne</th>
                <th>Status subskrypcji</th>
                <th>Stan</th>
                <th>Faktury</th>
                <th className="admin-tenant-table__col-actions">Akcje</th>
              </tr>
            </thead>
            <tbody>
              {filteredSorted.map((t) => {
                const isOpen = expanded.has(t.id)
                const sub = t.subscription
                const health = tenantHealth(t)
                const premium = isPremiumSubscriptionActive(t)
                const tenantActive = t.tenantAccountActive !== false
                const proCode = isProPlanCode(sub?.planCode)
                return (
                  <Fragment key={t.id}>
                    <tr className={`admin-tenant-table__row${t.deletedAt ? ' admin-tenant-table__row--archived' : ''}`}>
                      <td className="admin-tenant-table__cell-name">
                        <strong>{t.name}</strong>
                        <div className="workspace-panel__muted admin-tenant-table__sub">Od {formatDate(t.createdAt)} · {t.userCount} użytk.</div>
                      </td>
                      <td className="admin-tenant-table__mono admin-tenant-table__cell-email">
                        {t.registrationEmail?.trim() || '—'}
                      </td>
                      <td className="admin-tenant-table__mono">{t.nip?.trim() || '—'}</td>
                      <td>{planLabel(sub?.planCode)}</td>
                      <td>
                        {premium ? (
                          <span className="admin-health admin-health--ok">Tak</span>
                        ) : proCode ? (
                          <span className="admin-health admin-health--warn" title="Plan PRO, ale subskrypcja nie jest ACTIVE/TRIALING">
                            Nie ({sub?.status ?? '—'})
                          </span>
                        ) : (
                          <span className="admin-health admin-health--muted">Nie</span>
                        )}
                      </td>
                      <td>{sub?.status ?? '—'}</td>
                      <td>
                        <span className={`admin-health admin-health--${health.tone}`}>{health.label}</span>
                      </td>
                      <td>{t.invoiceCount}</td>
                      <td className="admin-tenant-table__col-actions">
                        <div className="admin-tenant-table__actions">
                          <button type="button" className="btn-ghost btn-ghost--sm" onClick={() => toggleExpand(t.id)} aria-expanded={isOpen}>
                            {isOpen ? 'Mniej' : 'Więcej'}
                          </button>
                          <button
                            type="button"
                            className="btn-primary btn-primary--sm"
                            disabled={!!t.deletedAt || !tenantActive || busyId === t.id}
                            onClick={() => void onEnter(t.id)}
                            title={t.deletedAt ? 'Tenant zarchiwizowany.' : !tenantActive ? 'Konto tenantu jest wyłączone.' : 'Wejdź na workspace tenanta'}
                          >
                            {busyId === t.id ? '…' : 'Konto'}
                          </button>
                        </div>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="admin-tenant-table__detail">
                        <td colSpan={9}>
                          <div className="admin-tenant-detail">
                            <div className="admin-tenant-detail__grid">
                              <dl className="admin-tenant-kv">
                                <dt>UUID</dt>
                                <dd className="admin-tenant-kv__mono">
                                  {t.id}{' '}
                                  <button type="button" className="btn-ghost" onClick={() => void copyText('UUID', t.id, showToast)}>
                                    Kopiuj
                                  </button>
                                </dd>
                                <dt>Okres rozliczenia</dt>
                                <dd>
                                  {sub ? (
                                    <>
                                      {formatDate(sub.currentPeriodStart)} → {formatDate(sub.currentPeriodEnd)}
                                      {sub.trialEndsAt ? (
                                        <>
                                          <br />
                                          Trial: {formatDate(sub.trialEndsAt)}
                                        </>
                                      ) : null}
                                    </>
                                  ) : (
                                    '—'
                                  )}
                                </dd>
                              </dl>
                              <dl className="admin-tenant-kv">
                                <dt>Stripe</dt>
                                <dd className="admin-tenant-kv__mono">
                                  {sub?.provider === 'STRIPE' ? (
                                    <>
                                      {sub.providerCustomerId ?? '—'}
                                      <br />
                                      {sub.providerSubscriptionId ?? '—'}
                                    </>
                                  ) : (
                                    sub?.provider ?? '—'
                                  )}
                                </dd>
                                <dt>Konto tenantu</dt>
                                <dd>
                                  {tenantActive ? (
                                    <span className="admin-health admin-health--ok">Aktywne</span>
                                  ) : (
                                    <span className="admin-health admin-health--bad">Wyłączone</span>
                                  )}
                                </dd>
                                <dt>Integracje</dt>
                                <dd className="workspace-panel__muted">
                                  Ingestion {t.connectors?.ingestionSources ?? 0} · Credentials {t.connectors?.integrationCredentials ?? 0} · POS{' '}
                                  {t.connectors?.integrationPos ?? 0}
                                  <br />
                                  KSeF: {t.ksef?.effectiveKsefEnv ?? '—'}, cred. {t.ksef?.credentialSource ?? '—'}, FA KSeF: {t.ksef?.ksefInvoiceCount ?? 0}
                                  {t.ksef?.lastSyncRunAt ? (
                                    <>
                                      <br />
                                      Ostatni sync: {formatDate(t.ksef.lastSyncRunAt)}
                                      {t.ksef.lastSyncOk != null ? ` (${t.ksef.lastSyncOk ? 'OK' : 'błąd'})` : ''}
                                    </>
                                  ) : null}
                                </dd>
                              </dl>
                            </div>
                            <div className="admin-tenant-table__actions admin-tenant-detail__actions">
                              <button
                                type="button"
                                className="btn-ghost btn-ghost--sm"
                                disabled={busyId === `${t.id}:pro` || premium}
                                onClick={() =>
                                  void runAction(`${t.id}:pro`, () => onSetManualPro(t.id), 'Ustawiono plan PRO (manual).')
                                }
                              >
                                {busyId === `${t.id}:pro` ? '…' : 'Nadaj PRO ręcznie'}
                              </button>
                              {t.deletedAt ? (
                                <button
                                  type="button"
                                  className="btn-ghost btn-ghost--sm"
                                  disabled={busyId === `${t.id}:unarchive`}
                                  onClick={() =>
                                    void runAction(`${t.id}:unarchive`, () => onUnarchive(t.id), 'Przywrócono tenant.')
                                  }
                                >
                                  {busyId === `${t.id}:unarchive` ? '…' : 'Przywróć tenant'}
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className="btn-ghost btn-ghost--sm"
                                  disabled={busyId === `${t.id}:archive`}
                                  onClick={() =>
                                    void runAction(`${t.id}:archive`, () => onArchive(t.id), 'Tenant zarchiwizowany.')
                                  }
                                >
                                  {busyId === `${t.id}:archive` ? '…' : 'Archiwizuj tenant'}
                                </button>
                              )}
                              {tenantActive ? (
                                <button
                                  type="button"
                                  className="btn-ghost btn-ghost--sm"
                                  disabled={busyId === `${t.id}:deactivate`}
                                  onClick={() =>
                                    void runAction(
                                      `${t.id}:deactivate`,
                                      () => onDeactivateUsers(t.id),
                                      'Wyłączono konto tenantu (użytkownicy nieaktywni).',
                                    )
                                  }
                                >
                                  {busyId === `${t.id}:deactivate` ? '…' : 'Wyłącz konto'}
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className="btn-ghost btn-ghost--sm"
                                  disabled={busyId === `${t.id}:activate`}
                                  onClick={() =>
                                    void runAction(
                                      `${t.id}:activate`,
                                      () => onActivateUsers(t.id),
                                      'Aktywowano konto tenantu.',
                                    )
                                  }
                                >
                                  {busyId === `${t.id}:activate` ? '…' : 'Aktywuj konto'}
                                </button>
                              )}
                            </div>
                            {(t.ksef?.lastSyncErrorPreview || (t.ksef?.lastQueueFinalFailure && t.ksef.lastQueueError)) && (
                              <div className="workspace-panel__err admin-tenant-warn" role="status">
                                {t.ksef?.lastSyncErrorPreview ? <div>Sync: {t.ksef.lastSyncErrorPreview.slice(0, 240)}</div> : null}
                                {t.ksef?.lastQueueFinalFailure && t.ksef.lastQueueError ? <div>Kolejka: {t.ksef.lastQueueError.slice(0, 240)}</div> : null}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="workspace-panel__muted admin-tenant-directory__footnote">
        Kolumna <strong>PRO aktywne</strong> = plan PRO oraz status <span className="mono">ACTIVE</span> lub <span className="mono">TRIALING</span>. Checklista
        produkcji: <span className="mono">backend/docs/go-live-checklist.md</span>.
      </p>
    </section>
  )
}
