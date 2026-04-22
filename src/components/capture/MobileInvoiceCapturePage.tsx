import { useCallback, useEffect, useState } from 'react'
import { getMobileCaptureStatusByToken, postMobileCaptureUpload } from '../../api/mobileCaptureApi'
import { mergeImageFilesToPdfBlob } from '../../lib/mergeImagesToPdf'
import './mobile-invoice-capture.css'

type Props = { token: string }

type Phase = 'loading' | 'ready' | 'invalid' | 'done' | 'error'

/**
 * Publiczna strona (bez logowania): skan z telefonu po kodzie QR z komputera.
 * Wiele zdjęć → jeden PDF wielostronicowy → jedno zadanie OCR.
 */
export function MobileInvoiceCapturePage({ token }: Props) {
  const [phase, setPhase] = useState<Phase>('loading')
  const [msg, setMsg] = useState<string | null>(null)
  const [pages, setPages] = useState<File[]>([])
  const [sending, setSending] = useState(false)

  useEffect(() => {
    const prev = document.title
    document.title = 'Zdjęcie faktury — FV Control'
    return () => {
      document.title = prev
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        const s = await getMobileCaptureStatusByToken(token)
        if (cancelled) return
        if (!s.valid) {
          setPhase('invalid')
          setMsg('Link wygasł lub jest nieprawidłowy. Na komputerze kliknij Aparat i wygeneruj nowy kod QR.')
          return
        }
        setPhase('ready')
      } catch (e) {
        if (cancelled) return
        setPhase('error')
        setMsg(e instanceof Error ? e.message : 'Błąd sieci')
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [token])

  const onPick = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) {
      setPages((p) => [...p, f])
      setMsg(null)
    }
    e.target.value = ''
  }, [])

  const removeAt = useCallback((i: number) => {
    setPages((p) => p.filter((_, j) => j !== i))
  }, [])

  const send = useCallback(async () => {
    if (pages.length === 0) {
      setMsg('Dodaj co najmniej jedno zdjęcie (albo użyj „Dodaj stronę”).')
      return
    }
    setSending(true)
    setMsg(null)
    try {
      const out = await mergeImageFilesToPdfBlob(pages)
      const name =
        pages.length > 1
          ? 'faktura-wielostronicowa.pdf'
          : (pages[0]?.name || 'faktura').replace(/\.[^.]+$/, '.pdf') || 'faktura.pdf'
      const file = out instanceof File ? out : new File([out], name, { type: 'application/pdf' })
      await postMobileCaptureUpload(token, file)
      setPhase('done')
      setMsg('Wysłano. Możesz zamknąć tę kartę — na komputerze odświeży się lista faktur.')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Nie udało się wysłać')
    } finally {
      setSending(false)
    }
  }, [pages, token])

  if (phase === 'loading') {
    return (
      <div className="micp">
        <p className="micp__muted">Sprawdzanie linku…</p>
      </div>
    )
  }

  if (phase === 'invalid' || phase === 'error') {
    return (
      <div className="micp">
        <h1 className="micp__title">FV Control</h1>
        <p className="micp__err">{msg}</p>
      </div>
    )
  }

  if (phase === 'done') {
    return (
      <div className="micp micp--done">
        <h1 className="micp__title">Gotowe</h1>
        <p>{msg}</p>
      </div>
    )
  }

  return (
    <div className="micp">
      <h1 className="micp__title">Zdjęcie faktury</h1>
      <p className="micp__lead">
        Zrób zdjęcia wszystkich stron (lub jedno). Następnie wyślij — powstanie jeden plik do OCR w Twojej firmie.
      </p>

      <input
        type="file"
        accept="image/*"
        capture="environment"
        className="micp__hidden"
        onChange={onPick}
        disabled={sending}
        id="micp-cam"
      />
      <label htmlFor="micp-cam" className="micp__btn micp__btn--primary">
        {pages.length === 0 ? 'Zrób zdjęcie / wybierz' : 'Dodaj kolejną stronę'}
      </label>

      {pages.length > 0 && (
        <ul className="micp__list">
          {pages.map((f, i) => (
            <li key={`${f.name}-${i}`} className="micp__item">
              <span>
                Strona {i + 1}: {f.name}
              </span>
              <button type="button" className="micp__link" onClick={() => removeAt(i)} disabled={sending}>
                Usuń
              </button>
            </li>
          ))}
        </ul>
      )}

      {pages.length > 0 && (
        <button
          type="button"
          className="micp__btn micp__btn--send"
          disabled={sending}
          onClick={() => void send()}
        >
          {sending ? 'Wysyłanie…' : 'Wyślij do OCR'}
        </button>
      )}

      {msg && phase === 'ready' && <p className="micp__err">{msg}</p>}
    </div>
  )
}
