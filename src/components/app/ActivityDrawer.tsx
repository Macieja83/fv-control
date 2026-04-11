import { useEffect, useState } from 'react'
import { fetchActivity, type ActivityItem } from '../../api/activityApi'
import { getStoredToken } from '../../auth/session'

export function ActivityDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [rows, setRows] = useState<ActivityItem[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    const token = getStoredToken()
    if (!token) {
      setErr('Brak sesji.')
      return
    }
    let cancelled = false
    setLoading(true)
    setErr(null)
    void fetchActivity(token, 80)
      .then((data) => {
        if (!cancelled) setRows(data)
      })
      .catch((e: unknown) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  if (!open) return null

  return (
    <div className="activity-drawer-overlay" role="presentation" onClick={onClose}>
      <aside
        className="activity-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="activity-drawer-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="activity-drawer__head">
          <h2 id="activity-drawer-title">Powiadomienia</h2>
          <button type="button" className="activity-drawer__close" onClick={onClose} aria-label="Zamknij">
            ×
          </button>
        </header>
        {loading && <p className="activity-drawer__muted">Ładowanie…</p>}
        {err && <p className="activity-drawer__err">{err}</p>}
        <ul className="activity-drawer__list">
          {rows.map((r) => (
            <li key={r.id} className="activity-drawer__item">
              <span className="activity-drawer__title">{r.title}</span>
              <span className="activity-drawer__meta">
                {new Date(r.createdAt).toLocaleString('pl-PL')}
                {r.actorEmail ? ` · ${r.actorEmail}` : ''}
              </span>
              {r.entityType === 'INVOICE' && r.entityId && (
                <span className="activity-drawer__meta mono">{r.entityId.slice(0, 8)}…</span>
              )}
            </li>
          ))}
        </ul>
        {!loading && !err && rows.length === 0 && (
          <p className="activity-drawer__muted">Brak zdarzeń w dzienniku.</p>
        )}
      </aside>
    </div>
  )
}
