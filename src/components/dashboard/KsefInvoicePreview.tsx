/**
 * Renders a KSeF FA XML as a formatted invoice document,
 * resembling a standard Polish invoice layout.
 */

type KsefInvoiceData = {
  invoiceNumber: string
  issueDate: string
  saleDate: string
  currency: string
  seller: { nip: string; name: string; address: string }
  buyer: { nip: string; name: string; address: string }
  netTotal: string
  vatTotal: string
  grossTotal: string
  dueDate: string
  paymentForm: string
  bankAccount: string
  lineItems: Array<{
    no: number
    name: string
    quantity: string
    unit: string
    netPrice: string
    vatRate: string
    netValue: string
    grossValue: string
  }>
  invoiceType: string
}

function dig(obj: unknown, ...keys: string[]): unknown {
  let cur = obj
  for (const k of keys) {
    if (cur == null || typeof cur !== 'object') return undefined
    const rec = cur as Record<string, unknown>
    cur = rec[k]
    if (Array.isArray(cur) && cur.length === 1) cur = cur[0]
  }
  return cur
}

function s(v: unknown): string {
  if (v == null) return ''
  return String(v).trim()
}

function n(v: unknown): string {
  if (v == null) return '0.00'
  const num = Number(v)
  return Number.isFinite(num) ? num.toFixed(2) : '0.00'
}

const PAYMENT_FORMS: Record<string, string> = {
  '1': 'Gotówka',
  '2': 'Karta',
  '3': 'Bon',
  '4': 'Czek',
  '5': 'Kredyt',
  '6': 'Przelew',
  '7': 'Płatność mobilna',
}

function parseKsefXml(xmlText: string): KsefInvoiceData | null {
  try {
    const dom = new DOMParser().parseFromString(xmlText, 'text/xml')
    if (dom.querySelector('parsererror')) return null

    const ns = dom.documentElement.namespaceURI ?? ''
    const q = (parent: Element | Document, tag: string): Element | null =>
      parent.getElementsByTagNameNS(ns, tag)[0] ?? parent.getElementsByTagName(tag)[0] ?? null

    const fa = q(dom, 'Fa')
    if (!fa) return null

    const podmiot1 = q(dom, 'Podmiot1')
    const podmiot2 = q(dom, 'Podmiot2')

    const sellerDane = podmiot1 ? q(podmiot1, 'DaneIdentyfikacyjne') : null
    const sellerAddr = podmiot1 ? q(podmiot1, 'Adres') : null
    const buyerDane = podmiot2 ? q(podmiot2, 'DaneIdentyfikacyjne') : null
    const buyerAddr = podmiot2 ? q(podmiot2, 'Adres') : null

    const txt = (parent: Element | null, tag: string): string => {
      if (!parent) return ''
      const el = q(parent, tag)
      return el?.textContent?.trim() ?? ''
    }

    const platnosc = q(fa, 'Platnosc')
    const terminEl = platnosc ? q(platnosc, 'TerminPlatnosci') : null
    const rachunekEl = platnosc ? q(platnosc, 'RachunekBankowy') : null

    const wiersze = fa.getElementsByTagNameNS(ns, 'FaWiersz')
    const wierszeFallback = wiersze.length ? wiersze : fa.getElementsByTagName('FaWiersz')
    const lineItems: KsefInvoiceData['lineItems'] = []
    for (let i = 0; i < wierszeFallback.length; i++) {
      const w = wierszeFallback[i]!
      lineItems.push({
        no: i + 1,
        name: txt(w, 'P_7'),
        quantity: n(txt(w, 'P_8B')),
        unit: txt(w, 'P_8A') || 'szt.',
        netPrice: n(txt(w, 'P_9A')),
        vatRate: txt(w, 'P_12') || '23',
        netValue: n(txt(w, 'P_11')),
        grossValue: txt(w, 'P_11A')
          ? n(txt(w, 'P_11A'))
          : (parseFloat(n(txt(w, 'P_11'))) * (1 + parseFloat(txt(w, 'P_12') || '23') / 100)).toFixed(2),
      })
    }

    const netTotal =
      txt(fa, 'P_13_1') || txt(fa, 'P_13_2') || txt(fa, 'P_13_3') || '0'
    const vatTotal =
      txt(fa, 'P_14_1') || txt(fa, 'P_14_2') || txt(fa, 'P_14_3') || '0'
    const grossTotal = txt(fa, 'P_15') || (parseFloat(n(netTotal)) + parseFloat(n(vatTotal))).toFixed(2)

    return {
      invoiceNumber: txt(fa, 'P_2'),
      issueDate: s(txt(fa, 'P_1')).slice(0, 10),
      saleDate: s(txt(fa, 'P_6')).slice(0, 10),
      currency: txt(fa, 'KodWaluty') || 'PLN',
      seller: {
        nip: txt(sellerDane, 'NIP'),
        name: txt(sellerDane, 'Nazwa'),
        address: [txt(sellerAddr, 'AdresL1'), txt(sellerAddr, 'AdresL2')].filter(Boolean).join(', '),
      },
      buyer: {
        nip: txt(buyerDane, 'NIP'),
        name: txt(buyerDane, 'Nazwa'),
        address: [txt(buyerAddr, 'AdresL1'), txt(buyerAddr, 'AdresL2')].filter(Boolean).join(', '),
      },
      netTotal: n(netTotal),
      vatTotal: n(vatTotal),
      grossTotal: n(grossTotal),
      dueDate: terminEl ? s(txt(terminEl, 'Termin')).slice(0, 10) : '',
      paymentForm: PAYMENT_FORMS[txt(platnosc, 'FormaPlatnosci')] ?? txt(platnosc, 'FormaPlatnosci'),
      bankAccount: rachunekEl ? txt(rachunekEl, 'NrRB') : '',
      lineItems,
      invoiceType: txt(fa, 'RodzajFaktury') || 'VAT',
    }
  } catch {
    return null
  }
}

function formatAccountNumber(nr: string): string {
  const clean = nr.replace(/\s/g, '')
  if (clean.length === 26) {
    return `${clean.slice(0, 2)} ${clean.slice(2, 6)} ${clean.slice(6, 10)} ${clean.slice(10, 14)} ${clean.slice(14, 18)} ${clean.slice(18, 22)} ${clean.slice(22, 26)}`
  }
  return nr
}

const money = (v: string, currency: string) => {
  const num = parseFloat(v)
  if (!Number.isFinite(num)) return v
  return new Intl.NumberFormat('pl-PL', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(num)
}

type Props = {
  xmlText: string
  onDownload?: () => void
}

export function KsefInvoicePreview({ xmlText, onDownload }: Props) {
  const data = parseKsefXml(xmlText)
  if (!data) return null

  return (
    <div className="ksef-inv">
      <div className="ksef-inv__header">
        <div className="ksef-inv__type">
          Faktura {data.invoiceType}
        </div>
        <div className="ksef-inv__number">
          Nr: <strong>{data.invoiceNumber}</strong>
        </div>
        {onDownload && (
          <button type="button" className="btn btn--ghost btn--sm ksef-inv__dl" onClick={onDownload}>
            Pobierz XML
          </button>
        )}
      </div>

      <div className="ksef-inv__dates">
        <div>
          <span className="ksef-inv__label">Data wystawienia:</span> {data.issueDate}
        </div>
        {data.saleDate && (
          <div>
            <span className="ksef-inv__label">Data sprzedaży:</span> {data.saleDate}
          </div>
        )}
      </div>

      <div className="ksef-inv__parties">
        <div className="ksef-inv__party">
          <div className="ksef-inv__party-label">Sprzedawca</div>
          <div className="ksef-inv__party-name">{data.seller.name}</div>
          {data.seller.nip && <div className="ksef-inv__party-nip">NIP: {data.seller.nip}</div>}
          {data.seller.address && <div className="ksef-inv__party-addr">{data.seller.address}</div>}
        </div>
        <div className="ksef-inv__party">
          <div className="ksef-inv__party-label">Nabywca</div>
          <div className="ksef-inv__party-name">{data.buyer.name}</div>
          {data.buyer.nip && <div className="ksef-inv__party-nip">NIP: {data.buyer.nip}</div>}
          {data.buyer.address && <div className="ksef-inv__party-addr">{data.buyer.address}</div>}
        </div>
      </div>

      {data.lineItems.length > 0 && (
        <table className="ksef-inv__table">
          <thead>
            <tr>
              <th>Lp.</th>
              <th>Nazwa</th>
              <th>Ilość</th>
              <th>J.m.</th>
              <th>Cena netto</th>
              <th>VAT %</th>
              <th>Wartość netto</th>
              <th>Wartość brutto</th>
            </tr>
          </thead>
          <tbody>
            {data.lineItems.map((li) => (
              <tr key={li.no}>
                <td>{li.no}</td>
                <td className="ksef-inv__td-name">{li.name}</td>
                <td className="ksef-inv__td-num">{li.quantity}</td>
                <td>{li.unit}</td>
                <td className="ksef-inv__td-num">{money(li.netPrice, data.currency)}</td>
                <td className="ksef-inv__td-num">{li.vatRate}%</td>
                <td className="ksef-inv__td-num">{money(li.netValue, data.currency)}</td>
                <td className="ksef-inv__td-num">{money(li.grossValue, data.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="ksef-inv__totals">
        <div className="ksef-inv__total-row">
          <span>Razem netto:</span>
          <span>{money(data.netTotal, data.currency)}</span>
        </div>
        <div className="ksef-inv__total-row">
          <span>VAT:</span>
          <span>{money(data.vatTotal, data.currency)}</span>
        </div>
        <div className="ksef-inv__total-row ksef-inv__total-row--gross">
          <span>Do zapłaty:</span>
          <span>{money(data.grossTotal, data.currency)}</span>
        </div>
      </div>

      <div className="ksef-inv__payment">
        {data.dueDate && (
          <div>
            <span className="ksef-inv__label">Termin płatności:</span> {data.dueDate}
          </div>
        )}
        {data.paymentForm && (
          <div>
            <span className="ksef-inv__label">Forma płatności:</span> {data.paymentForm}
          </div>
        )}
        {data.bankAccount && (
          <div>
            <span className="ksef-inv__label">Nr konta:</span>{' '}
            <span className="mono">{formatAccountNumber(data.bankAccount)}</span>
          </div>
        )}
      </div>
    </div>
  )
}
