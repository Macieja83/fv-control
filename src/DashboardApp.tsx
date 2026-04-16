import { useEffect, useMemo, useState } from 'react'
import { useAuth } from './auth/AuthContext'
import { ActivityDrawer } from './components/app/ActivityDrawer'
import { AdminPanel } from './components/app/AdminPanel'
import { ImpersonationBanner } from './components/app/ImpersonationBanner'
import { OnboardingChecklistBanner } from './components/app/OnboardingChecklistBanner'
import {
  APP_NAV_ITEMS,
  PLATFORM_ADMIN_NAV_ITEM,
  type AppNavKey,
} from './components/app/appNav'
import { ContractorsPanel } from './components/app/ContractorsPanel'
import { DocumentsPanel } from './components/app/DocumentsPanel'
import { ReportsPanel } from './components/app/ReportsPanel'
import { SettingsPanel } from './components/app/SettingsPanel'
import { Topbar } from './components/dashboard/Topbar'
import { KPICards } from './components/dashboard/KPICards'
import { FilterBar } from './components/dashboard/FilterBar'
import { InvoiceTable } from './components/dashboard/InvoiceTable'
import { DetailPanel } from './components/dashboard/DetailPanel'
import { InvoiceLedgerTabs } from './components/dashboard/InvoiceLedgerTabs'
import { InvoiceUpload } from './components/dashboard/InvoiceUpload'
import { SalesInvoiceDialog } from './components/dashboard/SalesInvoiceDialog'
import { useInvoiceDashboard } from './hooks/useInvoiceDashboard'
import './styles/dashboard.css'

function readNavFromLocation(): AppNavKey {
  if (typeof window === 'undefined') return 'invoices'
  const q = new URLSearchParams(window.location.search)
  const raw = q.get('nav')
  if (raw === 'plan' || raw === 'payments') return 'settings'
  const keys: AppNavKey[] = [
    'invoices',
    'reports',
    'documents',
    'contractors',
    'settings',
    'admin',
  ]
  if (raw && (keys as string[]).includes(raw)) return raw as AppNavKey
  if (q.get('billing')) return 'settings'
  return 'invoices'
}

export default function DashboardApp() {
  const { logout, user } = useAuth()
  const [nav, setNav] = useState<AppNavKey>(() => readNavFromLocation())
  const [activityOpen, setActivityOpen] = useState(false)
  const [salesDialogOpen, setSalesDialogOpen] = useState(false)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof document === 'undefined') return 'light'
    return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
  })

  const {
    filtered,
    filters,
    setFilters,
    pickKpi,
    invoiceLedger,
    setInvoiceLedger,
    kpi,
    suppliers,
    restaurants,
    categories,
    setSelectedId,
    selected,
    invoices,
    setPaid,
    setUnpaid,
    setCategory,
    setScope,
    confirmDuplicate,
    rejectDuplicate,
    goToLinked,
    setNotes,
    setNeedsReview,
    clearReview,
    deleteInvoice,
    bulkMarkPaid,
    bulkMarkUnpaid,
    bulkMarkNeedsReview,
    bulkMarkReviewOk,
    bulkDeleteInvoices,
    deleteFollowerDuplicates,
    followerDuplicateCount,
    listLoading,
    listError,
    dataSource,
    categoryLocalOnly,
    refreshFromApi,
    retryInvoiceExtraction,
    syncKsefInvoiceFromApi,
    adoptInvoiceVendor,
    sendInvoiceToKsef,
    createSalesInvoice,
  } = useInvoiceDashboard()

  useEffect(() => {
    if (nav !== 'invoices') setSelectedId(null)
  }, [nav, setSelectedId])

  const topNavTabs = useMemo(
    () =>
      user?.isPlatformAdmin && !user?.impersonation?.active
        ? [...APP_NAV_ITEMS, PLATFORM_ADMIN_NAV_ITEM]
        : APP_NAV_ITEMS,
    [user?.isPlatformAdmin, user?.impersonation?.active],
  )

  useEffect(() => {
    if (nav === 'admin' && (!user?.isPlatformAdmin || user?.impersonation?.active)) setNav('invoices')
  }, [nav, user?.isPlatformAdmin, user?.impersonation?.active])

  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    if (!q.has('billing') && !q.has('nav')) return
    q.delete('billing')
    q.delete('nav')
    const s = q.toString()
    window.history.replaceState({}, '', `${window.location.pathname}${s ? `?${s}` : ''}${window.location.hash}`)
  }, [])

  const linkedRow = useMemo(() => {
    if (!selected?.duplicate_of_id) return null
    return invoices.find((r) => r.id === selected.duplicate_of_id) ?? null
  }, [selected, invoices])

  const setThemeAndDom = (t: 'light' | 'dark') => {
    setTheme(t)
    document.documentElement.dataset.theme = t
  }

  const activityBadge = kpi.review + kpi.unknownVendor

  const impersonationLabel =
    user?.impersonation?.active === true
      ? user.impersonation.effectiveTenantName?.trim() ||
        user.impersonation.effectiveTenantId.slice(0, 8) + '…'
      : null

  return (
    <div className="app-shell">
      {listError && (
        <div className="app-banner app-banner--error" role="alert">
          {listError}
        </div>
      )}
      {impersonationLabel && <ImpersonationBanner tenantLabel={impersonationLabel} />}
      <Topbar
        theme={theme}
        onThemeChange={setThemeAndDom}
        userEmail={user?.email}
        onLogout={() => void logout()}
        onOpenActivity={() => setActivityOpen(true)}
        activityUnread={activityBadge}
        nav={nav}
        onNavChange={setNav}
        navTabs={topNavTabs}
      />
      {!user?.isPlatformAdmin && (
        <OnboardingChecklistBanner user={user} onGoToNav={setNav} />
      )}
      {nav === 'invoices' && (
        <main className="main-content">
          <div className="invoice-toolbar">
            <InvoiceLedgerTabs value={invoiceLedger} onChange={setInvoiceLedger} />
            <div className="invoice-toolbar__actions">
              {invoiceLedger === 'purchase' && <InvoiceUpload onUploaded={() => void refreshFromApi()} />}
              {invoiceLedger === 'sale' && (
                <div className="upload-bar upload-bar--toolbar">
                  <button type="button" className="upload-bar__btn upload-bar__btn--camera" onClick={() => setSalesDialogOpen(true)}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
                    <span>Nowa faktura sprzedaży</span>
                  </button>
                </div>
              )}
            </div>
          </div>
          <KPICards
            all={kpi.all}
            unpaidBiz={kpi.unpaidBiz}
            paid={kpi.paid}
            dups={kpi.dups}
            review={kpi.review}
            noCat={kpi.noCat}
            unknownVendor={kpi.unknownVendor}
            onPickFilter={pickKpi}
          />
          <FilterBar
            filters={filters}
            onChange={setFilters}
            suppliers={suppliers}
            restaurants={restaurants}
            categories={categories}
          />
          <InvoiceTable
            rows={filtered}
            selectedId={selected?.id ?? null}
            onSelect={(id) => setSelectedId(id)}
            onDelete={(id) => void deleteInvoice(id)}
            followerDuplicateCount={followerDuplicateCount}
            onDeleteFollowerDuplicates={() => void deleteFollowerDuplicates()}
            loading={listLoading}
            dataSource={dataSource}
            onBulkMarkPaid={(ids) => bulkMarkPaid(ids)}
            onBulkMarkUnpaid={(ids) => bulkMarkUnpaid(ids)}
            onBulkMarkNeedsReview={(ids) => bulkMarkNeedsReview(ids)}
            onBulkMarkReviewOk={(ids) => bulkMarkReviewOk(ids)}
            onBulkDelete={(ids) => bulkDeleteInvoices(ids)}
          />
        </main>
      )}
      {nav === 'reports' && <ReportsPanel />}
      {nav === 'documents' && (
        <main className="main-content main-content--padded">
          <DocumentsPanel />
        </main>
      )}
      {nav === 'contractors' && (
        <main className="main-content main-content--padded">
          <ContractorsPanel />
        </main>
      )}
      {nav === 'settings' && (
        <main className="main-content main-content--padded">
          <SettingsPanel />
        </main>
      )}
      {nav === 'admin' && user?.isPlatformAdmin && (
        <main className="main-content main-content--padded">
          <AdminPanel />
        </main>
      )}
      {nav === 'invoices' && (
        <DetailPanel
          key={selected?.id ?? 'none'}
          row={selected}
          linkedRow={linkedRow}
          categoryLocalOnly={categoryLocalOnly}
          onClose={() => setSelectedId(null)}
          onPaid={(id) => void setPaid(id)}
          onUnpaid={(id) => void setUnpaid(id)}
          onCategory={setCategory}
          onPrivate={(id) => void setScope(id, 'private')}
          onBusiness={(id) => void setScope(id, 'business')}
          onConfirmDup={confirmDuplicate}
          onRejectDup={rejectDuplicate}
          onGoTo={goToLinked}
          onNotes={(id, notes) => void setNotes(id, notes)}
          onNeedsReview={(id) => void setNeedsReview(id)}
          onClearReview={(id) => void clearReview(id)}
          onRetryExtraction={(id) => void retryInvoiceExtraction(id)}
          onKsefSync={(id) => void syncKsefInvoiceFromApi(id)}
          onRefreshList={() => void refreshFromApi()}
          onDeleteInvoice={(id) => void deleteInvoice(id)}
          onSendToKsef={(id) => void sendInvoiceToKsef(id)}
          onAdoptVendor={(id, body) => void adoptInvoiceVendor(id, body)}
        />
      )}
      <ActivityDrawer open={activityOpen} onClose={() => setActivityOpen(false)} />
      <SalesInvoiceDialog
        open={salesDialogOpen}
        onClose={() => setSalesDialogOpen(false)}
        onSubmit={(body, opts) => createSalesInvoice(body, opts)}
      />
    </div>
  )
}
