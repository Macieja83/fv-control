import { useCallback, useEffect, useState } from 'react'
import {
  fetchConnectorsPlatformSummary,
  fetchPlatformKsefOverview,
  fetchPlatformTenants,
  issueImpersonationToken,
  type ConnectorsPlatformRow,
  type PlatformAdminKsefRow,
  type PlatformTenantRow,
} from '../../api/platformAdminApi'
import { IMPERSONATION_RESTORE_TOKEN_KEY, getStoredToken, setStoredToken } from '../../auth/session'
import { AdminTenantDirectory } from './AdminTenantDirectory'

/**
 * Panel operatora platformy — katalog tenantów, KSeF/connectory per tenant, impersonacja.
 * Widoczny tylko dla `user.isPlatformAdmin`.
 */
export function AdminPanel() {
  const [rows, setRows] = useState<PlatformTenantRow[]>([])
  const [ksefRows, setKsefRows] = useState<PlatformAdminKsefRow[]>([])
  const [connectors, setConnectors] = useState<ConnectorsPlatformRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    const token = getStoredToken()
    if (!token) {
      setErr('Brak sesji.')
      setLoading(false)
      return
    }
    setLoading(true)
    setErr(null)
    try {
      const [data, ksef, conn] = await Promise.all([
        fetchPlatformTenants(token),
        fetchPlatformKsefOverview(token, 500),
        fetchConnectorsPlatformSummary(token),
      ])
      setRows(data)
      setKsefRows(ksef)
      setConnectors(conn)
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const onImpersonate = async (tenantId: string) => {
    const token = getStoredToken()
    if (!token) return
    try {
      const newToken = await issueImpersonationToken(token, tenantId)
      try {
        sessionStorage.setItem(IMPERSONATION_RESTORE_TOKEN_KEY, token)
      } catch {
        /* ignore */
      }
      setStoredToken(newToken)
      window.location.reload()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="workspace-panel">
      <header className="workspace-panel__head workspace-panel__head--split">
        <div>
          <h2 className="workspace-panel__title">Admin — operator platformy</h2>
          <p className="workspace-panel__lead">
            Lista firm: NIP, plan, czy PRO jest realnie aktywne, status subskrypcji i krótki stan konta. Przycisk „Konto” — wejście
            na workspace tenanta (impersonacja). W „Więcej” — UUID, Stripe, KSeF.
          </p>
        </div>
        <div className="workspace-panel__head-actions">
          <button type="button" className="btn-ghost" onClick={() => void load()} disabled={loading}>
            Odśwież
          </button>
        </div>
      </header>

      <AdminTenantDirectory
        rows={rows}
        ksefRows={ksefRows}
        connectors={connectors}
        loading={loading}
        err={err}
        onReload={() => void load()}
        onImpersonate={onImpersonate}
      />
    </div>
  )
}
