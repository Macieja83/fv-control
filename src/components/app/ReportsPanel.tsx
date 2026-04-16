import { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchInvoicesListAllPages } from '../../api/invoicesApi'
import { useAuth } from '../../auth/AuthContext'
import { getStoredToken } from '../../auth/session'
import { ALL_REPORT_CATEGORIES } from '../../data/categories'
import { seedInvoices } from '../../data/mockInvoices'
import { CategoryBarChart, type CategoryBarDatum } from '../dashboard/CategoryBarChart'
import { FilterBar } from '../dashboard/FilterBar'
import { matchesInvoiceFilters } from '../../lib/matchesInvoiceFilters'
import { enrichDuplicateMetadata } from '../../lib/duplicates'
import { mapApiInvoiceRowToRecord } from '../../lib/mapApiInvoice'
import type { CurrencyCode, InvoiceFilters, InvoiceRecord } from '../../types/invoice'
import { defaultReportsDateRange, EMPTY_FILTERS } from '../../types/invoice'

const USE_MOCK_INVOICES =
  import.meta.env.VITE_USE_MOCK_INVOICES === 'true' ||
  import.meta.env.VITE_USE_MOCK_INVOICES === '1'

const UNASSIGNED = 'Nieprzypisane'

function money(amount: number, currency: string) {
  const c = currency.length === 3 ? currency : 'PLN'
  try {
    return new Intl.NumberFormat('pl-PL', {
      style: 'currency',
      currency: c,
      maximumFractionDigits: 2,
    }).format(amount)
  } catch {
    return `${amount.toFixed(2)} ${c}`
  }
}

function aggregateForChart(
  rows: InvoiceRecord[],
  ledger: 'purchase' | 'sale',
  currency: CurrencyCode,
): CategoryBarDatum[] {
  const map = new Map<string, { sum: number; count: number }>()
  for (const r of rows) {
    const isSale = r.ledger_kind === 'sale'
    if (ledger === 'purchase' && isSale) continue
    if (ledger === 'sale' && !isSale) continue
    if (r.currency !== currency) continue
    const label = r.category?.trim() ? r.category.trim() : UNASSIGNED
    const prev = map.get(label) ?? { sum: 0, count: 0 }
    prev.sum += r.gross_amount
    prev.count += 1
    map.set(label, prev)
  }
  return [...map.entries()]
    .map(([label, { sum, count }]) => ({ label, value: sum, count, currency }))
    .sort((a, b) => b.value - a.value)
}

export type ReportsPanelProps = {
  /** Rosnie po każdej aktualizacji listy faktur w dashboardzie — wymusza ponowne pobranie danych do wykresów. */
  invoiceListEpoch: number
}

export function ReportsPanel({ invoiceListEpoch }: ReportsPanelProps) {
  const { status } = useAuth()
  const [filters, setFilters] = useState<InvoiceFilters>(() => ({
    ...EMPTY_FILTERS,
    ...defaultReportsDateRange(),
  }))
  const [rawRows, setRawRows] = useState<InvoiceRecord[]>([])
  /** Ostatnie poprawne pobranie było z API — nie stosuj ponownie filtra dat po stronie klienta. */
  const [reportDataFromApi, setReportDataFromApi] = useState(false)
  /** Łączna liczba faktur wg meta API (dla tego samego zapytania co stronicowanie). */
  const [apiTotal, setApiTotal] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  /**
   * Dev: GET /api/v1/invoices bez proxy do Fastify zwykle kończy się błędem (HTML z Vite zamiast JSON).
   * Wtedy pokazujemy seed + baner z instrukcją FV_RESTA_API_URL.
   */
  const [devDemoFallback, setDevDemoFallback] = useState(false)
  /** null = automatycznie (preferuj PLN, inaczej pierwsza waluta z danych) */
  const [userCurrency, setUserCurrency] = useState<string | null>(null)

  const load = useCallback(async () => {
    const token = getStoredToken()
    if (token) {
      setLoading(true)
      setErr(null)
      try {
        const df = filters.dateFrom.trim()
        const dt = filters.dateTo.trim()
        const res = await fetchInvoicesListAllPages(token, {
          limit: 100,
          maxPages: 200,
          ...(df ? { dateFrom: df } : {}),
          ...(dt ? { dateTo: dt } : {}),
        })
        setRawRows(enrichDuplicateMetadata(res.data.map(mapApiInvoiceRowToRecord)))
        setApiTotal(typeof res.meta.total === 'number' ? res.meta.total : null)
        setReportDataFromApi(true)
        setDevDemoFallback(false)
      } catch (e) {
        const msg =
          e instanceof Error && e.message.trim()
            ? e.message.trim()
            : 'Nie udało się wczytać faktur do raportu.'
        if (import.meta.env.DEV) {
          setRawRows(enrichDuplicateMetadata(seedInvoices()))
          setApiTotal(null)
          setReportDataFromApi(false)
          setDevDemoFallback(true)
          setErr(null)
        } else {
          setErr(msg)
          setRawRows([])
          setApiTotal(null)
          setReportDataFromApi(false)
          setDevDemoFallback(false)
        }
      } finally {
        setLoading(false)
      }
      return
    }

    if (USE_MOCK_INVOICES) {
      setRawRows(enrichDuplicateMetadata(seedInvoices()))
      setApiTotal(null)
      setReportDataFromApi(false)
      setDevDemoFallback(false)
      setErr(null)
      setLoading(false)
      return
    }

    setErr('Zaloguj się — raport liczy się z faktur zapisanych w bazie (API).')
    setRawRows([])
    setApiTotal(null)
    setReportDataFromApi(false)
    setDevDemoFallback(false)
    setLoading(false)
  }, [filters.dateFrom, filters.dateTo])

  useEffect(() => {
    void load()
  }, [load, status, invoiceListEpoch])

  const optionRows = useMemo(
    () => rawRows.filter((r) => r.invoice_status !== 'INGESTING'),
    [rawRows],
  )

  const suppliers = useMemo(
    () => [...new Set(optionRows.map((r) => r.supplier_name))].sort(),
    [optionRows],
  )
  const restaurants = useMemo(
    () => [...new Set(optionRows.map((r) => r.restaurant_name))].sort(),
    [optionRows],
  )

  const filtered = useMemo(
    () =>
      optionRows.filter((r) =>
        matchesInvoiceFilters(r, filters, {
          omitDateRange: reportDataFromApi || devDemoFallback,
        }),
      ),
    [optionRows, filters, reportDataFromApi, devDemoFallback],
  )

  const currenciesInFiltered = useMemo(
    () => [...new Set(filtered.map((r) => r.currency))].sort(),
    [filtered],
  )

  useEffect(() => {
    if (userCurrency && !currenciesInFiltered.includes(userCurrency as CurrencyCode)) {
      setUserCurrency(null)
    }
  }, [currenciesInFiltered, userCurrency])

  const effectiveCurrency = useMemo((): CurrencyCode => {
    if (userCurrency && currenciesInFiltered.includes(userCurrency as CurrencyCode))
      return userCurrency as CurrencyCode
    if (currenciesInFiltered.includes('PLN')) return 'PLN'
    return (currenciesInFiltered[0] as CurrencyCode | undefined) ?? 'PLN'
  }, [userCurrency, currenciesInFiltered])

  const purchaseData = useMemo(
    () => aggregateForChart(filtered, 'purchase', effectiveCurrency),
    [filtered, effectiveCurrency],
  )
  const saleData = useMemo(
    () => aggregateForChart(filtered, 'sale', effectiveCurrency),
    [filtered, effectiveCurrency],
  )

  return (
    <main className="main-content main-content--padded">
      <div className="workspace-panel reports-panel">
        <header className="workspace-panel__head">
          <h2 className="workspace-panel__title">Raporty</h2>
          <p className="workspace-panel__lead">
            Wykresy sum brutto według kategorii — dane z <strong>API / bazy</strong> po zalogowaniu (jak lista faktur,
            bez podziału na koszt/sprzedaż w zapytaniu). Te same filtry co na fakturach: dostawca, kategoria, płatność,
            typ… Domyślnie od <strong>początku bieżącego miesiąca do dzisiaj</strong> — możesz zmienić <strong>Od–Do</strong> w
            filtrach. Lista i wykresy odświeżają się automatycznie po dodaniu lub zmianie faktury (ta sama synchronizacja co
            zakładka Faktury).
            Faktury w imporcie (INGESTING) są pomijane.
          </p>
        </header>

        {err ? <p className="workspace-panel__err">{err}</p> : null}

        {devDemoFallback ? (
          <div className="app-banner" role="status" style={{ marginBottom: '0.75rem' }}>
            <strong>Tryb dev — brak działającego API pod listę faktur.</strong> Vite obsługuje tylko logowanie; bez{' '}
            <span className="mono">FV_RESTA_API_URL</span> żądanie <span className="mono">GET /api/v1/invoices</span> nie
            trafia do backendu. Pokazano <strong>przykładowe dane z kodu</strong> (seed). Żeby zobaczyć bazę: uruchom{' '}
            <span className="mono">npm run dev</span> w folderze <span className="mono">backend</span> i w{' '}
            <span className="mono">.env</span> (katalog główny) ustaw{' '}
            <span className="mono">FV_RESTA_API_URL=http://localhost:3000</span>, potem zrestartuj Vite.
          </div>
        ) : null}

        {!loading && !err && status === 'authed' && reportDataFromApi && rawRows.length === 0 ? (
          <p className="workspace-panel__muted" role="status">
            API nie zwróciło żadnej faktury dla zakresu <span className="mono">{filters.dateFrom}</span> —{' '}
            <span className="mono">{filters.dateTo}</span>. Rozszerz daty w filtrach albo dodaj faktury w zakładce Faktury
            (raport zaktualizuje się po synchronizacji listy).
          </p>
        ) : null}

        {!loading &&
        !err &&
        optionRows.length > 0 &&
        filtered.length === 0 ? (
          <p className="workspace-panel__muted" role="status">
            Wczytano {optionRows.length} faktur{apiTotal != null ? ` (API: łącznie ${apiTotal})` : ''}, ale bieżące
            filtry (np. dostawca, kategoria, typ) wykluczają wszystkie — poluzuj filtry w pasku powyżej.
          </p>
        ) : null}

        <FilterBar
          filters={filters}
          onChange={setFilters}
          suppliers={suppliers}
          restaurants={restaurants}
          categories={ALL_REPORT_CATEGORIES}
        />

        <div className="reports-toolbar">
          <label className="field field--inline reports-toolbar__currency">
            <span className="field__label">Waluta wykresu</span>
            <select
              className="input"
              value={currenciesInFiltered.length === 0 ? '' : effectiveCurrency}
              onChange={(e) => setUserCurrency(e.target.value)}
              disabled={loading || currenciesInFiltered.length === 0}
            >
              {currenciesInFiltered.length === 0 ? (
                <option value="">—</option>
              ) : (
                currenciesInFiltered.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))
              )}
            </select>
          </label>
          <p className="workspace-panel__muted reports-toolbar__hint">
            {loading
              ? 'Wczytywanie…'
              : reportDataFromApi && apiTotal != null
                ? `Z API: ${rawRows.length} wczytanych / ${apiTotal} pasujących do zapytania · po filtrach UI: ${filtered.length} · waluty: ${currenciesInFiltered.join(', ') || '—'}`
                : `Po filtrach: ${filtered.length} faktur · waluty: ${currenciesInFiltered.join(', ') || '—'}`}
          </p>
        </div>

        <div className="reports-chart-grid">
          <section className="reports-chart-card">
            <h3 className="workspace-panel__h3">Wydatki (zakupy)</h3>
            <CategoryBarChart
              variant="purchase"
              data={purchaseData}
              formatMoney={money}
              emptyHint="Brak kosztów w wybranej walucie i filtrach."
            />
          </section>
          <section className="reports-chart-card">
            <h3 className="workspace-panel__h3">Przychody (sprzedaż)</h3>
            <CategoryBarChart
              variant="sale"
              data={saleData}
              formatMoney={money}
              emptyHint="Brak sprzedaży w wybranej walucie i filtrach."
            />
          </section>
        </div>
      </div>
    </main>
  )
}
