const API = '/api/v1'

export type ActivityItem = {
  id: string
  createdAt: string
  action: string
  title: string
  entityType: string
  entityId: string | null
  actorEmail: string | null
  metadata: unknown
}

export async function fetchActivity(token: string, limit = 50): Promise<ActivityItem[]> {
  const q = new URLSearchParams({ limit: String(limit) })
  const res = await fetch(`${API}/activity?${q}`, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try {
      const j = (await res.json()) as { error?: { message?: string } }
      if (typeof j.error?.message === 'string') msg = j.error.message
    } catch {
      /* ignore */
    }
    throw new Error(msg)
  }
  return (await res.json()) as ActivityItem[]
}
