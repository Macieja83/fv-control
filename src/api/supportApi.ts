// B18 customer chat widget — API client (wzorzec spójny z activityApi/invoicesApi).

const API = '/api/v1'

export type SupportTicketStatus =
  | 'OPEN'
  | 'IN_PROGRESS'
  | 'WAITING_USER'
  | 'RESOLVED'
  | 'CLOSED'
export type SupportSeverity = 'P0' | 'P1' | 'P2'
export type SupportAuthorType = 'CLIENT' | 'STAFF' | 'SYSTEM' | 'AI'

export type SupportMessage = {
  id: string
  authorType: SupportAuthorType
  authorLabel: string | null
  content: string
  createdAt: string
}

export type SupportTicket = {
  id: string
  subject: string
  status: SupportTicketStatus
  severity: SupportSeverity | null
  component: string | null
  createdAt: string
  updatedAt: string
  closedAt: string | null
}

export type SupportTicketListItem = SupportTicket & { lastMessageAt: string | null }
export type SupportTicketDetail = SupportTicket & { messages: SupportMessage[] }

async function parseError(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { error?: { message?: string } }
    if (typeof j.error?.message === 'string') return j.error.message
  } catch {
    /* ignore */
  }
  return `HTTP ${res.status}`
}

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}

export async function createSupportTicket(
  token: string,
  body: { subject: string; message: string },
): Promise<SupportTicketDetail> {
  const res = await fetch(`${API}/support/tickets`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await parseError(res))
  return (await res.json()) as SupportTicketDetail
}

export async function listSupportTickets(
  token: string,
  limit = 30,
): Promise<SupportTicketListItem[]> {
  const q = new URLSearchParams({ limit: String(limit) })
  const res = await fetch(`${API}/support/tickets?${q}`, { headers: authHeaders(token) })
  if (!res.ok) throw new Error(await parseError(res))
  return (await res.json()) as SupportTicketListItem[]
}

export async function getSupportTicket(
  token: string,
  id: string,
): Promise<SupportTicketDetail> {
  const res = await fetch(`${API}/support/tickets/${id}`, { headers: authHeaders(token) })
  if (!res.ok) throw new Error(await parseError(res))
  return (await res.json()) as SupportTicketDetail
}

export async function addSupportMessage(
  token: string,
  id: string,
  content: string,
): Promise<SupportMessage> {
  const res = await fetch(`${API}/support/tickets/${id}/messages`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ content }),
  })
  if (!res.ok) throw new Error(await parseError(res))
  return (await res.json()) as SupportMessage
}

// EventSource nie ustawia nagłówków -> token w query (backend B18.2 weryfikuje access_token).
export function supportStreamUrl(token: string, ticketId: string): string {
  const q = new URLSearchParams({ access_token: token })
  return `${API}/support/tickets/${ticketId}/stream?${q}`
}
