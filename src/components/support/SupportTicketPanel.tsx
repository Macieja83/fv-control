// B18 — otwarty ticket: historia + input + SSE realtime.
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  addSupportMessage,
  getSupportTicket,
  type SupportMessage,
  type SupportTicketDetail,
  type SupportTicketStatus,
} from '../../api/supportApi'
import { useSupportSSE } from '../../hooks/useSupportSSE'

const STATUS_LABEL: Record<SupportTicketStatus, string> = {
  OPEN: 'Nowe',
  IN_PROGRESS: 'W toku',
  WAITING_USER: 'Czeka na Ciebie',
  RESOLVED: 'Rozwiązane',
  CLOSED: 'Zamknięte',
}

function authorName(m: SupportMessage): string {
  if (m.authorType === 'CLIENT') return 'Ty'
  if (m.authorType === 'STAFF') return m.authorLabel || 'Support'
  if (m.authorType === 'AI') return 'Asystent'
  return 'System'
}

type Props = { token: string; ticketId: string; onBack: () => void }

export function SupportTicketPanel({ token, ticketId, onBack }: Props) {
  const [ticket, setTicket] = useState<SupportTicketDetail | null>(null)
  const [status, setStatus] = useState<SupportTicketStatus>('OPEN')
  const [messages, setMessages] = useState<SupportMessage[]>([])
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const endRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let alive = true
    getSupportTicket(token, ticketId)
      .then((t) => {
        if (!alive) return
        setTicket(t)
        setStatus(t.status)
        setMessages(t.messages)
      })
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : 'Błąd ładowania.'))
    return () => {
      alive = false
    }
  }, [token, ticketId])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const onIncoming = useCallback((m: SupportMessage) => {
    setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]))
  }, [])

  useSupportSSE(token, ticketId, {
    onMessage: onIncoming,
    onStatus: setStatus,
    onSeverity: () => {},
  })

  const send = useCallback(async () => {
    const content = draft.trim()
    if (!content || sending) return
    setSending(true)
    setError(null)
    try {
      const msg = await addSupportMessage(token, ticketId, content)
      setMessages((prev) => (prev.some((x) => x.id === msg.id) ? prev : [...prev, msg]))
      setDraft('')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Nie udało się wysłać.')
    } finally {
      setSending(false)
    }
  }, [draft, sending, token, ticketId])

  return (
    <div className="support-panel">
      <div className="support-panel__head">
        <button type="button" className="support-panel__back" onClick={onBack} aria-label="Wróć do listy zgłoszeń">
          ←
        </button>
        <div className="support-panel__title" title={ticket?.subject ?? ''}>
          {ticket?.subject ?? 'Zgłoszenie'}
        </div>
        <span className={`support-badge support-badge--${status.toLowerCase()}`}>
          {STATUS_LABEL[status]}
        </span>
      </div>

      <div className="support-panel__body" role="log" aria-live="polite">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`support-msg support-msg--${m.authorType === 'CLIENT' ? 'me' : 'them'}`}
          >
            <div className="support-msg__author">{authorName(m)}</div>
            <div className="support-msg__content">{m.content}</div>
            <div className="support-msg__time">
              {new Date(m.createdAt).toLocaleString('pl-PL')}
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {error && (
        <div className="support-panel__error" role="alert">
          {error}
        </div>
      )}

      <div className="support-panel__input">
        <textarea
          aria-label="Treść wiadomości"
          placeholder="Napisz wiadomość…"
          value={draft}
          disabled={status === 'CLOSED'}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send()
            }
          }}
          rows={2}
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={sending || !draft.trim() || status === 'CLOSED'}
        >
          Wyślij
        </button>
      </div>
    </div>
  )
}
