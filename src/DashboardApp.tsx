import { useEffect, useMemo, useState } from 'react'
import { useAuth } from './auth/AuthContext'
import { ActivityDrawer } from './components/app/ActivityDrawer'
import type { AppNavKey } from './components/app/appNav'
import { ContractorsPanel } from './components/app/ContractorsPanel'
import { DocumentsPanel } from './components/app/DocumentsPanel'
import { PaymentsPanel } from './components/app/PaymentsPanel'
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

export default function DashboardApp() {
  const { logout, user } = useAuth()
  const [nav, setNav] = useState<AppNavKey>('invoices')
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
    enqueueKsefPortalSync,
    adoptInvoiceVendor,
    sendInvoiceToKsef,
    createSalesInvoice,
  } = useInvoiceDashboard()

  useEffect(() => {
    if (nav !== 'invoices') setSelectedId(null)
  }, [nav, setSelectedId])

  const linkedRow = useMemo(() => {
    if (!selected?.duplicate_of_id) return null
    return invoices.find((r) => r.id === selected.duplicate_of_id) ?? null
  }, [selected, invoices])

  const setThemeAndDom = (t: 'light' | 'dark') => {
    setTheme(t)
    document.documentElement.dataset.theme = t
  }

  const activityBadge = kpi.review + kpi.unknownVendor

  return (
    <div className="app-shell">
      {listError && (
        <div className="app-banner app-banner--error" role="alert">
          {listError}
        </div>
      )}
      <Topbar
        theme={theme}
        onThemeChange={setThemeAndDom}
        userEmail={user?.email}
        onLogout={() => void logout()}
        onOpenActivity={() => setActivityOpen(true)}
        activityUnread={activityBadge}
        nav={nav}
        onNavChange={setNav}
      />
      {nav === 'invoices' && (
        <main className="main-content">
          <InvoiceLedgerTabs value={invoiceLedger} onChange={setInvoiceLedger} />
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
          {invoiceLedger === 'purchase' && (
            <div className="ksef-sync-bar">
              <InvoiceUpload onUploaded={() => void refreshFromApi()} />
              {dataSource === 'api' && (
                <div className="ksef-sync-bar__side">
                  <button
                    type="button"
                    className="btn btn--sm"
                    title="Pobiera z API MF faktury kosztowe od ostatniej synchronizacji. Filtr „Od–Do” to data wystawienia z faktury, nie data trwałego zapisu w KSeF."
                    onClick={() => void enqueueKsefPortalSync()}
                  >
                    Pobierz z KSeF teraz
                  </button>
                  <span className="ksef-sync-bar__hint">
                    Lista filtruje po <strong>dacie wystawienia</strong> z faktury; KSeF indeksuje też{' '}
                    <strong>datę trwałego zapisu</strong> — mogą się różnić o 1 dzień lub więcej.
                  </span>
                </div>
              )}
            </div>
          )}
          {invoiceLedger === 'sale' && (
            <div className="upload-bar" style={{ marginBottom: '0.5rem' }}>
              <button type="button" className="upload-bar__btn upload-bar__btn--camera" onClick={() => setSalesDialogOpen(true)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
                <span>Nowa faktura sprzedaży</span>
              </button>
            </div>
          )}
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
      {nav === 'documents' && (
        <main className="main-content main-content--padded">
          <DocumentsPanel />
        </main>
      )}
      {nav === 'payments' && (
        <main className="main-content main-content--padded">
          <PaymentsPanel />
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
      {nav === 'invoices' && (
        <DetailPanel
          key={selected?.id ?? 'none'}
          row={selected}
          categories={categories}
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
