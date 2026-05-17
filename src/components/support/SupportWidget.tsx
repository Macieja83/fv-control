// B18 — floating support widget (auth-only, decyzja #1/#2). Mount w DashboardApp (app-shell).
import { useCallback, useEffect, useState } from 'react'
import { getStoredToken } from '../../auth/session'
import { createSupportTicket } from '../../api/supportApi'
import { SupportTicketList } from './SupportTicketList'
import { SupportTicketPanel } from './SupportTicketPanel'
import '../../styles/support.css'

const OPEN_KEY = 'fv_resta_support_open'
const NEW_COOLDOWN_MS = 30_000
type View = { kind: 'list' } | { kind: 'new' } | { kind: 'ticket'; id: string }

export function SupportWidget() {
  const token = getStoredToken()
  const [open, setOpen] = useState<boolean>(() => localStorage.getItem(OPEN_KEY) === '1')
  const [view, setView] = useState<View>({ kind: 'list' })
  const [reloadKey, setReloadKey] = useState(0)
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [lastCreatedAt, setLastCreatedAt] = useState(0)

  useEffect(() => {
    localStorage.setItem(OPEN_KEY, open ? '1' : '0')
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const submitNew = useCallback(async () => {
    if (!token || submitting) return
    const subj = subject.trim()
    const msg = message.trim()
    if (!subj || !msg) {
      setError('Podaj temat i opis problemu.')
      return
    }
    const sinceLast = Date.now() - lastCreatedAt
    if (lastCreatedAt && sinceLast < NEW_COOLDOWN_MS) {
      setError(`Odczekaj ${Math.ceil((NEW_COOLDOWN_MS - sinceLast) / 1000)} s przed kolejnym zgłoszeniem.`)
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const t = await createSupportTicket(token, { subject: subj, message: msg })
      setLastCreatedAt(Date.now())
      setSubject('')
      setMessage('')
      setReloadKey((k) => k + 1)
      setView({ kind: 'ticket', id: t.id })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Nie udało się utworzyć zgłoszenia.')
    } finally {
      setSubmitting(false)
    }
  }, [token, submitting, subject, message, lastCreatedAt])

  // Auth-only widget: brak tokenu -> nic nie renderujemy.
  if (!token) return null

  if (!open) {
    return (
      <button
        type="button"
        className="support-fab"
        aria-label="Pomoc Resta FV — otwórz czat"
        onClick={() => setOpen(true)}
      >
        💬
      </button>
    )
  }

  return (
    <div className="support-widget" role="dialog" aria-label="Pomoc Resta FV">
      <div className="support-widget__header">
        <span>Pomoc Resta FV</span>
        <button
          type="button"
          className="support-widget__close"
          aria-label="Zamknij czat"
          onClick={() => setOpen(false)}
        >
          ✕
        </button>
      </div>

      <div className="support-widget__content">
        {view.kind === 'list' && (
          <SupportTicketList
            token={token}
            reloadKey={reloadKey}
            onOpen={(id) => setView({ kind: 'ticket', id })}
            onNew={() => {
              setError(null)
              setView({ kind: 'new' })
            }}
          />
        )}

        {view.kind === 'new' && (
          <div className="support-new">
            <button
              type="button"
              className="support-panel__back"
              aria-label="Wróć do listy zgłoszeń"
              onClick={() => setView({ kind: 'list' })}
            >
              ←
            </button>
            <input
              aria-label="Temat zgłoszenia"
              placeholder="Temat (np. Błąd przy wysyłce KSeF)"
              value={subject}
              maxLength={200}
              onChange={(e) => setSubject(e.target.value)}
            />
            <textarea
              aria-label="Opis problemu"
              placeholder="Opisz problem…"
              value={message}
              maxLength={5000}
              rows={5}
              onChange={(e) => setMessage(e.target.value)}
            />
            {error && (
              <div className="support-panel__error" role="alert">
                {error}
              </div>
            )}
            <button type="button" onClick={() => void submitNew()} disabled={submitting}>
              {submitting ? 'Wysyłanie…' : 'Wyślij zgłoszenie'}
            </button>
          </div>
        )}

        {view.kind === 'ticket' && (
          <SupportTicketPanel
            token={token}
            ticketId={view.id}
            onBack={() => {
              setReloadKey((k) => k + 1)
              setView({ kind: 'list' })
            }}
          />
        )}
      </div>
    </div>
  )
}
