// B18 — subskrypcja SSE strumienia ticketu (nowe wiadomości STAFF/SYSTEM + zmiana statusu).
// EventSource ma wbudowany auto-reconnect; backend wysyła `retry: 5000`.
import { useEffect, useRef } from 'react'
import { supportStreamUrl } from '../api/supportApi'
import type { SupportMessage, SupportSeverity, SupportTicketStatus } from '../api/supportApi'

type StreamEvent =
  | { type: 'message'; ticketId: string; message: SupportMessage }
  | { type: 'status'; ticketId: string; status: SupportTicketStatus }
  | { type: 'severity'; ticketId: string; severity: SupportSeverity | null }

type Handlers = {
  onMessage: (m: SupportMessage) => void
  onStatus: (s: SupportTicketStatus) => void
  onSeverity: (s: SupportSeverity | null) => void
}

export function useSupportSSE(
  token: string | null,
  ticketId: string | null,
  handlers: Handlers,
): void {
  // Ref by nie restartować EventSource przy każdym renderze rodzica.
  const hRef = useRef(handlers)
  useEffect(() => {
    hRef.current = handlers
  })

  useEffect(() => {
    if (!token || !ticketId) return
    const es = new EventSource(supportStreamUrl(token, ticketId))
    es.onmessage = (ev: MessageEvent<string>) => {
      let parsed: StreamEvent
      try {
        parsed = JSON.parse(ev.data) as StreamEvent
      } catch {
        return
      }
      if (parsed.type === 'message') hRef.current.onMessage(parsed.message)
      else if (parsed.type === 'status') hRef.current.onStatus(parsed.status)
      else if (parsed.type === 'severity') hRef.current.onSeverity(parsed.severity)
    }
    es.onerror = () => {
      // EventSource sam się reconnectuje; brak akcji (unikamy spamu logów).
    }
    return () => es.close()
  }, [token, ticketId])
}
