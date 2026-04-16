import { useCallback, useMemo, useState } from 'react'
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

async function copyText(label: string, text: string, onDone: (msg: string) => void) {
  try {
    await navigator.clipboard.writeText(text)
    onDone(`Skopiowano: ${label}`)
  } catch {
    onDone('Nie udało się skopiować (przeglądarka zablokowała schowek).')
  }
}

export function AdminTenantDirectory(props: AdminTenantDirectoryProps) {
  const { rows, ksefRows, connectors, loading, err, onReload, onImpersonate } = props
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
    const stripe = rows.filter((r) => r.subscription?.provider === 'STRIPE').length
    const archived = rows.filter((r) => r.deletedAt).length
    return { total: rows.length, pro, stripe, archived }
  }, [rows])

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
        return (
          t.name.toLowerCase().includes(q) ||
          t.id.toLowerCase().includes(q) ||
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
          <span className="admin-stat-pill__label">PRO</span>
          <span className="admin-stat-pill__value">{stats.pro}</span>
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
            placeholder="Nazwa, NIP, UUID, plan, status, Stripe customer/sub…"
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
        {filterBtn('pro', 'PRO')}
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
      {loading && <p className="workspace-panel__muted">Ładowanie katalogu tenantów…</p>}
      {!loading && rows.length === 0 && <p className="workspace-panel__muted">Brak zarejestrowanych tenantów.</p>}

      {!loading && rows.length > 0 && (
        <div className="admin-tenant-card-list">
          {filteredSorted.map((t) => {
            const isOpen = expanded.has(t.id)
            const plan = (t.subscription?.planCode ?? '').toLowerCase()
            const sub = t.subscription
            return (
              <article key={t.id} className={`admin-tenant-card${t.deletedAt ? ' admin-tenant-card--archived' : ''}`}>
                <header className="admin-tenant-card__head">
                  <div className="admin-tenant-card__title-block">
                    <h3 className="admin-tenant-card__title">{t.name}</h3>
                    <div className="admin-tenant-badges">
                      {t.deletedAt ? <span className="admin-pill admin-pill--archived">Zarchiwizowany</span> : null}
                      <span className={`admin-pill admin-pill--plan-${plan === 'pro' ? 'pro' : 'muted'}`}>{planLabel(sub?.planCode)}</span>
                      {sub ? <span className="admin-pill admin-pill--muted">{sub.status}</span> : <span className="admin-pill admin-pill--warn">Brak wpisu subskrypcji</span>}
                      {sub?.provider ? <span className="admin-pill admin-pill--stripe">{sub.provider}</span> : null}
                    </div>
                  </div>
                  <div className="admin-tenant-card__actions">
                    <button type="button" className="btn-ghost" onClick={() => toggleExpand(t.id)} aria-expanded={isOpen}>
                      {isOpen ? 'Zwiń szczegóły' : 'Szczegóły'}
                    </button>
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={!!t.deletedAt || busyId === t.id}
                      onClick={() => void onEnter(t.id)}
                      title={t.deletedAt ? 'Tenant zarchiwizowany — impersonacja wyłączona.' : 'Wejdź na workspace tenanta (impersonacja)'}
                    >
                      {busyId === t.id ? 'Łączenie…' : 'Wejdź na konto'}
                    </button>
                  </div>
                </header>

                <div className="admin-tenant-card__grid">
                  <dl className="admin-tenant-kv">
                    <dt>NIP</dt>
                    <dd>{t.nip?.trim() || '—'}</dd>
                    <dt>Rejestracja</dt>
                    <dd>{formatDate(t.createdAt)}</dd>
                    <dt>Użytkownicy</dt>
                    <dd>{t.userCount}</dd>
                    <dt>Faktury (łącznie)</dt>
                    <dd>{t.invoiceCount}</dd>
                  </dl>
                  <dl className="admin-tenant-kv">
                    <dt>Subskrypcja</dt>
                    <dd>
                      {sub ? (
                        <>
                          Okres: {formatDate(sub.currentPeriodStart)} → {formatDate(sub.currentPeriodEnd)}
                          {sub.trialEndsAt ? (
                            <>
                              <br />
                              Trial do: {formatDate(sub.trialEndsAt)}
                            </>
                          ) : null}
                        </>
                      ) : (
                        '—'
                      )}
                    </dd>
                    <dt>Stripe</dt>
                    <dd className="admin-tenant-kv__mono">
                      {sub?.provider === 'STRIPE' ? (
                        <>
                          customer: {sub.providerCustomerId ?? '—'}
                          <br />
                          subscription: {sub.providerSubscriptionId ?? '—'}
                        </>
                      ) : (
                        '—'
                      )}
                    </dd>
                  </dl>
                </div>

                <div className="admin-tenant-card__integrations">
                  <div className="admin-tenant-card__integrations-title">Integracje (skrót)</div>
                  <div className="workspace-panel__muted admin-tenant-inline">
                    <strong>Connectory:</strong> ingestion {t.connectors?.ingestionSources ?? 0}, credentials {t.connectors?.integrationCredentials ?? 0}, POS{' '}
                    {t.connectors?.integrationPos ?? 0}
                    <span className="admin-dot">·</span>
                    <strong>KSeF:</strong> API {t.ksef?.effectiveKsefEnv ?? '—'}, poświadczenia {t.ksef?.credentialSource ?? '—'}, faktury KSeF w bazie {t.ksef?.ksefInvoiceCount ?? 0}
                    {t.ksef?.lastSyncRunAt ? (
                      <>
                        <span className="admin-dot">·</span>
                        ostatni sync {formatDate(t.ksef.lastSyncRunAt)}
                        {t.ksef.lastSyncOk != null ? ` (${t.ksef.lastSyncOk ? 'OK' : 'błąd'})` : ''}
                      </>
                    ) : null}
                  </div>
                  {(t.ksef?.lastSyncErrorPreview || (t.ksef?.lastQueueFinalFailure && t.ksef.lastQueueError)) && (
                    <div className="workspace-panel__err admin-tenant-warn" role="status">
                      {t.ksef?.lastSyncErrorPreview ? <div>Sync: {t.ksef.lastSyncErrorPreview.slice(0, 220)}</div> : null}
                      {t.ksef?.lastQueueFinalFailure && t.ksef.lastQueueError ? (
                        <div>Kolejka: {t.ksef.lastQueueError.slice(0, 220)}</div>
                      ) : null}
                    </div>
                  )}
                </div>

                {isOpen && (
                  <footer className="admin-tenant-card__expand">
                    <div className="admin-tenant-kv admin-tenant-kv--full">
                      <dt>UUID tenanta</dt>
                      <dd className="admin-tenant-kv__mono">
                        {t.id}{' '}
                        <button type="button" className="btn-ghost" onClick={() => void copyText('UUID', t.id, showToast)}>
                          Kopiuj
                        </button>
                      </dd>
                      {sub?.provider === 'STRIPE' && sub.providerCustomerId ? (
                        <>
                          <dt>Stripe customer (pełny)</dt>
                          <dd className="admin-tenant-kv__mono">
                            {sub.providerCustomerId}{' '}
                            <button type="button" className="btn-ghost" onClick={() => void copyText('customer id', sub.providerCustomerId!, showToast)}>
                              Kopiuj
                            </button>
                          </dd>
                        </>
                      ) : null}
                      {sub?.provider === 'STRIPE' && sub.providerSubscriptionId ? (
                        <>
                          <dt>Stripe subscription (pełny)</dt>
                          <dd className="admin-tenant-kv__mono">
                            {sub.providerSubscriptionId}{' '}
                            <button type="button" className="btn-ghost" onClick={() => void copyText('subscription id', sub.providerSubscriptionId!, showToast)}>
                              Kopiuj
                            </button>
                          </dd>
                        </>
                      ) : null}
                      {t.deletedAt ? (
                        <>
                          <dt>Zarchiwizowano</dt>
                          <dd>{formatDate(t.deletedAt)}</dd>
                        </>
                      ) : null}
                    </div>
                  </footer>
                )}
              </article>
            )
          })}
        </div>
      )}

      <p className="workspace-panel__muted admin-tenant-directory__footnote">
        Rozliczenia Stripe obsługujesz w Stripe Dashboard; webhook: <span className="mono">/api/v1/billing/webhooks/stripe</span>. Pełna checklista produkcji:{' '}
        <span className="mono">backend/docs/go-live-checklist.md</span>.
      </p>
    </section>
  )
}
