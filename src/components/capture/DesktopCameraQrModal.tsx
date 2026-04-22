import { useCallback, useEffect, useRef, useState, type ComponentType, type FC } from 'react'
import QrExport from 'react-qr-code'
import { getMobileCaptureStatusByToken, postMobileCaptureSession } from '../../api/mobileCaptureApi'
import './camera-qr-modal.css'

/** ESM: domyślny import to czasem work `{ default, QRCode }` zamiast samego `forwardRef` — wtedy `<Qr />` rzuca React #130. */
type QrProps = { value: string; size?: number; style?: React.CSSProperties; className?: string; level?: 'L' | 'M' | 'Q' | 'H' }
const QRCode: FC<QrProps> = (() => {
  const x = QrExport as
    | ComponentType<QrProps>
    | { default?: ComponentType<QrProps>; QRCode?: ComponentType<QrProps> }
  if (typeof x === 'function' || (typeof x === 'object' && x !== null && '$$typeof' in x)) {
    return x as FC<QrProps>
  }
  const bag = x as { default?: ComponentType<QrProps>; QRCode?: ComponentType<QrProps> }
  const C = bag.default ?? bag.QRCode
  if (C != null) {
    return C as FC<QrProps>
  }
  throw new Error('react-qr-code: brak prawidłowego eksportu')
})()

type Props = {
  open: boolean
  accessToken: string
  onClose: () => void
  /** Wywołane, gdy telefon przesłał plik w tej sesji (OCR w kolejce). */
  onPhoneUploadDetected: () => void
  /** Zamiast telefonu: zamknij modal i otwórz wybór pliku (np. główny `<input type="file">` z paska). */
  onRequestFileFromDisk: () => void
}

/**
 * Tylko desktop: skan telefonu → otwarcie /invoice-capture/:token → aparat + upload.
 */
export function DesktopCameraQrModal({
  open,
  accessToken,
  onClose,
  onPhoneUploadDetected,
  onRequestFileFromDisk,
}: Props) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const sessionTokenRef = useRef<string | null>(null)
  const baselineCountRef = useRef(0)
  const onSuccessRef = useRef(onPhoneUploadDetected)
  const onCloseRef = useRef(onClose)
  onSuccessRef.current = onPhoneUploadDetected
  onCloseRef.current = onClose

  const reset = useCallback(() => {
    setLoading(true)
    setError(null)
    setUrl(null)
    sessionTokenRef.current = null
    baselineCountRef.current = 0
  }, [])

  useEffect(() => {
    if (!open) {
      reset()
      return
    }

    let interval: ReturnType<typeof setInterval> | undefined
    let cancelled = false

    const start = async () => {
      setLoading(true)
      setError(null)
      try {
        const s = await postMobileCaptureSession(accessToken)
        if (cancelled) return
        sessionTokenRef.current = s.token
        const st = await getMobileCaptureStatusByToken(s.token)
        if (cancelled) return
        baselineCountRef.current = st.uploadCount
        const origin = window.location.origin.replace(/\/$/, '')
        const u = `${origin}/invoice-capture/${encodeURIComponent(s.token)}`
        setUrl(u)
        setLoading(false)

        interval = setInterval(() => {
          const token = sessionTokenRef.current
          if (!token) return
          void (async () => {
            try {
              const st2 = await getMobileCaptureStatusByToken(token)
              if (st2.uploadCount > baselineCountRef.current) {
                baselineCountRef.current = st2.uploadCount
                onSuccessRef.current()
                onCloseRef.current()
              }
            } catch {
              /* cicho — kolejne próby */
            }
          })()
        }, 2000)
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'Nie udało się utworzyć sesji')
        setLoading(false)
      }
    }
    void start()
    return () => {
      cancelled = true
      if (interval) clearInterval(interval)
    }
  }, [open, accessToken, reset])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const copyLink = useCallback(() => {
    if (!url) return
    void navigator.clipboard.writeText(url).catch(() => {
      /* ignore */
    })
  }, [url])

  const onPickFile = useCallback(() => {
    onRequestFileFromDisk()
  }, [onRequestFileFromDisk])

  if (!open) return null

  return (
    <div className="cqr" role="presentation">
      <button type="button" className="cqr__backdrop" aria-label="Zamknij" onClick={onClose} />
      <div className="cqr__box" role="dialog" aria-modal="true" aria-labelledby="cqr-title">
        <h2 id="cqr-title" className="cqr__title">
          Zeskanuj telefonem
        </h2>
        <p className="cqr__text">
          Otworzysz stronę, która uruchomi aparat. Możesz dodać kilka stron faktury, potem wyślij — na tym
          komputerze odświeżą się dane. Alternatywnie wgraj PDF lub zdjęcie wprost z dysku.
        </p>
        {loading && !error && <p className="cqr__hint">Ładowanie QR…</p>}
        {error && <p className="cqr__err">{error}</p>}
        {url && !error && (
          <div className="cqr__qr-wrap" aria-hidden={loading ? true : undefined}>
            <QRCode value={url} size={220} style={{ height: 'auto', maxWidth: '100%', width: '100%' }} />
            <p className="cqr__url">{url}</p>
            <button type="button" className="cqr__copy" onClick={copyLink}>
              Kopiuj link
            </button>
          </div>
        )}
        <button type="button" className="cqr__file" onClick={onPickFile}>
          Wgraj plik z tego komputera
        </button>
        <button type="button" className="cqr__close" onClick={onClose}>
          Zamknij
        </button>
      </div>
    </div>
  )
}
