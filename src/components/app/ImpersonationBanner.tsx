import { useEffect, useState } from 'react'
import {
  IMPERSONATION_RESTORE_TOKEN_KEY,
  setStoredToken,
} from '../../auth/session'

/**
 * Widoczny przy tokenie impersonacji — przywraca poprzedni token operatora z sessionStorage.
 */
export function ImpersonationBanner(props: {
  tenantLabel: string
}) {
  const [canRestore, setCanRestore] = useState(false)
  useEffect(() => {
    try {
      setCanRestore(!!sessionStorage.getItem(IMPERSONATION_RESTORE_TOKEN_KEY))
    } catch {
      setCanRestore(false)
    }
  }, [])

  const onExit = () => {
    try {
      const prev = sessionStorage.getItem(IMPERSONATION_RESTORE_TOKEN_KEY)
      if (!prev) return
      setStoredToken(prev)
      sessionStorage.removeItem(IMPERSONATION_RESTORE_TOKEN_KEY)
      window.location.reload()
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="app-banner app-banner--impersonation" role="status">
      <span>
        <strong>Impersonacja:</strong> pracujesz w kontekście <strong>{props.tenantLabel}</strong>. To nie jest Twój zwykły
        workspace operatora.
      </span>
      <button
        type="button"
        className="btn-ghost"
        onClick={onExit}
        disabled={!canRestore}
        title={
          canRestore
            ? undefined
            : 'Brak zapisanego tokenu operatora (np. nowa karta lub wyczyszczona pamięć). Zaloguj się ponownie do panelu Admin.'
        }
      >
        Wróć do panelu platformy
      </button>
    </div>
  )
}
