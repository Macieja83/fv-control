/**
 * Renders a KSeF FA XML as a formatted invoice document
 * matching the official KSeF PDF layout.
 */

import { useCallback, useRef } from 'react'

/* ─── Types ─── */

type Party = {
  nip: string
  name: string
  address1: string
  address2: string
  country: string
  email: string
  phone: string
}

type LineItem = {
  no: number
  name: string
  quantity: string
  unit: string
  netPrice: string
  vatRate: string
  netValue: string
  pkwiu: string
  deliveryDate: string
}

type VatSummaryRow = {
  rate: string
  netAmount: string
  vatAmount: string
  grossAmount: string
}

type KsefInvoiceData = {
  invoiceNumber: string
  ksefNumber: string
  invoiceType: string
  issueDate: string
  saleDate: string
  placeOfIssue: string
  currency: string
  seller: Party
  buyer: Party
  lineItems: LineItem[]
  netTotal: string
  vatTotal: string
  grossTotal: string
  vatSummary: VatSummaryRow[]
  dueDate: string
  paymentForm: string
  paymentDescription: string
  bankAccount: string
  bankName: string
  swift: string
  jst: boolean
  gv: boolean
  additionalInfo: Array<{ key: string; value: string }>
}

/* ─── XML Helpers ─── */

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

const INVOICE_TYPES: Record<string, string> = {
  VAT: 'Faktura podstawowa',
  KOR: 'Faktura korygująca',
  ZAL: 'Faktura zaliczkowa',
  ROZ: 'Faktura rozliczeniowa',
  UPR: 'Faktura uproszczona',
  KOR_ZAL: 'Korekta faktury zaliczkowej',
  KOR_ROZ: 'Korekta faktury rozliczeniowej',
}

function parseKsefXml(xmlText: string): KsefInvoiceData | null {
  try {
    const dom = new DOMParser().parseFromString(xmlText, 'text/xml')
    if (dom.querySelector('parsererror')) return null

    const ns = dom.documentElement.namespaceURI ?? ''
    const q = (parent: Element | Document, tag: string): Element | null =>
      parent.getElementsByTagNameNS(ns, tag)[0] ?? parent.getElementsByTagName(tag)[0] ?? null
    const qAll = (parent: Element | Document, tag: string): HTMLCollectionOf<Element> => {
      const res = parent.getElementsByTagNameNS(ns, tag)
      return res.length ? res : parent.getElementsByTagName(tag)
    }

    const fa = q(dom, 'Fa')
    if (!fa) return null

    const podmiot1 = q(dom, 'Podmiot1')
    const podmiot2 = q(dom, 'Podmiot2')

    const txt = (parent: Element | null, tag: string): string => {
      if (!parent) return ''
      const el = q(parent, tag)
      return el?.textContent?.trim() ?? ''
    }

    const parseParty = (podmiot: Element | null): Party => {
      const dane = podmiot ? q(podmiot, 'DaneIdentyfikacyjne') : null
      const adres = podmiot ? q(podmiot, 'Adres') : null
      const kontakt = podmiot ? q(podmiot, 'DaneKontaktowe') : null
      return {
        nip: txt(dane, 'NIP'),
        name: txt(dane, 'Nazwa'),
        address1: txt(adres, 'AdresL1'),
        address2: txt(adres, 'AdresL2'),
        country: txt(adres, 'KodKraju') || 'PL',
        email: txt(kontakt, 'Email'),
        phone: txt(kontakt, 'Telefon'),
      }
    }

    const platnosc = q(fa, 'Platnosc')
    const terminEl = platnosc ? q(platnosc, 'TerminPlatnosci') : null
    const rachunekEl = platnosc ? q(platnosc, 'RachunekBankowy') : null

    const wierszeFallback = qAll(fa, 'FaWiersz')
    const lineItems: LineItem[] = []
    for (let i = 0; i < wierszeFallback.length; i++) {
      const w = wierszeFallback[i]!
      lineItems.push({
        no: i + 1,
        name: txt(w, 'P_7'),
        quantity: txt(w, 'P_8B') || '1',
        unit: txt(w, 'P_8A') || 'szt.',
        netPrice: n(txt(w, 'P_9A')),
        vatRate: txt(w, 'P_12') || '23',
        netValue: n(txt(w, 'P_11')),
        pkwiu: txt(w, 'GTU') || txt(w, 'PKWIU'),
        deliveryDate: s(txt(w, 'P_6A') || txt(fa, 'P_6')).slice(0, 10),
      })
    }

    const vatRates: Record<string, { net: number; vat: number }> = {}
    for (const li of lineItems) {
      const rate = li.vatRate
      if (!vatRates[rate]) vatRates[rate] = { net: 0, vat: 0 }
      const netVal = parseFloat(li.netValue) || 0
      vatRates[rate]!.net += netVal
      vatRates[rate]!.vat += netVal * (parseFloat(rate) / 100)
    }
    const vatSummary: VatSummaryRow[] = Object.entries(vatRates).map(([rate, v]) => ({
      rate: rate + '%',
      netAmount: v.net.toFixed(2),
      vatAmount: v.vat.toFixed(2),
      grossAmount: (v.net + v.vat).toFixed(2),
    }))

    const netTotal = txt(fa, 'P_13_1') || txt(fa, 'P_13_2') || txt(fa, 'P_13_3') || '0'
    const vatTotal = txt(fa, 'P_14_1') || txt(fa, 'P_14_2') || txt(fa, 'P_14_3') || '0'
    const grossTotal = txt(fa, 'P_15') || (parseFloat(n(netTotal)) + parseFloat(n(vatTotal))).toFixed(2)

    const rodzaj = txt(fa, 'RodzajFaktury') || 'VAT'

    const dodatkoweOpisy = qAll(fa, 'DodatkowyOpis')
    const additionalInfo: Array<{ key: string; value: string }> = []
    for (let i = 0; i < dodatkoweOpisy.length; i++) {
      const el = dodatkoweOpisy[i]!
      additionalInfo.push({
        key: txt(el, 'Klucz'),
        value: txt(el, 'Wartosc'),
      })
    }

    const ksefNumber = (dom.documentElement.getAttribute('xmlns') ?? '').includes('ksef')
      ? '' : ''

    return {
      invoiceNumber: txt(fa, 'P_2'),
      ksefNumber,
      invoiceType: INVOICE_TYPES[rodzaj] ?? `Faktura ${rodzaj}`,
      issueDate: s(txt(fa, 'P_1')).slice(0, 10),
      saleDate: s(txt(fa, 'P_6')).slice(0, 10),
      placeOfIssue: txt(fa, 'MiejsceWystawienia'),
      currency: txt(fa, 'KodWaluty') || 'PLN',
      seller: parseParty(podmiot1),
      buyer: parseParty(podmiot2),
      lineItems,
      netTotal: n(netTotal),
      vatTotal: n(vatTotal),
      grossTotal: n(grossTotal),
      vatSummary: vatSummary.length > 0 ? vatSummary : [{ rate: '—', netAmount: n(netTotal), vatAmount: n(vatTotal), grossAmount: n(grossTotal) }],
      dueDate: terminEl ? s(txt(terminEl, 'Termin')).slice(0, 10) : '',
      paymentForm: PAYMENT_FORMS[txt(platnosc, 'FormaPlatnosci')] ?? txt(platnosc, 'FormaPlatnosci'),
      paymentDescription: txt(platnosc, 'OpisRachunku') || txt(platnosc, 'OpisPlatnosciInnej') || '',
      bankAccount: rachunekEl ? txt(rachunekEl, 'NrRB') : '',
      bankName: rachunekEl ? txt(rachunekEl, 'NazwaBanku') : '',
      swift: rachunekEl ? txt(rachunekEl, 'SWIFT') : '',
      jst: txt(podmiot2, 'JST') === '2',
      gv: txt(podmiot2, 'GV') === '2',
      additionalInfo,
    }
  } catch {
    return null
  }
}

/* ─── Format Helpers ─── */

function fmtDate(iso: string): string {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}.${m}.${y}`
}

function fmtAccount(nr: string): string {
  const c = nr.replace(/\s/g, '')
  if (c.length === 26) {
    return `${c.slice(0, 2)} ${c.slice(2, 6)} ${c.slice(6, 10)} ${c.slice(10, 14)} ${c.slice(14, 18)} ${c.slice(18, 22)} ${c.slice(22, 26)}`
  }
  return nr
}

function fmtMoney(v: string, currency = 'PLN'): string {
  const num = parseFloat(v)
  if (!Number.isFinite(num)) return v
  return new Intl.NumberFormat('pl-PL', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(num)
}

function fmtCountry(code: string): string {
  const map: Record<string, string> = { PL: 'Polska', DE: 'Niemcy', GB: 'Wielka Brytania', US: 'USA' }
  return map[code] ?? code
}

/* ─── Component ─── */

type Props = {
  xmlText: string
  ksefNumber?: string
  onDownload?: () => void
}

export function KsefInvoicePreview({ xmlText, ksefNumber: ksefNumProp, onDownload }: Props) {
  const data = parseKsefXml(xmlText)
  const printRef = useRef<HTMLDivElement>(null)

  const handlePrintPdf = useCallback(() => {
    if (!printRef.current) return
    const html = printRef.current.innerHTML
    const win = window.open('', '_blank')
    if (!win) return
    win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Faktura ${data?.invoiceNumber ?? ''}</title>
<style>${PRINT_CSS}</style></head><body>${html}</body></html>`)
    win.document.close()
    setTimeout(() => { win.print() }, 350)
  }, [data?.invoiceNumber])

  if (!data) return null

  const ksefNum = ksefNumProp || data.ksefNumber || ''

  return (
    <div className="ksef-doc-wrap">
      <div className="ksef-doc-toolbar">
        <button type="button" className="btn btn--primary btn--sm" onClick={handlePrintPdf}>
          Pobierz PDF
        </button>
        {onDownload && (
          <button type="button" className="btn btn--ghost btn--sm" onClick={onDownload}>
            Pobierz XML
          </button>
        )}
      </div>

      <div className="ksef-doc" ref={printRef}>
        {/* Header */}
        <div className="kd-header">
          <div className="kd-header__left">
            <div className="kd-header__logo">Krajowy System e-Faktur</div>
          </div>
          <div className="kd-header__right">
            <div className="kd-header__label">Numer Faktury:</div>
            <div className="kd-header__number">{data.invoiceNumber}</div>
          </div>
        </div>

        <div className="kd-type">{data.invoiceType}</div>

        {ksefNum && (
          <div className="kd-ksef-num">
            <span className="kd-ksef-num__label">Numer KSeF:</span>
            <span className="kd-ksef-num__value">{ksefNum}</span>
          </div>
        )}

        {/* Parties */}
        <div className="kd-parties">
          <div className="kd-party">
            <div className="kd-party__title">Sprzedawca</div>
            <div className="kd-field"><span className="kd-field__label">NIP:</span> {data.seller.nip}</div>
            <div className="kd-field"><span className="kd-field__label">Nazwa:</span> {data.seller.name}</div>
            <div className="kd-field__sub">Adres</div>
            <div className="kd-field__addr">{data.seller.address1}</div>
            {data.seller.address2 && <div className="kd-field__addr">{data.seller.address2}</div>}
            <div className="kd-field__addr">{fmtCountry(data.seller.country)}</div>
            {(data.seller.email || data.seller.phone) && (
              <>
                <div className="kd-field__sub">Dane kontaktowe</div>
                {data.seller.email && <div className="kd-field">E-mail: {data.seller.email}</div>}
                {data.seller.phone && <div className="kd-field">Tel.: {data.seller.phone}</div>}
              </>
            )}
          </div>

          <div className="kd-party">
            <div className="kd-party__title">Nabywca</div>
            {data.buyer.nip && (
              <div className="kd-field"><span className="kd-field__label">NIP:</span> {data.buyer.nip}</div>
            )}
            <div className="kd-field"><span className="kd-field__label">Nazwa:</span> {data.buyer.name}</div>
            <div className="kd-field__sub">Adres</div>
            <div className="kd-field__addr">{data.buyer.address1}</div>
            {data.buyer.address2 && <div className="kd-field__addr">{data.buyer.address2}</div>}
            <div className="kd-field__addr">{fmtCountry(data.buyer.country)}</div>
            {(data.buyer.email || data.buyer.phone) && (
              <>
                <div className="kd-field__sub">Dane kontaktowe</div>
                {data.buyer.email && <div className="kd-field">E-mail: {data.buyer.email}</div>}
                {data.buyer.phone && <div className="kd-field">Tel.: {data.buyer.phone}</div>}
              </>
            )}
            <div className="kd-field kd-field--sm">Faktura dotyczy jednostki podrzędnej JST: {data.jst ? 'NIE' : 'TAK'}</div>
            <div className="kd-field kd-field--sm">Faktura dotyczy członka grupy GV: {data.gv ? 'NIE' : 'TAK'}</div>
          </div>
        </div>

        {/* Details */}
        <div className="kd-section">
          <div className="kd-section__title">Szczegóły</div>
          <div className="kd-details">
            <div className="kd-field">
              <span className="kd-field__label">Data wystawienia, z zastrzeżeniem art. 106na ust. 1 ustawy:</span>{' '}
              {fmtDate(data.issueDate)}
            </div>
            {data.saleDate && data.saleDate !== data.issueDate && (
              <div className="kd-field">
                <span className="kd-field__label">Data sprzedaży:</span> {fmtDate(data.saleDate)}
              </div>
            )}
            <div className="kd-field">
              <span className="kd-field__label">Kod waluty:</span> {data.currency}
            </div>
            {data.placeOfIssue && (
              <div className="kd-field">
                <span className="kd-field__label">Miejsce wystawienia:</span> {data.placeOfIssue}
              </div>
            )}
          </div>
        </div>

        {/* Line items */}
        <div className="kd-section">
          <div className="kd-section__title">Pozycje</div>
          <div className="kd-field kd-field--sm" style={{ marginBottom: 6 }}>
            Faktura wystawiona w walucie {data.currency}
          </div>
          <table className="kd-table">
            <thead>
              <tr>
                <th>Lp.</th>
                <th>Nazwa towaru lub usługi</th>
                <th className="kd-r">Cena jedn. netto</th>
                <th className="kd-r">Ilość</th>
                <th>Miara</th>
                <th className="kd-r">Stawka podatku</th>
                <th className="kd-r">Wartość sprzedaży netto</th>
              </tr>
            </thead>
            <tbody>
              {data.lineItems.map((li) => (
                <tr key={li.no}>
                  <td>{li.no}</td>
                  <td>{li.name}</td>
                  <td className="kd-r">{n(li.netPrice)}</td>
                  <td className="kd-r">{li.quantity}</td>
                  <td>{li.unit}</td>
                  <td className="kd-r">{li.vatRate}%</td>
                  <td className="kd-r">{n(li.netValue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Gross total */}
        <div className="kd-gross-total">
          <span>Kwota należności ogółem:</span>
          <strong>{fmtMoney(data.grossTotal, data.currency)}</strong>
        </div>

        {/* VAT summary */}
        <div className="kd-section">
          <div className="kd-section__title">Podsumowanie stawek podatku</div>
          <table className="kd-table kd-table--vat">
            <thead>
              <tr>
                <th>Lp.</th>
                <th className="kd-r">Stawka podatku</th>
                <th className="kd-r">Kwota netto</th>
                <th className="kd-r">Kwota podatku</th>
                <th className="kd-r">Kwota brutto</th>
              </tr>
            </thead>
            <tbody>
              {data.vatSummary.map((row, idx) => (
                <tr key={idx}>
                  <td>{idx + 1}</td>
                  <td className="kd-r">{row.rate}</td>
                  <td className="kd-r">{n(row.netAmount)}</td>
                  <td className="kd-r">{n(row.vatAmount)}</td>
                  <td className="kd-r">{n(row.grossAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Payment */}
        {(data.dueDate || data.paymentForm || data.bankAccount) && (
          <div className="kd-section">
            <div className="kd-section__title">Płatność</div>
            {data.paymentForm && (
              <div className="kd-field">
                <span className="kd-field__label">Forma płatności:</span> {data.paymentForm}
              </div>
            )}
            {data.paymentDescription && (
              <div className="kd-field">{data.paymentDescription}</div>
            )}
            {data.dueDate && (
              <>
                <div className="kd-field__sub">Termin płatności</div>
                <div className="kd-field">{fmtDate(data.dueDate)}</div>
              </>
            )}
            {data.bankAccount && (
              <>
                <div className="kd-field__sub">Numer rachunku bankowego</div>
                <div className="kd-field">
                  <span className="kd-field__label">Pełny numer rachunku</span>{' '}
                  <span className="kd-mono">{fmtAccount(data.bankAccount)}</span>
                </div>
                {data.swift && <div className="kd-field"><span className="kd-field__label">Kod SWIFT</span> {data.swift}</div>}
                {data.bankName && <div className="kd-field"><span className="kd-field__label">Nazwa banku</span> {data.bankName}</div>}
              </>
            )}
          </div>
        )}

        {/* Additional info */}
        {data.additionalInfo.length > 0 && (
          <div className="kd-section">
            <div className="kd-section__title">Informacje dodatkowe</div>
            {data.additionalInfo.map((info, i) => (
              <div key={i} className="kd-field kd-field--sm">
                <strong>{info.key}:</strong> {info.value}
              </div>
            ))}
          </div>
        )}

        {ksefNum && (
          <div className="kd-footer">
            <div className="kd-field kd-field--sm">
              Sprawdź, czy Twoja faktura znajduje się w KSeF!
            </div>
            <div className="kd-mono kd-field--sm">{ksefNum}</div>
          </div>
        )}
      </div>
    </div>
  )
}

/* ─── Print CSS (injected into popup window) ─── */

const PRINT_CSS = `
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11px; color: #1a1a1a; padding: 20px 30px; line-height: 1.45; }
.kd-header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #1a4d8f; padding-bottom: 8px; margin-bottom: 6px; }
.kd-header__logo { font-size: 14px; font-weight: 700; color: #1a4d8f; }
.kd-header__label { font-size: 10px; color: #555; text-align: right; }
.kd-header__number { font-size: 16px; font-weight: 700; text-align: right; }
.kd-type { font-size: 13px; font-weight: 600; margin-bottom: 2px; }
.kd-ksef-num { font-size: 10px; color: #555; margin-bottom: 10px; }
.kd-ksef-num__label { font-weight: 600; }
.kd-parties { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px; }
.kd-party { border: 1px solid #ccc; border-radius: 3px; padding: 8px 10px; }
.kd-party__title { font-size: 12px; font-weight: 700; color: #1a4d8f; border-bottom: 1px solid #ddd; padding-bottom: 3px; margin-bottom: 5px; }
.kd-field { font-size: 11px; margin-bottom: 1px; }
.kd-field__label { font-weight: 600; }
.kd-field__sub { font-size: 10px; font-weight: 600; color: #666; margin-top: 5px; margin-bottom: 1px; }
.kd-field__addr { font-size: 11px; }
.kd-field--sm { font-size: 10px; color: #555; }
.kd-section { margin-bottom: 10px; }
.kd-section__title { font-size: 12px; font-weight: 700; color: #1a4d8f; border-bottom: 2px solid #1a4d8f; padding-bottom: 2px; margin-bottom: 6px; }
.kd-details { margin-bottom: 4px; }
.kd-table { width: 100%; border-collapse: collapse; font-size: 10px; margin-bottom: 4px; }
.kd-table th { background: #e8eef5; border: 1px solid #bcc; padding: 3px 5px; text-align: left; font-weight: 600; font-size: 9.5px; }
.kd-table td { border: 1px solid #ccc; padding: 3px 5px; }
.kd-r { text-align: right !important; }
.kd-gross-total { background: #e8eef5; border: 1px solid #bcc; padding: 6px 10px; font-size: 12px; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center; }
.kd-gross-total strong { font-size: 14px; }
.kd-mono { font-family: 'Consolas', 'Courier New', monospace; font-size: 11px; }
.kd-footer { margin-top: 16px; padding-top: 8px; border-top: 1px solid #ddd; text-align: center; }
@media print {
  body { padding: 10px 20px; }
  @page { size: A4; margin: 12mm 15mm; }
}
`
