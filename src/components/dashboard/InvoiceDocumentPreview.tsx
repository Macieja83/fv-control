import { pdf } from '@react-pdf/renderer'
import { useCallback, useEffect, useRef, useState } from 'react'
import { getStoredToken } from '../../auth/session'
import type { InvoiceRecord } from '../../types/invoice'
import { InvoicePdfDocument, registerInvoicePdfFont } from './invoice-pdf-document'

type Props = {
  invoice: InvoiceRecord
  invoiceId: string
}

function baseMime(ct: string | null): string {
  return (ct ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
}

function isPdf(mime: string): boolean {
  return mime === 'application/pdf'
}

function isImage(mime: string): boolean {
  return /^(image\/jpeg|image\/jpg|image\/png|image\/gif|image\/webp)$/.test(mime)
}

function isXmlMime(mime: string): boolean {
  const m = mime.toLowerCase()
  return m === 'application/xml' || m === 'text/xml' || m.endsWith('+xml')
}

async function xmlPreviewFromBlob(blob: Blob, mime: string): Promise<string | null> {
  if (isXmlMime(mime)) {
    const t = await blob.text()
    return t.length > 12_000 ? `${t.slice(0, 12_000)}\n\n… (obcięto)` : t
  }
  const head = (await blob.slice(0, 256).text()).trimStart()
  if (head.startsWith('<?xml') || (head.startsWith('<') && /<[A-Za-z_]/.test(head))) {
    const t = await blob.text()
    return t.length > 12_000 ? `${t.slice(0, 12_000)}\n\n… (obcięto)` : t
  }
  return null
}

async function effectiveMime(blob: Blob, headerMime: string | null): Promise<string> {
  const m = baseMime(headerMime)
  if (m && m !== 'application/octet-stream') return m
  if (blob.size < 5) return m || 'application/octet-stream'
  const head = new Uint8Array(await blob.slice(0, 5).arrayBuffer())
  const sig = String.fromCharCode(...head)
  if (sig.startsWith('%PDF')) return 'application/pdf'
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg'
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return 'image/png'
  return m || 'application/octet-stream'
}

function parseFileName(contentDisposition: string | null): string | null {
  if (!contentDisposition) return null
  const star = /filename\*=UTF-8''([^;\n]+)/i.exec(contentDisposition)
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^["']|["']$/g, ''))
    } catch {
      return null
    }
  }
  const plain = /filename="([^"]+)"/i.exec(contentDisposition)
  if (plain?.[1]) return plain[1]
  return null
}

function safePdfBaseName(invoice: InvoiceRecord): string {
  const raw = invoice.invoice_number || invoice.id.slice(0, 8)
  return raw.replace(/[^\w.\-]+/g, '_').slice(0, 80) || 'faktura'
}

async function fetchOriginalDocument(
  invoiceId: string,
  disposition: 'inline' | 'attachment',
): Promise<{ blob: Blob; mime: string; fileName: string }> {
  const token = getStoredToken()
  if (!token) throw new Error('Brak sesji — zaloguj się ponownie.')
  const url = `/api/v1/invoices/${encodeURIComponent(invoiceId)}/primary-document?disposition=${disposition}`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (res.status === 401) {
    throw new Error('Sesja wygasła lub token jest nieprawidłowy — zaloguj się ponownie.')
  }
  if (res.status === 400) {
    let msg = 'Nieprawidłowy identyfikator faktury (wymagany UUID z bazy).'
    try {
      const j = (await res.json()) as { error?: { message?: string } }
      if (typeof j.error?.message === 'string') msg = j.error.message
    } catch {
      /* ignore */
    }
    throw new Error(msg)
  }
  if (res.status === 413) {
    throw new Error('Plik przekracza limit podglądu (MAX_DOCUMENT_PREVIEW_MB na serwerze).')
  }
  if (res.status === 404) {
    throw new Error(
      'Plik źródłowy nie jest dostępny — dokument mógł zostać usunięty z magazynu plików.',
    )
  }
  if (!res.ok) {
    throw new Error(`Serwer zwrócił błąd ${res.status}.`)
  }
  const headerMime = res.headers.get('Content-Type')
  const fileName = parseFileName(res.headers.get('Content-Disposition')) ?? 'dokument'
  const blob = await res.blob()
  const mime = await effectiveMime(blob, headerMime)
  return { blob, mime, fileName }
}

export function InvoiceDocumentPreview({ invoice, invoiceId }: Props) {
  const [reloadNonce, setReloadNonce] = useState(0)

  const [dataPdfUrl, setDataPdfUrl] = useState<string | null>(null)
  const [dataPdfPhase, setDataPdfPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [dataPdfMessage, setDataPdfMessage] = useState('')
  const dataPdfBlobRef = useRef<Blob | null>(null)

  const [origPhase, setOrigPhase] = useState<'idle' | 'loading' | 'error' | 'ready'>('idle')
  const [origMessage, setOrigMessage] = useState('')
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [mime, setMime] = useState('')
  const [fileName, setFileName] = useState('dokument')
  const [xmlPreview, setXmlPreview] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    dataPdfBlobRef.current = null
    setDataPdfPhase('loading')
    setDataPdfMessage('')
    setDataPdfUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return null
    })

    ;(async () => {
      try {
        registerInvoicePdfFont()
        const blob = await pdf(<InvoicePdfDocument invoice={invoice} />).toBlob()
        if (cancelled) return
        dataPdfBlobRef.current = blob
        const u = URL.createObjectURL(blob)
        setDataPdfUrl(u)
        setDataPdfPhase('ready')
      } catch (e) {
        if (cancelled) return
        setDataPdfPhase('error')
        setDataPdfMessage(e instanceof Error ? e.message : 'Nie udało się zbudować PDF z danych faktury.')
      }
    })()

    return () => {
      cancelled = true
    }
  }, [
    invoice.id,
    invoice.invoice_number,
    invoice.supplier_name,
    invoice.supplier_nip,
    invoice.restaurant_name,
    invoice.issue_date,
    invoice.due_date,
    invoice.net_amount,
    invoice.gross_amount,
    invoice.currency,
    invoice.ksef_number,
    invoice.source_type,
    invoice.source_account,
    invoice.category,
  ])

  useEffect(() => {
    let cancelled = false
    let urlToRevoke: string | null = null

    setOrigPhase('loading')
    setOrigMessage('')
    setXmlPreview(null)
    setBlobUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return null
    })

    const run = async () => {
      try {
        const { blob, mime: m, fileName: fn } = await fetchOriginalDocument(invoiceId, 'inline')
        if (cancelled) return
        const xml = await xmlPreviewFromBlob(blob, m)
        if (cancelled) return
        setXmlPreview(xml)
        const u = URL.createObjectURL(blob)
        urlToRevoke = u
        setBlobUrl(u)
        setMime(m)
        setFileName(fn)
        setOrigPhase('ready')
      } catch (e) {
        if (cancelled) return
        setOrigPhase('error')
        setOrigMessage(e instanceof Error ? e.message : 'Nie udało się wczytać pliku źródłowego.')
      }
    }
    void run()
    return () => {
      cancelled = true
      if (urlToRevoke) URL.revokeObjectURL(urlToRevoke)
    }
  }, [invoiceId, reloadNonce])

  const onDownloadDataPdf = useCallback(() => {
    const b = dataPdfBlobRef.current
    if (!b) return
    const u = URL.createObjectURL(b)
    const a = document.createElement('a')
    a.href = u
    a.download = `FVControl-${safePdfBaseName(invoice)}.pdf`
    a.click()
    URL.revokeObjectURL(u)
  }, [invoice])

  const onDownloadOriginal = useCallback(async () => {
    try {
      const { blob, fileName: fn } = await fetchOriginalDocument(invoiceId, 'attachment')
      const u = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = u
      a.download = fn
      a.click()
      URL.revokeObjectURL(u)
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Pobieranie nie powiodło się.')
    }
  }, [invoiceId])

  const openDataPdfTab = useCallback(() => {
    if (!dataPdfUrl) return
    window.open(dataPdfUrl, '_blank', 'noopener,noreferrer')
  }, [dataPdfUrl])

  const openOriginalTab = useCallback(() => {
    if (!blobUrl) return
    window.open(blobUrl, '_blank', 'noopener,noreferrer')
  }, [blobUrl])

  return (
    <div className="doc-preview">
      <section className="doc-preview__block">
        <div className="doc-preview__toolbar doc-preview__toolbar--sub">
          <span className="doc-preview__block-title">Faktura — PDF z danych (graficzny)</span>
          <div className="doc-preview__actions">
            {dataPdfPhase === 'ready' && (
              <>
                <button type="button" className="btn btn--ghost btn--sm" onClick={openDataPdfTab}>
                  Nowa karta
                </button>
                <button type="button" className="btn btn--ghost btn--sm" onClick={onDownloadDataPdf}>
                  Pobierz PDF
                </button>
              </>
            )}
          </div>
        </div>
        {dataPdfPhase === 'loading' && (
          <div className="doc-preview__status doc-preview__status--loading">Budowanie podglądu PDF…</div>
        )}
        {dataPdfPhase === 'error' && (
          <div className="doc-preview__status doc-preview__status--error">
            <p role="alert">{dataPdfMessage}</p>
          </div>
        )}
        {dataPdfPhase === 'ready' && dataPdfUrl && (
          <object
            data={`${dataPdfUrl}#toolbar=1&navpanes=0`}
            type="application/pdf"
            className="doc-preview__frame"
            aria-label="Podgląd PDF faktury wygenerowany z danych w systemie"
          >
            <p className="doc-preview__nested-fallback">
              Przeglądarka nie osadza PDF.{' '}
              <button type="button" className="btn btn--link btn--sm" onClick={onDownloadDataPdf}>
                Pobierz PDF
              </button>
            </p>
          </object>
        )}
      </section>

      <section className="doc-preview__block doc-preview__block--source">
        <div className="doc-preview__toolbar doc-preview__toolbar--sub">
          <span className="doc-preview__block-title" title={fileName}>
            Plik źródłowy
            {origPhase === 'ready' ? (
              <span className="doc-preview__file-hint mono"> · {fileName}</span>
            ) : null}
          </span>
          <div className="doc-preview__actions">
            {origPhase === 'ready' && (
              <>
                {(isPdf(mime) || isImage(mime)) && (
                  <button type="button" className="btn btn--ghost btn--sm" onClick={openOriginalTab}>
                    Oryginał — nowa karta
                  </button>
                )}
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => void onDownloadOriginal()}>
                  Pobierz oryginał
                </button>
              </>
            )}
          </div>
        </div>

        {origPhase === 'loading' && (
          <div className="doc-preview__status doc-preview__status--loading">Ładowanie załącznika…</div>
        )}
        {origPhase === 'error' && (
          <div className="doc-preview__status doc-preview__status--error">
            <p role="alert">{origMessage}</p>
            <p className="doc-preview__hint">
              Nadal możesz korzystać z PDF wygenerowanego z danych powyżej. Jeśli to faktura z KSeF, XML mógł zostać
              zsynchronizowany — sprawdź ponownie później lub użyj „Pobierz oryginał”, gdy plik będzie dostępny.
            </p>
            <div className="doc-preview__error-actions">
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => {
                  setOrigPhase('loading')
                  setReloadNonce((n) => n + 1)
                }}
              >
                Spróbuj ponownie (oryginał)
              </button>
            </div>
          </div>
        )}

        {origPhase === 'ready' && (
          <>
            {xmlPreview && (
              <details className="doc-preview__xml-wrap">
                <summary>Surowe XML / tekst źródłowy (opcjonalnie)</summary>
                <pre className="doc-preview__xml" title="Podgląd XML (obcięty przy dużych plikach)">
                  {xmlPreview}
                </pre>
              </details>
            )}
            {isPdf(mime) && blobUrl && (
              <object
                data={`${blobUrl}#toolbar=1&navpanes=0`}
                type="application/pdf"
                className="doc-preview__frame doc-preview__frame--secondary"
                aria-label="Oryginalny plik PDF"
              >
                <p className="doc-preview__nested-fallback">
                  <button type="button" className="btn btn--link btn--sm" onClick={() => void onDownloadOriginal()}>
                    Pobierz oryginalny PDF
                  </button>
                </p>
              </object>
            )}
            {isImage(mime) && blobUrl && (
              <img className="doc-preview__img" src={blobUrl} alt={`Załącznik — ${fileName}`} loading="lazy" />
            )}
            {!xmlPreview && !isPdf(mime) && !isImage(mime) && blobUrl && (
              <div className="doc-preview__fallback">
                <p>Brak podglądu graficznego dla typu {mime || 'nieznany'}. Możesz pobrać oryginał.</p>
                <button type="button" className="btn btn--primary btn--sm" onClick={() => void onDownloadOriginal()}>
                  Pobierz plik
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  )
}
