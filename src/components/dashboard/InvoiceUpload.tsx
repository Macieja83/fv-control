import { useCallback, useEffect, useRef, useState } from 'react'
import { uploadInvoiceFile } from '../../api/uploadApi'
import { getStoredToken } from '../../auth/session'
import { isCoarseMobileDevice } from '../../lib/isCoarseMobileDevice'
import { DesktopCameraQrModal } from '../capture/DesktopCameraQrModal'
import '../capture/camera-qr-modal.css'

const USE_MOCK_INVOICES =
  import.meta.env.VITE_USE_MOCK_INVOICES === 'true' || import.meta.env.VITE_USE_MOCK_INVOICES === '1'

type Props = {
  onUploaded: () => void
}

type UploadState = 'idle' | 'uploading' | 'success' | 'error'

const ACCEPTED_TYPES = 'application/pdf,image/jpeg,image/jpg,image/png,image/webp,image/heic,image/heif'

export function InvoiceUpload({ onUploaded }: Props) {
  const cameraRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [state, setState] = useState<UploadState>('idle')
  const [message, setMessage] = useState('')
  const [usePhoneCamera, setUsePhoneCamera] = useState(() =>
    typeof window !== 'undefined' ? isCoarseMobileDevice() : false,
  )
  const [showQr, setShowQr] = useState(false)
  const [showMockCameraHint, setShowMockCameraHint] = useState(false)

  useEffect(() => {
    setUsePhoneCamera(isCoarseMobileDevice())
  }, [])

  const handleFile = useCallback(async (file: File | undefined) => {
    if (!file) return
    setState('uploading')
    setMessage('')
    try {
      const result = await uploadInvoiceFile(file)
      if (result.kind === 'idempotent_document') {
        setState('success')
        setMessage(result.message?.trim() || 'Taki dokument już istnieje w systemie.')
      } else {
        setState('success')
        setMessage(
          'Wysłano do kolejki OCR. Dane pojawią się po przetworzeniu przez worker (Redis); bez workera faktura zostanie w stanie „przetwarzanie”.',
        )
      }
      onUploaded()
      setTimeout(() => setState('idle'), 3000)
    } catch (e) {
      setState('error')
      setMessage(e instanceof Error ? e.message : 'Nie udało się przesłać pliku.')
      setTimeout(() => setState('idle'), 4000)
    }
    if (cameraRef.current) cameraRef.current.value = ''
    if (fileRef.current) fileRef.current.value = ''
  }, [onUploaded])

  const onCameraChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    void handleFile(e.target.files?.[0])
  }, [handleFile])

  const onFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    void handleFile(e.target.files?.[0])
  }, [handleFile])

  const uploading = state === 'uploading'
  const access = getStoredToken()
  const closeQr = useCallback(() => setShowQr(false), [])
  const onPhoneScanDone = useCallback(() => {
    setState('success')
    setMessage(
      'Otrzymano zdjęcie z telefonu (kolejka OCR). Jeśli nie widzisz faktury, chwilę odczekaj albo odśwież listę.',
    )
    onUploaded()
    setTimeout(() => setState('idle'), 4000)
  }, [onUploaded])

  const onCameraButton = useCallback(() => {
    if (uploading) return
    if (usePhoneCamera) {
      cameraRef.current?.click()
      return
    }
    if (USE_MOCK_INVOICES) {
      setShowMockCameraHint(true)
      return
    }
    if (!access) {
      setState('error')
      setMessage('Brak sesji — zaloguj się ponownie.')
      setTimeout(() => setState('idle'), 4000)
      return
    }
    setShowQr(true)
  }, [access, uploading, usePhoneCamera])

  const closeMockHint = useCallback(() => setShowMockCameraHint(false), [])

  return (
    <div className="upload-bar">
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="upload-bar__hidden-input"
        onChange={onCameraChange}
        disabled={uploading}
      />
      <input
        ref={fileRef}
        type="file"
        accept={ACCEPTED_TYPES}
        className="upload-bar__hidden-input"
        onChange={onFileChange}
        disabled={uploading}
      />
      <button
        type="button"
        className="upload-bar__btn upload-bar__btn--camera"
        disabled={uploading}
        onClick={onCameraButton}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
        <span>Aparat</span>
      </button>
      <button
        type="button"
        className="upload-bar__btn upload-bar__btn--file"
        disabled={uploading}
        onClick={() => fileRef.current?.click()}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
        <span>Z pliku</span>
      </button>
      {state === 'uploading' && (
        <div className="upload-bar__status upload-bar__status--loading">
          <span className="upload-bar__spinner" />
          Przesyłanie…
        </div>
      )}
      {state === 'success' && (
        <div className="upload-bar__status upload-bar__status--success">{message}</div>
      )}
      {state === 'error' && (
        <div className="upload-bar__status upload-bar__status--error">{message}</div>
      )}

      {access && !USE_MOCK_INVOICES && (
        <DesktopCameraQrModal
          open={showQr}
          accessToken={access}
          onClose={closeQr}
          onPhoneUploadDetected={onPhoneScanDone}
        />
      )}

      {showMockCameraHint && (
        <div className="cqr" role="presentation">
          <button type="button" className="cqr__backdrop" aria-label="Zamknij" onClick={closeMockHint} />
          <div className="cqr__box" role="dialog" aria-modal="true" aria-labelledby="mock-cam-title">
            <h2 id="mock-cam-title" className="cqr__title">
              Tryb demonstracyjny
            </h2>
            <p className="cqr__text">Użyj „Z pliku”, aby dodać fakturę w tym trybie (bez prawdziwej kolejki OCR).</p>
            <button type="button" className="cqr__close" onClick={closeMockHint}>
              Zamknij
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
