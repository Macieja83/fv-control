import { useCallback, useEffect, useState } from 'react'
import { getStoredToken } from '../../auth/session'
import { KsefInvoicePreview } from './KsefInvoicePreview'

type Props = {
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

/** Często serwer zwraca octet-stream mimo że to PDF. */
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

async function fetchDocument(
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
      'Brak dokumentu w API (faktura bez pliku lub identyfikator spoza bazy — widok demo używa mock ID zamiast UUID).',
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

export function InvoiceDocumentPreview({ invoiceId }: Props) {
  const [reloadNonce, setReloadNonce] = useState(0)
  const [phase, setPhase] = useState<'loading' | 'error' | 'ready'>('loading')
  const [message, setMessage] = useState('')
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [mime, setMime] = useState('')
  const [fileName, setFileName] = useState('dokument')
  const [xmlPreview, setXmlPreview] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let urlToRevoke: string | null = null

    const run = async () => {
      try {
        setXmlPreview(null)
        const { blob, mime: m, fileName: fn } = await fetchDocument(invoiceId, 'inline')
        if (cancelled) return
        const xml = await xmlPreviewFromBlob(blob, m)
        if (cancelled) return
        setXmlPreview(xml)
        const u = URL.createObjectURL(blob)
        urlToRevoke = u
        setBlobUrl(u)
        setMime(m)
        setFileName(fn)
        setPhase('ready')
      } catch (e) {
        if (cancelled) return
        setPhase('error')
        setMessage(e instanceof Error ? e.message : 'Nie udało się wczytać dokumentu.')
      }
    }
    void run()
    return () => {
      cancelled = true
      if (urlToRevoke) URL.revokeObjectURL(urlToRevoke)
    }
  }, [invoiceId, reloadNonce])

  const onDownload = useCallback(async () => {
    try {
      const { blob, fileName: fn } = await fetchDocument(invoiceId, 'attachment')
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

  const openInNewTab = useCallback(() => {
    if (!blobUrl) return
    window.open(blobUrl, '_blank', 'noopener,noreferrer')
  }, [blobUrl])

  if (phase === 'loading') {
    return <div className="doc-preview doc-preview--loading">Ładowanie podglądu dokumentu…</div>
  }

  if (phase === 'error') {
    return (
      <div className="doc-preview doc-preview--error">
        <p role="alert">{message}</p>
        <p className="doc-preview__hint">
          W produkcji lista faktur powinna pochodzić z API (UUID) — wtedy podgląd wczyta PDF lub zdjęcie z magazynu
          plików.
        </p>
        <div className="doc-preview__error-actions">
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => {
              setPhase('loading')
              setReloadNonce((n) => n + 1)
            }}
          >
            Spróbuj ponownie
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="doc-preview">
      <div className="doc-preview__toolbar">
        <span className="doc-preview__name mono" title={fileName}>
          {fileName}
        </span>
        <div className="doc-preview__actions">
          {(isPdf(mime) || isImage(mime)) && (
            <button type="button" className="btn btn--ghost btn--sm" onClick={openInNewTab}>
              Nowa karta
            </button>
          )}
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => void onDownload()}>
            Pobierz
          </button>
        </div>
      </div>
      {xmlPreview && (
        <KsefInvoicePreview xmlText={xmlPreview} onDownload={() => void onDownload()} />
      )}
      {isPdf(mime) && blobUrl && (
        <object
          data={`${blobUrl}#toolbar=1&navpanes=0`}
          type="application/pdf"
          className="doc-preview__frame"
          aria-label="Podgląd PDF faktury"
        >
          <p>
            Przeglądarka nie obsługuje podglądu PDF.{' '}
            <a href={blobUrl} download={fileName}>Pobierz plik</a>
          </p>
        </object>
      )}
      {isImage(mime) && blobUrl && (
        <img className="doc-preview__img" src={blobUrl} alt={`Faktura — ${fileName}`} loading="lazy" />
      )}
      {!xmlPreview && !isPdf(mime) && !isImage(mime) && blobUrl && (
        <div className="doc-preview__fallback">
          <p>Brak podglądu w oknie dla typu {mime || 'nieznany'}. Możesz pobrać plik.</p>
          <button type="button" className="btn btn--primary btn--sm" onClick={() => void onDownload()}>
            Pobierz plik
          </button>
        </div>
      )}
    </div>
  )
}
