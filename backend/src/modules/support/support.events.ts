/**
 * B18 SSE event bus — in-process. Emituje zdarzenia per ticket (nowa wiadomość STAFF/SYSTEM,
 * zmiana statusu/severity) do podłączonych klientów widgetu.
 *
 * Ograniczenie MVP: in-process EventEmitter. Działa przy 1 procesie API (obecny systemd
 * `fv-control-api`). Przy skalowaniu na >1 instancję -> Redis pub/sub (Sprint 2).
 */
import { EventEmitter } from "node:events";

export type SupportStreamEvent =
  | { type: "message"; ticketId: string; message: SupportStreamMessage }
  | { type: "status"; ticketId: string; status: string }
  | { type: "severity"; ticketId: string; severity: string | null };

export type SupportStreamMessage = {
  id: string;
  authorType: string;
  authorLabel: string | null;
  content: string;
  createdAt: string;
};

const emitter = new EventEmitter();
// Wiele równoległych połączeń SSE na ten sam ticket (klient na 2 kartach itp.).
emitter.setMaxListeners(0);

function channel(ticketId: string): string {
  return `ticket:${ticketId}`;
}

export function publishSupportEvent(evt: SupportStreamEvent): void {
  emitter.emit(channel(evt.ticketId), evt);
}

export function subscribeSupportEvents(
  ticketId: string,
  handler: (evt: SupportStreamEvent) => void,
): () => void {
  const ch = channel(ticketId);
  emitter.on(ch, handler);
  return () => emitter.off(ch, handler);
}
