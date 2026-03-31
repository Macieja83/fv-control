import { useMemo, useState } from 'react'
import { useAuth } from './auth/AuthContext'
import { Topbar } from './components/dashboard/Topbar'
import { KPICards } from './components/dashboard/KPICards'
import { FilterBar } from './components/dashboard/FilterBar'
import { InvoiceTable } from './components/dashboard/InvoiceTable'
import { DetailPanel } from './components/dashboard/DetailPanel'
import { useInvoiceDashboard } from './hooks/useInvoiceDashboard'
import './styles/dashboard.css'

export default function DashboardApp() {
  const { logout, user } = useAuth()
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof document === 'undefined') return 'light'
    return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
  })

  const {
    filtered,
    filters,
    setFilters,
    pickKpi,
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
    deleteFollowerDuplicates,
    followerDuplicateCount,
  } = useInvoiceDashboard()

  const linkedRow = useMemo(() => {
    if (!selected?.duplicate_of_id) return null
    return invoices.find((r) => r.id === selected.duplicate_of_id) ?? null
  }, [selected, invoices])

  const setThemeAndDom = (t: 'light' | 'dark') => {
    setTheme(t)
    document.documentElement.dataset.theme = t
  }

  return (
    <div className="app-shell">
      <Topbar
        theme={theme}
        onThemeChange={setThemeAndDom}
        userEmail={user?.email}
        onLogout={() => void logout()}
      />
      <main className="main-grid">
        <div className="main-col">
          <KPICards
            all={kpi.all}
            unpaidBiz={kpi.unpaidBiz}
            paid={kpi.paid}
            dups={kpi.dups}
            review={kpi.review}
            noCat={kpi.noCat}
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
            onDelete={deleteInvoice}
            followerDuplicateCount={followerDuplicateCount}
            onDeleteFollowerDuplicates={deleteFollowerDuplicates}
          />
        </div>
        <DetailPanel
          key={selected?.id ?? 'none'}
          row={selected}
          categories={categories}
          linkedRow={linkedRow}
          onClose={() => setSelectedId(null)}
          onPaid={setPaid}
          onUnpaid={setUnpaid}
          onCategory={setCategory}
          onPrivate={(id) => setScope(id, 'private')}
          onBusiness={(id) => setScope(id, 'business')}
          onConfirmDup={confirmDuplicate}
          onRejectDup={rejectDuplicate}
          onGoTo={goToLinked}
          onNotes={setNotes}
          onNeedsReview={setNeedsReview}
          onClearReview={clearReview}
          onDeleteInvoice={deleteInvoice}
        />
      </main>
    </div>
  )
}
