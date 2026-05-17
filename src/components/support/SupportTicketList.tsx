// B18 — lista poprzednich zgłoszeń tenanta + przycisk nowego.
import { useEffect, useState } from 'react'
import {
  listSupportTickets,
  type SupportTicketListItem,
  type SupportTicketStatus,
} from '../../api/supportApi'

const STATUS_LABEL: Record<SupportTicketStatus, string> = {
  OPEN: 'Nowe',
  IN_PROGRESS: 'W toku',
  WAITING_USER: 'Czeka na Ciebie',
  RESOLVED: 'Rozwiązane',
  CLOSED: 'Zamknięte',
}

type Props = {
  token: string
  reloadKey: number
  onOpen: (ticketId: string) => void
  onNew: () => void
}

export function SupportTicketList({ token, reloadKey, onOpen, onNew }: Props) {
  const [tickets, setTickets] = useState<SupportTicketListItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    listSupportTickets(token)
      .then((t) => {
        if (!alive) return
        setTickets(t)
        setError(null)
      })
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : 'Błąd ładowania.'))
    return () => {
      alive = false
    }
  }, [token, reloadKey])

  return (
    <div className="support-list">
      <button type="button" className="support-list__new" onClick={onNew}>
        + Nowe zgłoszenie
      </button>

      {error && (
        <div className="support-panel__error" role="alert">
          {error}
        </div>
      )}

      {tickets && tickets.length === 0 && !error && (
        <p className="support-list__empty">Nie masz jeszcze żadnych zgłoszeń.</p>
      )}

      <ul className="support-list__items">
        {(tickets ?? []).map((t) => (
          <li key={t.id}>
            <button type="button" className="support-list__item" onClick={() => onOpen(t.id)}>
              <span className="support-list__subject" title={t.subject}>
                {t.subject}
              </span>
              <span className={`support-badge support-badge--${t.status.toLowerCase()}`}>
                {STATUS_LABEL[t.status]}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
